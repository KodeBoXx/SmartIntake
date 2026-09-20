package com.kodeboxx.smartintake.contract.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.kodeboxx.smartintake.contract.ContractValue;
import com.kodeboxx.smartintake.contract.TimeZoneRegistry;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

/**
 * Deterministic typed-answer mutation engine for the Lite 4.0.0 runtime.
 *
 * <p>The engine stores answer cells by stable field/item address. Array indexes never participate in
 * identity. The compiled field registry supplies every type and protection decision; payload shape
 * never infers a type.
 */
public final class TypedAnswerRuntime {
  public static final int MAX_ROW_DEPTH = 3;
  public static final int MAX_ITEMS_PER_LIST = 500;
  public static final int MAX_ACTIVE_CELLS = 10_000;

  public enum Status {
    answered,
    unanswered,
    unknown,
    declined,
    respondentNotApplicable,
    notApplicable
  }

  public enum Provenance {
    respondent,
    defaultValue,
    calculated,
    system
  }

  public record RowSegment(String listFieldId, String itemId) {
    public RowSegment {
      requireId(listFieldId, "ROW_PATH_INVALID");
      requireId(itemId, "ROW_PATH_INVALID");
    }
  }

  public record Address(String fieldId, List<RowSegment> rowPath) {
    public Address {
      requireId(fieldId, "FIELD_ID_INVALID");
      rowPath = List.copyOf(rowPath == null ? List.of() : rowPath);
      if (rowPath.size() > MAX_ROW_DEPTH) throw problem("ROW_PATH_DEPTH");
    }

    public Address child(String listFieldId, String itemId, String childFieldId) {
      var next = new ArrayList<>(rowPath);
      next.add(new RowSegment(listFieldId, itemId));
      return new Address(childFieldId, next);
    }
  }

  public record Field(
      String id,
      String type,
      boolean calculated,
      boolean readOnly,
      boolean allowUnknown,
      boolean allowDeclined,
      boolean allowNotApplicable,
      Integer decimalScale,
      Set<String> optionIds,
      Map<String, Field> children,
      List<String> fixedItemIds,
      String hiddenRetention,
      String normalizer,
      JsonNode defaultAnswer,
      JsonNode minimum,
      JsonNode maximum,
      JsonNode step,
      Integer minLength,
      Integer maxLength,
      Integer minItems,
      Integer maxItems,
      Set<String> exclusiveOptionIds) {
    public Field(
        String id, String type, boolean calculated, boolean readOnly, boolean allowUnknown,
        boolean allowDeclined, boolean allowNotApplicable, Integer decimalScale, Set<String> optionIds,
        Map<String, Field> children, List<String> fixedItemIds) {
      this(id, type, calculated, readOnly, allowUnknown, allowDeclined, allowNotApplicable,
          decimalScale, optionIds, children, fixedItemIds, "draft", "preserve", null,
          null, null, null, null, null, null, null, Set.of());
    }

    public Field {
      requireId(id, "FIELD_ID_INVALID");
      Objects.requireNonNull(type, "type");
      optionIds = Set.copyOf(optionIds == null ? Set.of() : optionIds);
      children = Map.copyOf(children == null ? Map.of() : children);
      fixedItemIds = List.copyOf(fixedItemIds == null ? List.of() : fixedItemIds);
      hiddenRetention = hiddenRetention == null ? "clear" : hiddenRetention;
      normalizer = normalizer == null ? "preserve" : normalizer;
      defaultAnswer = defaultAnswer == null ? null : defaultAnswer.deepCopy();
      exclusiveOptionIds = Set.copyOf(exclusiveOptionIds == null ? Set.of() : exclusiveOptionIds);
      if (decimalScale != null && (decimalScale < 0 || decimalScale > 34))
        throw problem("DECIMAL_SCALE");
      if (("object".equals(type) || "list".equals(type)) && children.isEmpty())
        throw problem("CHILD_FIELDS_REQUIRED");
      if (!fixedItemIds.isEmpty() && !"list".equals(type)) throw problem("FIXED_ROWS_INVALID");
      if (new HashSet<>(fixedItemIds).size() != fixedItemIds.size()) throw problem("FIXED_ROWS_INVALID");
    }

    @Override
    public JsonNode defaultAnswer() {
      return defaultAnswer == null ? null : defaultAnswer.deepCopy();
    }
  }

  public record Cell(
      String type,
      Status status,
      Provenance provenance,
      JsonNode value,
      Instant changedAt,
      boolean needsReentry) {
    public Cell {
      Objects.requireNonNull(type, "type");
      Objects.requireNonNull(status, "status");
      Objects.requireNonNull(provenance, "provenance");
      Objects.requireNonNull(changedAt, "changedAt");
      value = value == null ? null : value.deepCopy();
      if (status != Status.answered && value != null) throw problem("STATUS_VALUE_CONFLICT");
      if (status == Status.answered && value == null) throw problem("ANSWER_VALUE_REQUIRED");
    }

    @Override
    public JsonNode value() {
      return value == null ? null : value.deepCopy();
    }
  }

  public sealed interface Operation permits SetValue, Clear, MarkInvalid, AddItem, RemoveItem, MoveItem {
    Address address();
  }

  public record SetValue(Address address, Status status, JsonNode value) implements Operation {}

  public record Clear(Address address) implements Operation {}

  public record MarkInvalid(Address address) implements Operation {}

  public record AddItem(Address address, String itemId, Map<String, SetValue> initialCells)
      implements Operation {
    public AddItem {
      requireId(itemId, "ITEM_ID_INVALID");
      initialCells = Map.copyOf(initialCells == null ? Map.of() : initialCells);
    }
  }

  public record RemoveItem(Address address, String itemId) implements Operation {
    public RemoveItem {
      requireId(itemId, "ITEM_ID_INVALID");
    }
  }

  public record MoveItem(Address address, String itemId, String beforeItemId) implements Operation {
    public MoveItem {
      requireId(itemId, "ITEM_ID_INVALID");
      if (beforeItemId != null) requireId(beforeItemId, "ITEM_ID_INVALID");
    }
  }

  public record Diagnostic(String code, String fieldId, List<RowSegment> rowPath, String pointer) {
    public Diagnostic {
      rowPath = List.copyOf(rowPath == null ? List.of() : rowPath);
    }
  }

  public static final class State {
    private final LinkedHashMap<Address, Cell> cells;
    private final LinkedHashMap<Address, Cell> retainedCells;
    private final LinkedHashMap<Address, List<String>> itemOrder;
    private final LinkedHashSet<String> retiredItems;

    public State() {
      this(Map.of(), Map.of(), Map.of(), Set.of());
    }

    private State(
        Map<Address, Cell> cells,
        Map<Address, Cell> retainedCells,
        Map<Address, List<String>> itemOrder,
        Set<String> retiredItems) {
      this.cells = deepCopyCells(cells);
      this.retainedCells = deepCopyCells(retainedCells);
      this.itemOrder = new LinkedHashMap<>();
      itemOrder.forEach((key, value) -> this.itemOrder.put(key, List.copyOf(value)));
      this.retiredItems = new LinkedHashSet<>(retiredItems);
    }

    private static LinkedHashMap<Address, Cell> deepCopyCells(Map<Address, Cell> source) {
      LinkedHashMap<Address, Cell> copy = new LinkedHashMap<>();
      source.forEach((address, cell) -> copy.put(address, new Cell(cell.type(), cell.status(),
          cell.provenance(), cell.value(), cell.changedAt(), cell.needsReentry())));
      return copy;
    }

    public Map<Address, Cell> cells() {
      return Collections.unmodifiableMap(cells);
    }

    /** Hidden retained values are private runtime state and never part of review/export projection. */
    public Map<Address, Cell> retainedCells() {
      return Collections.unmodifiableMap(retainedCells);
    }

    public List<String> itemIds(Address listAddress) {
      return itemOrder.getOrDefault(listAddress, List.of());
    }

    public boolean retired(Address listAddress, String itemId) {
      return retiredItems.contains(itemId);
    }

    public State copy() {
      return new State(cells, retainedCells, itemOrder, retiredItems);
    }
  }

  public record Result(State state, List<Diagnostic> diagnostics, int acceptedOperations) {
    public Result {
      diagnostics = List.copyOf(diagnostics);
    }

    public boolean accepted() {
      return diagnostics.isEmpty();
    }
  }

  private final Map<String, Field> roots;
  private final Map<String, Field> allFields;
  private final Map<String, List<String>> listAncestors;
  private final Map<String, List<String>> structuralAncestors;

  public TypedAnswerRuntime(Collection<Field> roots) {
    var fields = new LinkedHashMap<String, Field>();
    var descendants = new LinkedHashMap<String, Field>();
    var ancestors = new LinkedHashMap<String, List<String>>();
    var structures = new LinkedHashMap<String, List<String>>();
    for (Field field : roots) {
      if (fields.putIfAbsent(field.id(), field) != null) throw problem("DUPLICATE_FIELD_ID");
      collectField(field, List.of(), List.of(), descendants, ancestors, structures);
    }
    this.roots = Map.copyOf(fields);
    this.allFields = Map.copyOf(descendants);
    this.listAncestors = Map.copyOf(ancestors);
    this.structuralAncestors = Map.copyOf(structures);
  }

  private static void collectField(
      Field field,
      List<String> parentLists,
      List<String> parentStructures,
      Map<String, Field> descendants,
      Map<String, List<String>> ancestors,
      Map<String, List<String>> structures) {
    if (descendants.putIfAbsent(field.id(), field) != null) throw problem("DUPLICATE_FIELD_ID");
    ancestors.put(field.id(), List.copyOf(parentLists));
    structures.put(field.id(), List.copyOf(parentStructures));
    List<String> childLists = parentLists;
    if ("list".equals(field.type())) {
      childLists = new ArrayList<>(parentLists);
      childLists.add(field.id());
    }
    List<String> childStructures = new ArrayList<>(parentStructures);
    if ("object".equals(field.type()) || "list".equals(field.type())) childStructures.add(field.id());
    for (Field child : field.children().values())
      collectField(child, childLists, childStructures, descendants, ancestors, structures);
  }

  /** Applies the complete batch atomically. Any diagnostic returns the original state. */
  public Result apply(State current, List<? extends Operation> operations, Instant changedAt) {
    Objects.requireNonNull(current, "current");
    Objects.requireNonNull(changedAt, "changedAt");
    State candidate = current.copy();
    List<Diagnostic> diagnostics = new ArrayList<>();
    int index = 0;
    for (Operation operation : operations == null ? List.<Operation>of() : operations) {
      try {
        applyOne(candidate, operation, changedAt);
        if (candidate.cells.size() > MAX_ACTIVE_CELLS) throw problem("ACTIVE_CELL_LIMIT");
        if (candidate.retainedCells.size() > MAX_ACTIVE_CELLS) throw problem("RETAINED_CELL_LIMIT");
        if (candidate.retiredItems.size() > MAX_ACTIVE_CELLS) throw problem("RETIRED_ITEM_LIMIT");
      } catch (RuntimeProblem problem) {
        diagnostics.add(
            new Diagnostic(
                problem.code,
                operation.address().fieldId(),
                operation.address().rowPath(),
                "/operations/" + index));
      }
      index++;
    }
    if (!diagnostics.isEmpty()) return new Result(current, diagnostics, 0);
    return new Result(candidate, List.of(), index);
  }

  /** Applies server-owned calculated, default, or applicability cells to a copied state. */
  public State projectServerCells(State current, Map<Address, Cell> projected) {
    State candidate = current.copy();
    projected.entrySet().stream()
        .sorted(Map.Entry.comparingByKey(Comparator.comparing(Address::toString)))
        .forEach(entry -> {
          Field field = resolve(entry.getKey());
          Cell cell = entry.getValue();
          if (!field.type().equals(cell.type())) throw problem("TYPE_MISMATCH");
          if (cell.provenance() == Provenance.respondent) throw problem("SERVER_PROVENANCE_REQUIRED");
          if (cell.status() == Status.answered) validateValue(field, cell.value());
          putActiveCell(candidate, entry.getKey(), cell);
        });
    if (candidate.cells.size() > MAX_ACTIVE_CELLS) throw problem("ACTIVE_CELL_LIMIT");
    return candidate;
  }

  /** Applies effective applicability while preserving hidden retained values outside projections. */
  public State projectApplicability(
      State current, Map<Address, Boolean> applicable, Instant changedAt) {
    State candidate = current.copy();
    applicable.entrySet().stream()
        .sorted(Map.Entry.comparingByKey(Comparator.comparing(Address::toString)))
        .forEach(entry -> {
          Field field = resolve(entry.getKey());
          Cell effective = candidate.cells.get(entry.getKey());
          if (!entry.getValue()) {
            if (effective != null && effective.status() == Status.notApplicable) return;
            if ("clear".equals(field.hiddenRetention())) {
              clearSubtree(candidate, field, entry.getKey());
              effective = null;
            } else if (effective != null && effective.status() != Status.notApplicable) {
              candidate.retainedCells.put(entry.getKey(), effective);
            }
            putActiveCell(candidate, entry.getKey(), new Cell(
                field.type(), Status.notApplicable, Provenance.system, null, changedAt, false));
          } else if (effective != null && effective.status() == Status.notApplicable) {
            Cell retained = candidate.retainedCells.remove(entry.getKey());
            if (retained != null) putActiveCell(candidate, entry.getKey(), retained);
            else putActiveCell(candidate, entry.getKey(), new Cell(
                field.type(), Status.unanswered, Provenance.system, null, changedAt, false));
          }
        });
    return candidate;
  }

  private void clearSubtree(State state, Field field, Address address) {
    Set<String> descendantIds = new HashSet<>();
    collectDescendantIds(field, descendantIds);
    state.cells.keySet().removeIf(candidate -> descendantAddress(candidate, address, descendantIds));
    state.retainedCells.keySet().removeIf(candidate -> descendantAddress(candidate, address, descendantIds));
    List<Address> removedOrders = state.itemOrder.keySet().stream()
        .filter(candidate -> descendantAddress(candidate, address, descendantIds)).toList();
    removedOrders.forEach(candidate -> {
      state.retiredItems.addAll(state.itemOrder.getOrDefault(candidate, List.of()));
      state.itemOrder.remove(candidate);
    });
  }

  private static void collectDescendantIds(Field field, Set<String> ids) {
    ids.add(field.id());
    field.children().values().forEach(child -> collectDescendantIds(child, ids));
  }

  private static boolean descendantAddress(Address candidate, Address root, Set<String> fieldIds) {
    if (!fieldIds.contains(candidate.fieldId())) return false;
    if (candidate.rowPath().size() < root.rowPath().size()) return false;
    return candidate.rowPath().subList(0, root.rowPath().size()).equals(root.rowPath());
  }

  /** Creates the deterministic initial structural state, including immutable fixed rows. */
  public State initialize() {
    return initialize(Instant.EPOCH);
  }

  public State initialize(Instant changedAt) {
    State state = new State();
    roots.values().stream()
        .filter(field -> "list".equals(field.type()) && !field.fixedItemIds().isEmpty())
        .sorted(Comparator.comparing(Field::id))
        .forEach(field -> {
          Address address = new Address(field.id(), List.of());
          state.itemOrder.put(address, field.fixedItemIds());
          putActiveCell(state, address, structuralCell(field, Provenance.system, changedAt));
        });
    roots.values().stream().sorted(Comparator.comparing(Field::id))
        .forEach(field -> applyDefault(state, field, List.of(), changedAt));
    return state;
  }

  private void applyDefault(State state, Field field, List<RowSegment> path, Instant changedAt) {
    JsonNode answer = field.defaultAnswer();
    Address address = new Address(field.id(), path);
    if ("list".equals(field.type()) && !field.fixedItemIds().isEmpty()
        && !state.itemOrder.containsKey(address)) {
      state.itemOrder.put(address, field.fixedItemIds());
      putActiveCell(state, address, structuralCell(field, Provenance.system, changedAt));
    }
    if (answer != null && !state.cells.containsKey(address))
      applyDefaultAnswer(state, field, address, answer, changedAt);
    if ("object".equals(field.type())) {
      for (Field child : field.children().values()) applyDefault(state, child, path, changedAt);
    } else if ("list".equals(field.type())) {
      for (String itemId : state.itemIds(address)) {
        List<RowSegment> childPath = new ArrayList<>(path);
        childPath.add(new RowSegment(field.id(), itemId));
        for (Field child : field.children().values()) {
          Address childAddress = new Address(child.id(), childPath);
          if (!state.cells.containsKey(childAddress)) applyDefault(state, child, childPath, changedAt);
        }
      }
    }
  }

  private void applyDefaultAnswer(State state, Field field, Address address, JsonNode answer, Instant changedAt) {
    if (!"answered".equals(answer.path("status").asText()) || !answer.has("value"))
      throw problem("DEFAULT_INVALID");
    JsonNode value = answer.get("value");
    if ("object".equals(field.type())) {
      putActiveCell(state, address, structuralCell(field, Provenance.defaultValue, changedAt));
      JsonNode childAnswers = value.path("fields");
      childAnswers.fields().forEachRemaining(entry -> {
        Field child = field.children().get(entry.getKey());
        if (child == null) throw problem("DEFAULT_INVALID");
        applyDefaultAnswer(state, child, new Address(child.id(), address.rowPath()), entry.getValue(), changedAt);
      });
    } else if ("list".equals(field.type())) {
      List<String> ids = new ArrayList<>();
      for (JsonNode item : value.path("items")) {
        String itemId = item.path("itemId").asText();
        requireId(itemId, "DEFAULT_INVALID");
        if (!ids.add(itemId)) throw problem("ITEM_ID_REUSED");
        List<RowSegment> childPath = new ArrayList<>(address.rowPath());
        childPath.add(new RowSegment(field.id(), itemId));
        item.path("fields").fields().forEachRemaining(entry -> {
          Field child = field.children().get(entry.getKey());
          if (child == null) throw problem("DEFAULT_INVALID");
          applyDefaultAnswer(state, child, new Address(child.id(), childPath), entry.getValue(), changedAt);
        });
      }
      state.itemOrder.put(address, List.copyOf(ids));
      if (!field.fixedItemIds().isEmpty() && !ids.equals(field.fixedItemIds()))
        throw problem("FIXED_ROWS_INVALID");
      if (field.minItems() != null && ids.size() < field.minItems()) throw problem("MIN_ITEMS");
      if (field.maxItems() != null && ids.size() > field.maxItems()) throw problem("MAX_ITEMS");
      putActiveCell(state, address, structuralCell(field, Provenance.defaultValue, changedAt));
    } else {
      JsonNode normalized = normalize(field, value);
      validateValue(field, normalized);
      putActiveCell(state, address,
          new Cell(field.type(), Status.answered, Provenance.defaultValue, normalized, changedAt, false));
    }
  }

  private static Cell structuralCell(Field field, Provenance provenance, Instant changedAt) {
    return new Cell(field.type(), Status.answered, provenance,
        JsonNodeFactory.instance.objectNode(), changedAt, false);
  }

  private static void putActiveCell(State state, Address address, Cell cell) {
    if (!state.cells.containsKey(address) && state.cells.size() >= MAX_ACTIVE_CELLS)
      throw problem("ACTIVE_CELL_LIMIT");
    state.cells.put(address, cell);
  }

  /** Returns the recursive server-owned answer projection used by expressions, review, and clients. */
  public ObjectNode projection(State state) {
    ObjectNode answers = JsonNodeFactory.instance.objectNode();
    roots.values().stream().sorted(Comparator.comparing(Field::id))
        .forEach(field -> answers.set(field.id(), projectCell(state, field, List.of())));
    return answers;
  }

  /** Rehydrates only a server projection that matches this compiled field registry. */
  public State fromProjection(JsonNode projection) {
    if (projection == null || !projection.isObject()) throw problem("PROJECTION_INVALID");
    State state = initialize();
    Set<String> activeIds = new HashSet<>(allActiveItemIds(state));
    for (Field field : roots.values()) {
      JsonNode cell = projection.path(field.id());
      if (!cell.isMissingNode()) readCell(state, field, List.of(), cell, activeIds);
    }
    projection.fieldNames().forEachRemaining(id -> {
      if (!roots.containsKey(id)) throw problem("UNKNOWN_FIELD");
    });
    return state;
  }

  /** Serializes trusted server-only state. This envelope is never returned to a respondent. */
  public ObjectNode storage(State state) {
    ObjectNode stored = JsonNodeFactory.instance.objectNode();
    stored.put("version", 1);
    List<Map.Entry<Address, Field>> transientMemory = state.cells.entrySet().stream()
        .filter(entry -> entry.getValue().status() == Status.notApplicable)
        .map(entry -> Map.entry(entry.getKey(), resolve(entry.getKey())))
        .filter(entry -> "memory".equals(entry.getValue().hiddenRetention()))
        .toList();
    Map<Address, Cell> persistentCells = new LinkedHashMap<>(state.cells);
    Map<Address, Cell> persistentRetained = new LinkedHashMap<>(state.retainedCells);
    Map<Address, List<String>> persistentOrder = new LinkedHashMap<>(state.itemOrder);
    Set<String> additionallyRetired = new LinkedHashSet<>();
    for (Map.Entry<Address, Field> memory : transientMemory) {
      Set<String> ids = new HashSet<>();
      collectDescendantIds(memory.getValue(), ids);
      persistentCells.keySet().removeIf(address -> descendantAddress(address, memory.getKey(), ids)
          && !address.equals(memory.getKey()));
      persistentRetained.keySet().removeIf(address -> descendantAddress(address, memory.getKey(), ids));
      persistentOrder.entrySet().removeIf(entry -> {
        if (!descendantAddress(entry.getKey(), memory.getKey(), ids)) return false;
        additionallyRetired.addAll(entry.getValue());
        return true;
      });
    }
    writeCells(stored.putArray("cells"), persistentCells);
    writeCells(stored.putArray("retainedCells"), persistentRetained);
    ArrayNode orders = stored.putArray("itemOrder");
    persistentOrder.entrySet().stream()
        .sorted(Map.Entry.comparingByKey(Comparator.comparing(Address::toString)))
        .forEach(entry -> {
          ObjectNode item = orders.addObject();
          item.set("address", writeAddress(entry.getKey()));
          ArrayNode ids = item.putArray("itemIds");
          entry.getValue().forEach(ids::add);
        });
    ArrayNode retired = stored.putArray("retiredItemIds");
    Set<String> retiredIds = new TreeSet<>(state.retiredItems);
    retiredIds.addAll(additionallyRetired);
    retiredIds.forEach(retired::add);
    return stored;
  }

  /** Rehydrates and validates trusted server-only state against the compiled field registry. */
  public State fromStorage(JsonNode stored) {
    if (stored == null || !stored.isObject() || stored.path("version").asInt(-1) != 1
        || !stored.path("cells").isArray() || !stored.path("retainedCells").isArray()
        || !stored.path("itemOrder").isArray() || !stored.path("retiredItemIds").isArray())
      throw problem("RUNTIME_STATE_INVALID");
    State state = new State();
    Set<String> activeIds = new HashSet<>();
    for (JsonNode order : stored.path("itemOrder")) {
      Address address = readAddress(order.path("address"));
      Field field = resolve(address);
      if (!"list".equals(field.type()) || !order.path("itemIds").isArray())
        throw problem("RUNTIME_STATE_INVALID");
      List<String> ids = new ArrayList<>();
      for (JsonNode idNode : order.path("itemIds")) {
        String id = idNode.asText();
        requireId(id, "RUNTIME_STATE_INVALID");
        if (!activeIds.add(id)) throw problem("ITEM_ID_REUSED");
        ids.add(id);
      }
      if (ids.size() > MAX_ITEMS_PER_LIST) throw problem("ITEM_LIMIT");
      if (!field.fixedItemIds().isEmpty() && !ids.equals(field.fixedItemIds()))
        throw problem("FIXED_ROWS_INVALID");
      state.itemOrder.put(address, List.copyOf(ids));
    }
    readStoredCells(stored.path("cells"), state.cells, state);
    readStoredCells(stored.path("retainedCells"), state.retainedCells, state);
    for (JsonNode retired : stored.path("retiredItemIds")) {
      String id = retired.asText();
      requireId(id, "RUNTIME_STATE_INVALID");
      if (activeIds.contains(id) || !state.retiredItems.add(id)) throw problem("ITEM_ID_REUSED");
    }
    if (state.cells.size() > MAX_ACTIVE_CELLS) throw problem("ACTIVE_CELL_LIMIT");
    if (state.retainedCells.size() > MAX_ACTIVE_CELLS) throw problem("RETAINED_CELL_LIMIT");
    if (state.retiredItems.size() > MAX_ACTIVE_CELLS) throw problem("RETIRED_ITEM_LIMIT");
    return state;
  }

  private void writeCells(ArrayNode target, Map<Address, Cell> cells) {
    cells.entrySet().stream()
        .sorted(Map.Entry.comparingByKey(Comparator.comparing(Address::toString)))
        .forEach(entry -> {
          ObjectNode item = target.addObject();
          item.set("address", writeAddress(entry.getKey()));
          Cell cell = entry.getValue();
          item.put("type", cell.type());
          item.put("status", cell.status().name());
          item.put("provenance", cell.provenance().name());
          item.put("changedAt", cell.changedAt().toString());
          item.put("needsReentry", cell.needsReentry());
          if (cell.value() != null) item.set("value", cell.value());
        });
  }

  private ObjectNode writeAddress(Address address) {
    ObjectNode node = JsonNodeFactory.instance.objectNode();
    node.put("fieldId", address.fieldId());
    ArrayNode path = node.putArray("rowPath");
    address.rowPath().forEach(segment -> {
      ObjectNode row = path.addObject();
      row.put("listFieldId", segment.listFieldId());
      row.put("itemId", segment.itemId());
    });
    return node;
  }

  private Address readAddress(JsonNode node) {
    if (!node.isObject() || !node.path("fieldId").isTextual() || !node.path("rowPath").isArray())
      throw problem("RUNTIME_STATE_INVALID");
    List<RowSegment> path = new ArrayList<>();
    for (JsonNode row : node.path("rowPath")) {
      path.add(new RowSegment(row.path("listFieldId").asText(), row.path("itemId").asText()));
    }
    return new Address(node.path("fieldId").asText(), path);
  }

  private void readStoredCells(JsonNode source, Map<Address, Cell> target, State state) {
    for (JsonNode item : source) {
      Address address = readAddress(item.path("address"));
      validateParentPath(state, address);
      Field field = resolve(address);
      if (!field.type().equals(item.path("type").asText())) throw problem("TYPE_MISMATCH");
      Status status;
      Provenance provenance;
      Instant changedAt;
      try {
        status = Status.valueOf(item.path("status").asText());
        provenance = Provenance.valueOf(item.path("provenance").asText());
        changedAt = Instant.parse(item.path("changedAt").asText());
      } catch (RuntimeException invalid) {
        throw problem("RUNTIME_STATE_INVALID");
      }
      JsonNode value = status == Status.answered ? item.get("value") : null;
      if (status == Status.answered && !"object".equals(field.type()) && !"list".equals(field.type()))
        validateValue(field, value);
      Cell previous = target.put(address, new Cell(field.type(), status, provenance, value, changedAt,
          item.path("needsReentry").asBoolean(false)));
      if (previous != null) throw problem("RUNTIME_STATE_INVALID");
    }
  }

  private void readCell(
      State state, Field field, List<RowSegment> path, JsonNode cell, Set<String> activeIds) {
    if (!cell.isObject() || !field.type().equals(cell.path("type").asText()))
      throw problem("PROJECTION_INVALID");
    Status status;
    try {
      status = Status.valueOf(cell.path("status").asText());
    } catch (RuntimeException invalid) {
      throw problem("PROJECTION_INVALID");
    }
    Address address = new Address(field.id(), path);
    if ("list".equals(field.type())) {
      if (status == Status.notApplicable) {
        state.cells.put(address, readScalarCell(field, cell, status));
        return;
      }
      if (status == Status.unanswered) {
        state.cells.put(address, readScalarCell(field, cell, status));
        return;
      }
      if (status != Status.answered || !cell.path("value").path("items").isArray())
        throw problem("PROJECTION_INVALID");
      List<String> order = new ArrayList<>();
      for (JsonNode item : cell.path("value").path("items")) {
        String itemId = item.path("itemId").asText();
        requireId(itemId, "ITEM_ID_INVALID");
        if (!activeIds.add(itemId)) throw problem("ITEM_ID_REUSED");
        order.add(itemId);
        List<RowSegment> itemPath = new ArrayList<>(path);
        itemPath.add(new RowSegment(field.id(), itemId));
        for (Field child : field.children().values()) {
          JsonNode childCell = item.path("fields").path(child.id());
          if (!childCell.isMissingNode()) readCell(state, child, itemPath, childCell, activeIds);
        }
      }
      state.itemOrder.put(address, List.copyOf(order));
      state.cells.put(address, readScalarCell(field, cell, status));
      return;
    }
    if ("object".equals(field.type())) {
      if (status == Status.notApplicable) {
        state.cells.put(address, readScalarCell(field, cell, status));
        return;
      }
      if (status != Status.answered || !cell.path("value").path("fields").isObject())
        throw problem("PROJECTION_INVALID");
      for (Field child : field.children().values()) {
        JsonNode childCell = cell.path("value").path("fields").path(child.id());
        if (!childCell.isMissingNode()) readCell(state, child, path, childCell, activeIds);
      }
      state.cells.put(address, readScalarCell(field, cell, status));
      return;
    }
    state.cells.put(address, readScalarCell(field, cell, status));
  }

  private Cell readScalarCell(Field field, JsonNode cell, Status status) {
    JsonNode value = status == Status.answered ? cell.get("value") : null;
    if (status == Status.answered && !"object".equals(field.type()) && !"list".equals(field.type()))
      validateValue(field, value);
    Provenance provenance;
    try {
      String source = cell.path("provenance").path("source").asText("system");
      provenance = "default".equals(source) ? Provenance.defaultValue : Provenance.valueOf(source);
    } catch (RuntimeException invalid) {
      throw problem("PROJECTION_INVALID");
    }
    Instant changedAt;
    try {
      changedAt = Instant.parse(cell.path("provenance").path("changedAt").asText(Instant.EPOCH.toString()));
    } catch (RuntimeException invalid) {
      throw problem("PROJECTION_INVALID");
    }
    return new Cell(field.type(), status, provenance, value, changedAt, false);
  }

  private ObjectNode projectCell(State state, Field field, List<RowSegment> path) {
    Address address = new Address(field.id(), path);
    Cell cell = state.cells.get(address);
    ObjectNode output = JsonNodeFactory.instance.objectNode();
    output.put("type", field.type());
    if (cell != null && cell.status() == Status.notApplicable) {
      output.put("status", "notApplicable");
      ObjectNode provenance = output.putObject("provenance");
      provenance.put("source", "system");
      provenance.put("changedAt", cell.changedAt().toString());
      return output;
    }
    if ("list".equals(field.type())) {
      boolean answered = cell != null && cell.status() == Status.answered;
      output.put("status", answered ? "answered" : "unanswered");
      ObjectNode provenance = output.putObject("provenance");
      provenance.put("source", cell == null ? "system"
          : cell.provenance() == Provenance.defaultValue ? "default" : cell.provenance().name());
      provenance.put("changedAt", cell == null ? Instant.EPOCH.toString() : cell.changedAt().toString());
      if (!answered) return output;
      ArrayNode items = output.putObject("value").putArray("items");
      for (String itemId : state.itemIds(address)) {
        ObjectNode item = items.addObject();
        item.put("itemId", itemId);
        ObjectNode fields = item.putObject("fields");
        List<RowSegment> itemPath = new ArrayList<>(path);
        itemPath.add(new RowSegment(field.id(), itemId));
        field.children().values().stream().sorted(Comparator.comparing(Field::id))
            .forEach(child -> fields.set(child.id(), projectCell(state, child, itemPath)));
      }
      return output;
    }
    if ("object".equals(field.type())) {
      output.put("status", "answered");
      ObjectNode provenance = output.putObject("provenance");
      provenance.put("source", cell == null ? "system"
          : cell.provenance() == Provenance.defaultValue ? "default" : cell.provenance().name());
      provenance.put("changedAt", cell == null ? Instant.EPOCH.toString() : cell.changedAt().toString());
      ObjectNode fields = output.putObject("value").putObject("fields");
      field.children().values().stream().sorted(Comparator.comparing(Field::id))
          .forEach(child -> fields.set(child.id(), projectCell(state, child, path)));
      return output;
    }
    if (cell == null) {
      output.put("status", "unanswered");
      ObjectNode provenance = output.putObject("provenance");
      provenance.put("source", "system");
      provenance.put("changedAt", Instant.EPOCH.toString());
      return output;
    }
    output.put("status", cell.status().name());
    ObjectNode provenance = output.putObject("provenance");
    provenance.put("source", cell.provenance() == Provenance.defaultValue ? "default" : cell.provenance().name());
    provenance.put("changedAt", cell.changedAt().toString());
    if (cell.value() != null) output.set("value", cell.value());
    return output;
  }

  private void applyOne(State state, Operation operation, Instant changedAt) {
    Field field = resolve(operation.address());
    requireApplicable(state, operation.address());
    if (operation instanceof SetValue set) set(state, field, set, changedAt);
    else if (operation instanceof Clear clear) clear(state, field, clear.address(), changedAt);
    else if (operation instanceof MarkInvalid invalid)
      invalid(state, field, invalid.address(), changedAt);
    else if (operation instanceof AddItem add) add(state, field, add, changedAt);
    else if (operation instanceof RemoveItem remove) remove(state, field, remove, changedAt);
    else if (operation instanceof MoveItem move) move(state, field, move, changedAt);
    else throw problem("OPERATION_UNSUPPORTED");
  }

  private void requireApplicable(State state, Address address) {
    Cell effective = state.cells.get(address);
    if (effective != null && effective.status() == Status.notApplicable)
      throw problem("FIELD_NOT_APPLICABLE");
    for (String ancestorId : structuralAncestors.getOrDefault(address.fieldId(), List.of())) {
      int depth = listAncestors.get(ancestorId).size();
      Address ancestor = new Address(ancestorId, address.rowPath().subList(0, depth));
      Cell ancestorCell = state.cells.get(ancestor);
      if (ancestorCell != null && ancestorCell.status() == Status.notApplicable)
        throw problem("FIELD_NOT_APPLICABLE");
    }
    for (int index = 0; index < address.rowPath().size(); index++) {
      RowSegment segment = address.rowPath().get(index);
      Address parent = new Address(segment.listFieldId(), address.rowPath().subList(0, index));
      Cell parentCell = state.cells.get(parent);
      if (parentCell != null && parentCell.status() == Status.notApplicable)
        throw problem("FIELD_NOT_APPLICABLE");
    }
  }

  public boolean ancestorsApplicable(State state, Address address) {
    for (String ancestorId : structuralAncestors.getOrDefault(address.fieldId(), List.of())) {
      int depth = listAncestors.get(ancestorId).size();
      Cell ancestor = state.cells.get(new Address(ancestorId, address.rowPath().subList(0, depth)));
      if (ancestor != null && ancestor.status() == Status.notApplicable) return false;
    }
    for (int index = 0; index < address.rowPath().size(); index++) {
      RowSegment segment = address.rowPath().get(index);
      Cell parent = state.cells.get(new Address(segment.listFieldId(), address.rowPath().subList(0, index)));
      if (parent != null && parent.status() == Status.notApplicable) return false;
    }
    return true;
  }

  private void set(State state, Field field, SetValue operation, Instant changedAt) {
    protect(field);
    if ("object".equals(field.type()) || "list".equals(field.type()))
      throw problem("STRUCTURAL_SET_FORBIDDEN");
    Status status = Objects.requireNonNull(operation.status(), "status");
    if (status == Status.notApplicable) throw problem("SYSTEM_STATUS_FORBIDDEN");
    if (status == Status.unknown && !field.allowUnknown()) throw problem("STATUS_NOT_ALLOWED");
    if (status == Status.declined && !field.allowDeclined()) throw problem("STATUS_NOT_ALLOWED");
    if (status == Status.respondentNotApplicable && !field.allowNotApplicable())
      throw problem("STATUS_NOT_ALLOWED");
    JsonNode value = operation.value();
    if (status == Status.answered) {
      value = normalize(field, value);
      validateValue(field, value);
    }
    else if (value != null) throw problem("STATUS_VALUE_CONFLICT");
    state.cells.put(
        operation.address(),
        new Cell(field.type(), status, Provenance.respondent, value, changedAt, false));
    state.retainedCells.remove(operation.address());
  }

  private void clear(State state, Field field, Address address, Instant changedAt) {
    protect(field);
    if ("object".equals(field.type()) || "list".equals(field.type()))
      clearSubtree(state, field, address);
    state.cells.put(
        address,
        new Cell(field.type(), Status.unanswered, Provenance.respondent, null, changedAt, false));
    state.retainedCells.remove(address);
  }

  private void invalid(State state, Field field, Address address, Instant changedAt) {
    protect(field);
    Cell previous = state.cells.get(address);
    if (previous != null && previous.status() == Status.answered)
      state.retainedCells.put(address, previous);
    state.cells.put(
        address,
        new Cell(field.type(), Status.unanswered, Provenance.respondent, null, changedAt, true));
  }

  private void add(State state, Field field, AddItem operation, Instant changedAt) {
    protect(field);
    if (!"list".equals(field.type())) throw problem("LIST_REQUIRED");
    Address address = operation.address();
    validateParentPath(state, address);
    List<String> order = new ArrayList<>(state.itemOrder.getOrDefault(address, field.fixedItemIds()));
    if (!field.fixedItemIds().isEmpty()) throw problem("FIXED_ROWS_IMMUTABLE");
    if (field.maxItems() != null && order.size() >= field.maxItems()) throw problem("MAX_ITEMS");
    if (order.size() >= MAX_ITEMS_PER_LIST) throw problem("ITEM_LIMIT");
    if (allActiveItemIds(state).contains(operation.itemId()) || state.retiredItems.contains(operation.itemId()))
      throw problem("ITEM_ID_REUSED");
    order.add(operation.itemId());
    state.itemOrder.put(address, List.copyOf(order));
    state.cells.put(address, structuralCell(field, Provenance.respondent, changedAt));
    List<RowSegment> childPath = new ArrayList<>(address.rowPath());
    childPath.add(new RowSegment(field.id(), operation.itemId()));
    for (Field child : field.children().values()) applyDefault(state, child, childPath, changedAt);
    for (Map.Entry<String, SetValue> entry : operation.initialCells().entrySet()) {
      Field child = field.children().get(entry.getKey());
      if (child == null) throw problem("UNKNOWN_CHILD_FIELD");
      SetValue supplied = entry.getValue();
      Address expected = address.child(field.id(), operation.itemId(), child.id());
      set(state, child, new SetValue(expected, supplied.status(), supplied.value()), changedAt);
    }
  }

  private void remove(State state, Field field, RemoveItem operation, Instant changedAt) {
    protect(field);
    if (!"list".equals(field.type())) throw problem("LIST_REQUIRED");
    if (field.fixedItemIds().contains(operation.itemId())) throw problem("FIXED_ROWS_IMMUTABLE");
    List<String> order = new ArrayList<>(state.itemOrder.getOrDefault(operation.address(), List.of()));
    if (field.minItems() != null && order.size() <= field.minItems()) throw problem("MIN_ITEMS");
    if (!order.remove(operation.itemId())) throw problem("ITEM_NOT_FOUND");
    state.itemOrder.put(operation.address(), List.copyOf(order));
    state.cells.put(operation.address(), structuralCell(field, Provenance.respondent, changedAt));
    state.retiredItems.add(operation.itemId());
    RowSegment removed = new RowSegment(field.id(), operation.itemId());
    state.itemOrder.entrySet().stream()
        .filter(entry -> descendant(entry.getKey(), operation.address(), removed))
        .forEach(entry -> state.retiredItems.addAll(entry.getValue()));
    state.cells.keySet().removeIf(address -> descendant(address, operation.address(), removed));
    state.retainedCells.keySet().removeIf(address -> descendant(address, operation.address(), removed));
    state.itemOrder.keySet().removeIf(address -> descendant(address, operation.address(), removed));
  }

  private void move(State state, Field field, MoveItem operation, Instant changedAt) {
    protect(field);
    if (!"list".equals(field.type())) throw problem("LIST_REQUIRED");
    if (!field.fixedItemIds().isEmpty()) throw problem("FIXED_ROWS_IMMUTABLE");
    List<String> order = new ArrayList<>(state.itemOrder.getOrDefault(operation.address(), field.fixedItemIds()));
    if (!order.remove(operation.itemId())) throw problem("ITEM_NOT_FOUND");
    if (operation.beforeItemId() == null) order.add(operation.itemId());
    else {
      int target = order.indexOf(operation.beforeItemId());
      if (target < 0) throw problem("ITEM_NOT_FOUND");
      order.add(target, operation.itemId());
    }
    state.itemOrder.put(operation.address(), List.copyOf(order));
    state.cells.put(operation.address(), structuralCell(field, Provenance.respondent, changedAt));
  }

  private Field resolve(Address address) {
    Field field = allFields.get(address.fieldId());
    if (field == null) throw problem("UNKNOWN_FIELD");
    List<String> actual = address.rowPath().stream().map(RowSegment::listFieldId).toList();
    if (!listAncestors.get(address.fieldId()).equals(actual)) throw problem("ROW_PATH_INVALID");
    return field;
  }

  private void validateParentPath(State state, Address address) {
    for (int index = 0; index < address.rowPath().size(); index++) {
      RowSegment segment = address.rowPath().get(index);
      Address listAddress = new Address(segment.listFieldId(),
          address.rowPath().subList(0, index));
      if (!state.itemIds(listAddress).contains(segment.itemId())) throw problem("ITEM_NOT_FOUND");
    }
  }

  private void validateValue(Field field, JsonNode value) {
    if (value == null || value.isNull()) throw problem("ANSWER_VALUE_REQUIRED");
    try {
      switch (field.type()) {
        case "integer" -> ContractValue.integer(value);
        case "decimal" -> {
          ContractValue.decimal(value);
          if (field.decimalScale() != null && new BigDecimal(value.textValue()).scale() != field.decimalScale())
            throw problem("DECIMAL_SCALE");
        }
        case "text", "choice", "boolean", "date", "time" -> ContractValue.validate(field.type(), value);
        case "dateTime" -> {
          if (!value.isObject() || !value.path("instant").isTextual()
              || !value.path("timeZone").isTextual()) throw problem("INVALID_LITERAL");
          if (!value.path("instant").textValue().matches(
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z$"))
            throw problem("INVALID_LITERAL");
          Instant.parse(value.path("instant").textValue());
          if (!TimeZoneRegistry.contains(value.path("timeZone").textValue()))
            throw problem("TIME_ZONE_UNSUPPORTED");
        }
        case "multiChoice" -> validateChoices(field, value);
        case "attachments" -> validateAttachments(value);
        case "drawing" -> validateDrawing(value);
        default -> throw problem("TYPE_UNSUPPORTED");
      }
    } catch (RuntimeProblem problem) {
      throw problem;
    } catch (RuntimeException exception) {
      throw problem(exception.getMessage() == null ? "INVALID_LITERAL" : exception.getMessage());
    }
    if ("choice".equals(field.type()) && !field.optionIds().isEmpty()
        && !field.optionIds().contains(value.textValue())) throw problem("OPTION_INVALID");
    int length = value.isTextual() ? value.textValue().codePointCount(0, value.textValue().length())
        : value.isArray() ? value.size() : -1;
    if (field.minLength() != null && length >= 0 && length < field.minLength())
      throw problem("MIN_LENGTH");
    if (field.maxLength() != null && length >= 0 && length > field.maxLength())
      throw problem("MAX_LENGTH");
    if (field.minItems() != null && value.isArray() && value.size() < field.minItems())
      throw problem("MIN_ITEMS");
    if (field.maxItems() != null && value.isArray() && value.size() > field.maxItems())
      throw problem("MAX_ITEMS");
    if (("integer".equals(field.type()) || "decimal".equals(field.type()))) {
      BigDecimal number = new BigDecimal(value.textValue());
      if (field.minimum() != null && number.compareTo(new BigDecimal(field.minimum().textValue())) < 0)
        throw problem("MINIMUM");
      if (field.maximum() != null && number.compareTo(new BigDecimal(field.maximum().textValue())) > 0)
        throw problem("MAXIMUM");
      if (field.step() != null) {
        BigDecimal base = field.minimum() == null ? BigDecimal.ZERO
            : new BigDecimal(field.minimum().textValue());
        if (number.subtract(base).remainder(new BigDecimal(field.step().textValue())).compareTo(BigDecimal.ZERO) != 0)
          throw problem("STEP");
      }
    }
  }

  private static JsonNode normalize(Field field, JsonNode value) {
    if (value == null || !value.isTextual()) return value;
    String normalized = switch (field.normalizer()) {
      case "trim" -> value.textValue().strip();
      case "lowercase" -> value.textValue().toLowerCase(Locale.ROOT);
      case "uppercase" -> value.textValue().toUpperCase(Locale.ROOT);
      default -> value.textValue();
    };
    return JsonNodeFactory.instance.textNode(normalized);
  }

  private void validateChoices(Field field, JsonNode value) {
    if (!value.isArray()) throw problem("INVALID_LITERAL");
    Set<String> seen = new HashSet<>();
    for (JsonNode choice : value) {
      if (!choice.isTextual() || !seen.add(choice.textValue())
          || (!field.optionIds().isEmpty() && !field.optionIds().contains(choice.textValue())))
        throw problem("OPTION_INVALID");
    }
    long exclusive = seen.stream().filter(field.exclusiveOptionIds()::contains).count();
    if (exclusive > 0 && seen.size() > 1) throw problem("EXCLUSIVE_OPTION");
  }

  private void validateAttachments(JsonNode value) {
    if (!(value instanceof ArrayNode)) throw problem("INVALID_LITERAL");
    if (value.size() > 10) throw problem("FILE_COUNT_LIMIT");
    Set<String> seen = new HashSet<>();
    for (JsonNode attachment : value) {
      if (!attachment.isTextual() || !seen.add(attachment.textValue()))
        throw problem("ATTACHMENT_INVALID");
    }
  }

  private void validateDrawing(JsonNode value) {
    if (!value.isTextual() || value.textValue().isBlank()) throw problem("DRAWING_INVALID");
  }

  private void protect(Field field) {
    if (field.calculated() || field.readOnly()) throw problem("READ_ONLY_FIELD");
  }

  private boolean descendant(Address candidate, Address list, RowSegment item) {
    if (candidate.rowPath().size() <= list.rowPath().size()) return false;
    if (!candidate.rowPath().subList(0, list.rowPath().size()).equals(list.rowPath())) return false;
    return candidate.rowPath().get(list.rowPath().size()).equals(item);
  }

  private Set<String> allActiveItemIds(State state) {
    Set<String> ids = new HashSet<>();
    state.itemOrder.values().forEach(ids::addAll);
    return ids;
  }

  private static void requireId(String value, String code) {
    if (value == null || !value.matches("^[A-Za-z][A-Za-z0-9_-]{0,127}$")) throw problem(code);
  }

  private static RuntimeProblem problem(String code) {
    return new RuntimeProblem(code);
  }

  private static final class RuntimeProblem extends IllegalArgumentException {
    private final String code;

    private RuntimeProblem(String code) {
      super(code);
      this.code = code;
    }
  }
}
