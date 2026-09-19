package com.kodeboxx.smartintake.contract.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.kodeboxx.smartintake.contract.ContractValue;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
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
      List<String> fixedItemIds) {
    public Field {
      requireId(id, "FIELD_ID_INVALID");
      Objects.requireNonNull(type, "type");
      optionIds = Set.copyOf(optionIds == null ? Set.of() : optionIds);
      children = Map.copyOf(children == null ? Map.of() : children);
      fixedItemIds = List.copyOf(fixedItemIds == null ? List.of() : fixedItemIds);
      if (decimalScale != null && (decimalScale < 0 || decimalScale > 34))
        throw problem("DECIMAL_SCALE");
      if (("object".equals(type) || "list".equals(type)) && children.isEmpty())
        throw problem("CHILD_FIELDS_REQUIRED");
      if (!fixedItemIds.isEmpty() && !"list".equals(type)) throw problem("FIXED_ROWS_INVALID");
      if (new HashSet<>(fixedItemIds).size() != fixedItemIds.size()) throw problem("FIXED_ROWS_INVALID");
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
      this.cells = new LinkedHashMap<>(cells);
      this.retainedCells = new LinkedHashMap<>(retainedCells);
      this.itemOrder = new LinkedHashMap<>();
      itemOrder.forEach((key, value) -> this.itemOrder.put(key, List.copyOf(value)));
      this.retiredItems = new LinkedHashSet<>(retiredItems);
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

  public TypedAnswerRuntime(Collection<Field> roots) {
    var fields = new LinkedHashMap<String, Field>();
    for (Field field : roots) {
      if (fields.putIfAbsent(field.id(), field) != null) throw problem("DUPLICATE_FIELD_ID");
    }
    this.roots = Map.copyOf(fields);
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
    if (candidate.cells.size() > MAX_ACTIVE_CELLS)
      return new Result(
          current,
          List.of(new Diagnostic("ACTIVE_CELL_LIMIT", null, List.of(), "/operations")),
          0);
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
          candidate.cells.put(entry.getKey(), cell);
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
            if (effective != null && effective.status() != Status.notApplicable) {
              candidate.retainedCells.put(entry.getKey(), effective);
            }
            candidate.cells.put(entry.getKey(), new Cell(
                field.type(), Status.notApplicable, Provenance.system, null, changedAt, false));
          } else if (effective != null && effective.status() == Status.notApplicable) {
            Cell retained = candidate.retainedCells.remove(entry.getKey());
            if (retained != null) candidate.cells.put(entry.getKey(), retained);
            else candidate.cells.put(entry.getKey(), new Cell(
                field.type(), Status.unanswered, Provenance.system, null, changedAt, false));
          }
        });
    return candidate;
  }

  /** Creates the deterministic initial structural state, including immutable fixed rows. */
  public State initialize() {
    State state = new State();
    roots.values().stream()
        .filter(field -> "list".equals(field.type()) && !field.fixedItemIds().isEmpty())
        .sorted(Comparator.comparing(Field::id))
        .forEach(field -> state.itemOrder.put(new Address(field.id(), List.of()), field.fixedItemIds()));
    return state;
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
      return;
    }
    if ("object".equals(field.type())) {
      if (status != Status.answered || !cell.path("value").path("fields").isObject())
        throw problem("PROJECTION_INVALID");
      for (Field child : field.children().values()) {
        JsonNode childCell = cell.path("value").path("fields").path(child.id());
        if (!childCell.isMissingNode()) readCell(state, child, path, childCell, activeIds);
      }
      return;
    }
    JsonNode value = status == Status.answered ? cell.get("value") : null;
    if (status == Status.answered) validateValue(field, value);
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
    state.cells.put(address, new Cell(field.type(), status, provenance, value, changedAt,
        cell.path("needsReentry").asBoolean(false)));
  }

  private ObjectNode projectCell(State state, Field field, List<RowSegment> path) {
    Address address = new Address(field.id(), path);
    Cell cell = state.cells.get(address);
    ObjectNode output = JsonNodeFactory.instance.objectNode();
    output.put("type", field.type());
    if (cell != null && cell.status() == Status.notApplicable) {
      output.put("status", "notApplicable");
      output.put("applicable", false);
      ObjectNode provenance = output.putObject("provenance");
      provenance.put("source", "system");
      provenance.put("changedAt", cell.changedAt().toString());
      return output;
    }
    if ("list".equals(field.type())) {
      output.put("status", "answered");
      output.put("applicable", true);
      output.putObject("provenance").put("source", "system");
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
      output.put("applicable", true);
      output.putObject("provenance").put("source", "system");
      ObjectNode fields = output.putObject("value").putObject("fields");
      field.children().values().stream().sorted(Comparator.comparing(Field::id))
          .forEach(child -> fields.set(child.id(), projectCell(state, child, path)));
      return output;
    }
    if (cell == null) {
      output.put("status", "unanswered");
      output.put("applicable", true);
      output.putObject("provenance").put("source", "system");
      return output;
    }
    output.put("status", cell.status().name());
    output.put("applicable", cell.status() != Status.notApplicable);
    ObjectNode provenance = output.putObject("provenance");
    provenance.put("source", cell.provenance() == Provenance.defaultValue ? "default" : cell.provenance().name());
    provenance.put("changedAt", cell.changedAt().toString());
    if (cell.value() != null) output.set("value", cell.value());
    if (cell.needsReentry()) output.put("needsReentry", true);
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
    else if (operation instanceof RemoveItem remove) remove(state, field, remove);
    else if (operation instanceof MoveItem move) move(state, field, move);
    else throw problem("OPERATION_UNSUPPORTED");
  }

  private void requireApplicable(State state, Address address) {
    Cell effective = state.cells.get(address);
    if (effective != null && effective.status() == Status.notApplicable)
      throw problem("FIELD_NOT_APPLICABLE");
    for (int index = 0; index < address.rowPath().size(); index++) {
      RowSegment segment = address.rowPath().get(index);
      Address parent = new Address(segment.listFieldId(), address.rowPath().subList(0, index));
      Cell parentCell = state.cells.get(parent);
      if (parentCell != null && parentCell.status() == Status.notApplicable)
        throw problem("FIELD_NOT_APPLICABLE");
    }
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
    if (status == Status.answered) validateValue(field, value);
    else if (value != null) throw problem("STATUS_VALUE_CONFLICT");
    state.cells.put(
        operation.address(),
        new Cell(field.type(), status, Provenance.respondent, value, changedAt, false));
    state.retainedCells.remove(operation.address());
  }

  private void clear(State state, Field field, Address address, Instant changedAt) {
    protect(field);
    state.cells.put(
        address,
        new Cell(field.type(), Status.unanswered, Provenance.respondent, null, changedAt, false));
    state.retainedCells.remove(address);
  }

  private void invalid(State state, Field field, Address address, Instant changedAt) {
    protect(field);
    Cell previous = state.cells.get(address);
    Status status = previous == null ? Status.unanswered : previous.status();
    state.cells.put(
        address,
        new Cell(field.type(), status, Provenance.respondent,
            status == Status.answered ? previous.value() : null, changedAt, true));
  }

  private void add(State state, Field field, AddItem operation, Instant changedAt) {
    protect(field);
    if (!"list".equals(field.type())) throw problem("LIST_REQUIRED");
    Address address = operation.address();
    validateParentPath(state, address);
    List<String> order = new ArrayList<>(state.itemOrder.getOrDefault(address, field.fixedItemIds()));
    if (!field.fixedItemIds().isEmpty()) throw problem("FIXED_ROWS_IMMUTABLE");
    if (order.size() >= MAX_ITEMS_PER_LIST) throw problem("ITEM_LIMIT");
    if (allActiveItemIds(state).contains(operation.itemId()) || state.retiredItems.contains(operation.itemId()))
      throw problem("ITEM_ID_REUSED");
    order.add(operation.itemId());
    state.itemOrder.put(address, List.copyOf(order));
    for (Map.Entry<String, SetValue> entry : operation.initialCells().entrySet()) {
      Field child = field.children().get(entry.getKey());
      if (child == null) throw problem("UNKNOWN_CHILD_FIELD");
      SetValue supplied = entry.getValue();
      Address expected = address.child(field.id(), operation.itemId(), child.id());
      set(state, child, new SetValue(expected, supplied.status(), supplied.value()), changedAt);
    }
  }

  private void remove(State state, Field field, RemoveItem operation) {
    protect(field);
    if (!"list".equals(field.type())) throw problem("LIST_REQUIRED");
    if (field.fixedItemIds().contains(operation.itemId())) throw problem("FIXED_ROWS_IMMUTABLE");
    List<String> order = new ArrayList<>(state.itemOrder.getOrDefault(operation.address(), List.of()));
    if (!order.remove(operation.itemId())) throw problem("ITEM_NOT_FOUND");
    state.itemOrder.put(operation.address(), List.copyOf(order));
    state.retiredItems.add(operation.itemId());
    RowSegment removed = new RowSegment(field.id(), operation.itemId());
    state.cells.keySet().removeIf(address -> descendant(address, operation.address(), removed));
    state.retainedCells.keySet().removeIf(address -> descendant(address, operation.address(), removed));
    state.itemOrder.keySet().removeIf(address -> descendant(address, operation.address(), removed));
  }

  private void move(State state, Field field, MoveItem operation) {
    protect(field);
    if (!"list".equals(field.type())) throw problem("LIST_REQUIRED");
    List<String> order = new ArrayList<>(state.itemOrder.getOrDefault(operation.address(), field.fixedItemIds()));
    if (!order.remove(operation.itemId())) throw problem("ITEM_NOT_FOUND");
    if (operation.beforeItemId() == null) order.add(operation.itemId());
    else {
      int target = order.indexOf(operation.beforeItemId());
      if (target < 0) throw problem("ITEM_NOT_FOUND");
      order.add(target, operation.itemId());
    }
    state.itemOrder.put(operation.address(), List.copyOf(order));
  }

  private Field resolve(Address address) {
    Field field = roots.get(address.fieldId());
    if (address.rowPath().isEmpty()) {
      if (field == null) throw problem("UNKNOWN_FIELD");
      return field;
    }
    Field list = roots.get(address.rowPath().get(0).listFieldId());
    if (list == null || !"list".equals(list.type())) throw problem("ROW_PATH_INVALID");
    for (int i = 0; i < address.rowPath().size(); i++) {
      RowSegment segment = address.rowPath().get(i);
      if (!list.id().equals(segment.listFieldId())) throw problem("ROW_PATH_INVALID");
      if (i == address.rowPath().size() - 1) {
        Field child = list.children().get(address.fieldId());
        if (child == null) throw problem("UNKNOWN_FIELD");
        return child;
      }
      String nextListId = address.rowPath().get(i + 1).listFieldId();
      list = list.children().get(nextListId);
      if (list == null || !"list".equals(list.type())) throw problem("ROW_PATH_INVALID");
    }
    throw problem("ROW_PATH_INVALID");
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
          OffsetDateTime.parse(value.path("instant").textValue());
          java.time.ZoneId.of(value.path("timeZone").textValue());
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
  }

  private void validateChoices(Field field, JsonNode value) {
    if (!value.isArray()) throw problem("INVALID_LITERAL");
    Set<String> seen = new HashSet<>();
    for (JsonNode choice : value) {
      if (!choice.isTextual() || !seen.add(choice.textValue())
          || (!field.optionIds().isEmpty() && !field.optionIds().contains(choice.textValue())))
        throw problem("OPTION_INVALID");
    }
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
    if (value == null || value.isBlank() || value.length() > 200) throw problem(code);
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
