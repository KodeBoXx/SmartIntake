package com.kodeboxx.smartintake.contract.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.kodeboxx.smartintake.contract.CanonicalJson;
import com.kodeboxx.smartintake.contract.compiler.CompiledForm;
import com.kodeboxx.smartintake.contract.compiler.FormCompiler;
import com.kodeboxx.smartintake.contract.runtime.RuntimeGraph.FieldProjection;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.*;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Component;

/** Transaction-neutral canonical package mutation and projection boundary. */
@Component
public final class TypedSessionRuntimeService {
  public static final int MAX_OPERATIONS_PER_BATCH = 1_000;

  public record Outcome(
      Map<String, Object> answers,
      Map<String, Object> runtimeState,
      List<Map<String, Object>> validation,
      Map<String, Object> reviewProjection,
      String reviewDigest,
      List<String> reachablePageIds,
      int requiredCount,
      int completedRequiredCount,
      boolean accepted) {
    public Outcome {
      answers = Map.copyOf(answers);
      runtimeState = Map.copyOf(runtimeState);
      validation = List.copyOf(validation);
      reviewProjection = Map.copyOf(reviewProjection);
      reachablePageIds = List.copyOf(reachablePageIds);
    }
  }

  private final ObjectMapper json;
  private final FormCompiler compiler;
  private final ReviewProjectionService reviews = new ReviewProjectionService();
  private final Map<String, CompiledForm> compiledCache = Collections.synchronizedMap(
      new LinkedHashMap<>(128, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, CompiledForm> eldest) {
          return size() > 128;
        }
      });

  public TypedSessionRuntimeService(ObjectMapper json, FormCompiler compiler) {
    this.json = json;
    this.compiler = compiler;
  }

  public boolean canonical(JsonNode candidate) {
    return candidate != null && candidate.isObject()
        && candidate.has("schemaVersion") && candidate.has("engineContract") && candidate.has("data");
  }

  public Outcome mutate(
      JsonNode packageNode,
      JsonNode currentAnswers,
      List<Map<String, Object>> rawOperations,
      String sessionDate,
      String timeZone,
      Instant changedAt) {
    return mutate(packageNode, currentAnswers, null, rawOperations, null,
        sessionDate, timeZone, packageNode.path("defaultLocale").asText("en"), changedAt);
  }

  public Outcome mutate(
      JsonNode packageNode,
      JsonNode currentAnswers,
      JsonNode currentRuntimeState,
      List<Map<String, Object>> rawOperations,
      String currentPageId,
      String sessionDate,
      String timeZone,
      String locale,
      Instant changedAt) {
    return mutateLocalized(packageNode, currentAnswers, currentRuntimeState, rawOperations, currentPageId,
        sessionDate, timeZone, locale, changedAt);
  }

  public Outcome mutate(
      JsonNode packageNode,
      JsonNode currentAnswers,
      JsonNode currentRuntimeState,
      List<Map<String, Object>> rawOperations,
      String sessionDate,
      String timeZone,
      Instant changedAt) {
    return mutate(packageNode, currentAnswers, currentRuntimeState, rawOperations, null,
        sessionDate, timeZone, packageNode.path("defaultLocale").asText("en"), changedAt);
  }

  public Outcome mutate(
      JsonNode packageNode,
      JsonNode currentAnswers,
      JsonNode currentRuntimeState,
      List<Map<String, Object>> rawOperations,
      String currentPageId,
      String sessionDate,
      String timeZone,
      Instant changedAt) {
    return mutate(packageNode, currentAnswers, currentRuntimeState, rawOperations, currentPageId,
        sessionDate, timeZone, packageNode.path("defaultLocale").asText("en"), changedAt);
  }

  private Outcome mutateLocalized(
      JsonNode packageNode,
      JsonNode currentAnswers,
      JsonNode currentRuntimeState,
      List<Map<String, Object>> rawOperations,
      String currentPageId,
      String sessionDate,
      String timeZone,
      String locale,
      Instant changedAt) {
    var compilation = compiler.compile(packageNode);
    if (!compilation.valid()) {
      return new Outcome(Map.of(), Map.of(), compilation.diagnostics().stream().map(diagnostic -> Map.<String, Object>of(
          "code", diagnostic.code(), "pointer", diagnostic.pointer())).toList(), Map.of(), null,
          List.of(), 0, 0, false);
    }
    String packageDigest = CanonicalJson.sha256(packageNode);
    var compiled = compiledCache.computeIfAbsent(packageDigest, ignored -> compilation.compiled().orElseThrow());
    var runtime = new CompiledRuntimeFactory().create(compiled);
    State state;
    try {
      state = currentRuntimeState != null && !currentRuntimeState.isNull() && !currentRuntimeState.isEmpty()
          ? runtime.fromStorage(currentRuntimeState)
          : currentAnswers == null || currentAnswers.isEmpty()
              ? runtime.initialize(changedAt) : runtime.fromProjection(currentAnswers);
    } catch (IllegalArgumentException invalid) {
      return rejected(currentAnswers, currentRuntimeState, "RUNTIME_STATE_INVALID", null);
    }
    if (rawOperations != null && rawOperations.size() > MAX_OPERATIONS_PER_BATCH)
      return rejected(currentAnswers, currentRuntimeState, "OPERATION_LIMIT", null);
    List<Operation> operations = new ArrayList<>();
    try {
      for (Map<String, Object> raw : rawOperations == null ? List.<Map<String, Object>>of() : rawOperations) {
        operations.add(operation(raw));
      }
    } catch (IllegalArgumentException invalid) {
      return rejected(currentAnswers, currentRuntimeState, invalid.getMessage(), null);
    }
    Result mutation = runtime.apply(state, operations, changedAt);
    if (!mutation.accepted()) {
      List<Map<String, Object>> validation = mutation.diagnostics().stream().map(diagnostic -> {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("code", diagnostic.code());
        if (diagnostic.fieldId() != null) item.put("fieldId", diagnostic.fieldId());
        item.put("pointer", diagnostic.pointer());
        item.put("rowPath", diagnostic.rowPath());
        return Map.copyOf(item);
      }).toList();
      return new Outcome(asMap(runtime.projection(state)), asMap(runtime.storage(state)), validation,
          Map.of(), null, List.of(), 0, 0, false);
    }
    RuntimeGraph.Projection projection = new RuntimeGraph(compiled, runtime)
        .evaluate(mutation.state(), sessionDate, timeZone, changedAt);
    List<Map<String, Object>> validation = new ArrayList<>();
    projection.addresses().forEach((address, field) -> {
      Cell cell = projection.state().cells().get(address);
      boolean blankText = field.required() && cell != null && cell.status() == Status.answered
          && cell.value() != null && cell.value().isTextual() && cell.value().textValue().isBlank();
      if (field.required() && (blankText || field.status() != Status.answered
          && field.status() != Status.declined && field.status() != Status.respondentNotApplicable)) {
        validation.add(Map.of("code", "REQUIRED", "fieldId", address.fieldId(),
            "rowPath", address.rowPath(), "pointer", "/answers/" + address.fieldId()));
      }
    });
    projection.diagnostics().forEach(diagnostic -> validation.add(Map.of(
        "code", diagnostic.code(),
        "fieldId", diagnostic.fieldId() == null ? "" : diagnostic.fieldId(),
        "expressionId", diagnostic.expressionId() == null ? "" : diagnostic.expressionId())));
    projection.state().cells().forEach((address, cell) -> {
      if (cell.needsReentry() && cell.status() != Status.notApplicable) {
        validation.add(Map.of(
            "code", "UNPARSEABLE_INPUT",
            "fieldId", address.fieldId(),
            "rowPath", address.rowPath(),
            "markedAt", cell.changedAt().toString(),
            "pointer", "/answers/" + address.fieldId()));
      }
    });
    ObjectNode stored = runtime.storage(projection.state());
    String previousPage = currentRuntimeState != null && currentRuntimeState.path("currentPageId").isTextual()
        ? currentRuntimeState.path("currentPageId").asText() : projection.reachablePageIds().stream().findFirst().orElse(null);
    String effectivePage = authoritativePage(projection.reachablePageIds(), previousPage, currentPageId);
    if (effectivePage != null) stored.put("currentPageId", effectivePage);
    Set<String> completedPageIds = completedPages(compiled, projection, validation,
        currentRuntimeState, effectivePage);
    ArrayNode completedStored = stored.putArray("completedPageIds");
    completedPageIds.forEach(completedStored::add);
    int completedPages = completedPageIds.size();
    var review = reviews.project(compiled, projection.state(), sessionDate, timeZone);
    Map<String, Object> reviewMap = json.convertValue(review, Map.class);
    enrichAcknowledgmentRows(reviewMap, compiled.canonicalPackage(), locale);
    localizeReviewRows(reviewMap, compiled.canonicalPackage(), locale);
    String reviewDigest = validation.isEmpty()
        ? CanonicalJson.sha256(json.valueToTree(reviewMap)) : null;
    return new Outcome(asMap(runtime.projection(projection.state())), asMap(stored), validation,
        reviewMap, reviewDigest, projection.reachablePageIds(), projection.requiredCount(), completedPages, true);
  }

  private static Set<String> completedPages(
      CompiledForm compiled, RuntimeGraph.Projection projection, List<Map<String, Object>> validation,
      JsonNode currentRuntimeState, String currentPageId) {
    LinkedHashSet<String> candidates = new LinkedHashSet<>();
    if (currentRuntimeState != null)
      currentRuntimeState.path("completedPageIds").forEach(node -> candidates.add(node.asText()));
    String previousPage = currentRuntimeState != null && currentRuntimeState.path("currentPageId").isTextual()
        ? currentRuntimeState.path("currentPageId").asText() : projection.reachablePageIds().stream().findFirst().orElse(null);
    int previous = previousPage == null ? -1 : projection.reachablePageIds().indexOf(previousPage);
    int current = currentPageId == null ? previous : projection.reachablePageIds().indexOf(currentPageId);
    if (previous >= 0 && current == previous + 1) candidates.add(previousPage);
    candidates.retainAll(projection.reachablePageIds());
    candidates.removeAll(compiled.reviewPageIds());
    Map<String, Set<String>> pageFields = pageFields(compiled.canonicalPackage());
    Set<String> globalErrors = validation.stream()
        .filter(item -> Objects.toString(item.get("fieldId"), "").isBlank())
        .map(item -> Objects.toString(item.get("code"), "")).collect(java.util.stream.Collectors.toSet());
    if (!globalErrors.isEmpty()) return Set.of();
    candidates.removeIf(pageId -> {
      Set<String> fields = pageFields.getOrDefault(pageId, Set.of());
      boolean invalid = validation.stream().anyMatch(item -> fields.contains(Objects.toString(item.get("fieldId"), "")));
      boolean incomplete = projection.addresses().entrySet().stream().anyMatch(entry ->
          fields.contains(entry.getKey().fieldId()) && entry.getValue().applicable()
              && entry.getValue().required() && entry.getValue().status() != Status.answered
              && entry.getValue().status() != Status.declined
              && entry.getValue().status() != Status.respondentNotApplicable);
      return invalid || incomplete;
    });
    return Collections.unmodifiableSet(new LinkedHashSet<>(candidates));
  }

  private static String authoritativePage(List<String> reachable, String previousPage, String requestedPage) {
    if (reachable.isEmpty()) return null;
    int previous = reachable.indexOf(previousPage);
    if (previous < 0) return reachable.get(0);
    if (requestedPage == null || requestedPage.isBlank() || requestedPage.equals(previousPage)) return previousPage;
    int requested = reachable.indexOf(requestedPage);
    return requested == previous + 1 || requested == previous - 1 ? requestedPage : previousPage;
  }

  private static Map<String, Set<String>> pageFields(JsonNode packageNode) {
    Map<String, Set<String>> result = new LinkedHashMap<>();
    for (JsonNode phase : packageNode.path("flow").path("phases"))
      for (JsonNode page : phase.path("pages")) {
        LinkedHashSet<String> fields = new LinkedHashSet<>();
        for (JsonNode section : page.path("sections"))
          for (JsonNode node : section.path("nodes")) collectPageFields(node, fields);
        result.put(page.path("id").asText(), Set.copyOf(fields));
      }
    return result;
  }

  private static void collectPageFields(JsonNode node, Set<String> fields) {
    if (node.path("fieldId").isTextual()) fields.add(node.path("fieldId").asText());
    for (JsonNode child : node.path("children")) collectPageFields(child, fields);
  }

  @SuppressWarnings("unchecked")
  private void localizeReviewRows(Map<String, Object> review, JsonNode packageNode, String locale) {
    if (locale == null || locale.isBlank()) locale = packageNode.path("defaultLocale").asText("en");
    JsonNode messages = packageNode.path("translations").path(locale).path("messages");
    Map<String, JsonNode> fields = new LinkedHashMap<>();
    collectFieldDefinitions(packageNode.path("data").path("fields"), fields);
    localizeRows(review.get("answers"), messages, fields);
    localizeRows(review.get("reviewGates"), messages, fields);
  }

  @SuppressWarnings("unchecked")
  private void localizeRows(Object raw, JsonNode messages, Map<String, JsonNode> fields) {
    if (!(raw instanceof List<?> rows)) return;
    for (Object item : rows) {
      if (!(item instanceof Map<?, ?> source)) continue;
      Map<String, Object> row = (Map<String, Object>) source;
      String key = Objects.toString(row.get("label"), "");
      if (messages.path(key).isTextual()) row.put("label", messages.path(key).asText());
      JsonNode field = fields.get(Objects.toString(row.get("fieldId"), ""));
      if (field != null && "answered".equals(Objects.toString(row.get("status"), ""))) {
        String type = field.path("type").asText();
        if ("attachments".equals(type) || "drawing".equals(type)) row.put("value", "Ready");
        else if (("choice".equals(type) || "multiChoice".equals(type)) && row.get("value") != null) {
          Map<String, String> options = new LinkedHashMap<>();
          for (JsonNode option : field.path("options")) {
            String id = option.path("id").asText(); String labelKey = option.path("labelKey").asText();
            options.put(id, messages.path(labelKey).isTextual() ? messages.path(labelKey).asText() : id);
          }
          if (row.get("value") instanceof List<?> values) row.put("value", values.stream().map(value -> options.getOrDefault(value.toString(), value.toString())).toList());
          else row.put("value", options.getOrDefault(row.get("value").toString(), row.get("value").toString()));
        }
      }
      localizeRows(row.get("children"), messages, fields);
    }
  }

  private void collectFieldDefinitions(JsonNode source, Map<String, JsonNode> fields) {
    if (!source.isArray()) return;
    for (JsonNode field : source) {
      fields.put(field.path("id").asText(), field);
      collectFieldDefinitions(field.path("fields"), fields);
      collectFieldDefinitions(field.path("itemSchema").path("fields"), fields);
    }
  }

  @SuppressWarnings("unchecked")
  private void enrichAcknowledgmentRows(Map<String, Object> review, JsonNode packageNode, String locale) {
    if (locale == null || locale.isBlank()) locale = packageNode.path("defaultLocale").asText("en");
    JsonNode messages = packageNode.path("translations").path(locale).path("messages");
    Object gates = review.get("reviewGates");
    if (!(gates instanceof List<?> rows)) return;
    for (Object raw : rows) {
      if (!(raw instanceof Map<?, ?> source)) continue;
      Map<String, Object> row = (Map<String, Object>) source;
      String contentKey = Objects.toString(row.get("label"), Objects.toString(row.get("fieldId"), ""));
      JsonNode localized = messages.path(contentKey);
      if (!localized.isTextual()) throw new IllegalArgumentException("ACKNOWLEDGMENT_CONTENT_MISSING");
      String content = localized.asText();
      row.put("locale", locale);
      row.put("contentKey", contentKey);
      row.put("content", content);
      row.put("contentHash", CanonicalJson.sha256(json.valueToTree(Map.of(
          "locale", locale, "contentKey", contentKey, "text", content))));
    }
  }

  private Outcome rejected(JsonNode answers, JsonNode runtimeState, String code, String fieldId) {
    Map<String, Object> validation = new LinkedHashMap<>();
    validation.put("code", code == null ? "MUTATION_INVALID" : code);
    if (fieldId != null) validation.put("fieldId", fieldId);
    return new Outcome(answers == null || !answers.isObject() ? Map.of() : asMap(answers),
        runtimeState == null || !runtimeState.isObject() ? Map.of() : asMap(runtimeState),
        List.of(validation), Map.of(), null, List.of(), 0, 0, false);
  }

  private Operation operation(Map<String, Object> raw) {
    String kind = Objects.toString(raw.get("op"), "");
    Address address = new Address(Objects.toString(raw.get("fieldId"), ""), rowPath(raw.get("rowPath")));
    return switch (kind) {
      case "set" -> {
        Object supplied = raw.containsKey("answer") ? raw.get("answer") : raw.get("value");
        JsonNode answer = json.valueToTree(supplied);
        if (answer.isObject() && answer.has("status")) {
          Status status = Status.valueOf(answer.path("status").asText());
          yield new SetValue(address, status, status == Status.answered ? answer.get("value") : null);
        }
        yield new SetValue(address, Status.answered, answer);
      }
      case "clear" -> new Clear(address);
      case "markInvalid" -> {
        if (!"UNPARSEABLE_INPUT".equals(Objects.toString(raw.get("reason"), "")))
          throw new IllegalArgumentException("INVALID_MARKER_CODE");
        yield new MarkInvalid(address);
      }
      case "addItem" -> new AddItem(address, Objects.toString(raw.get("itemId"), ""), initialCells(raw, address));
      case "removeItem" -> new RemoveItem(address, Objects.toString(raw.get("itemId"), ""));
      case "moveItem" -> new MoveItem(address, Objects.toString(raw.get("itemId"), ""),
          raw.get("beforeItemId") == null ? null : Objects.toString(raw.get("beforeItemId")));
      default -> throw new IllegalArgumentException("OPERATION_UNSUPPORTED");
    };
  }

  @SuppressWarnings("unchecked")
  private List<RowSegment> rowPath(Object raw) {
    if (raw == null) return List.of();
    if (!(raw instanceof List<?> values)) throw new IllegalArgumentException("ROW_PATH_INVALID");
    List<RowSegment> result = new ArrayList<>();
    for (Object value : values) {
      if (!(value instanceof Map<?, ?> segment)) throw new IllegalArgumentException("ROW_PATH_INVALID");
      result.add(new RowSegment(Objects.toString(segment.get("listFieldId"), ""),
          Objects.toString(segment.get("itemId"), "")));
    }
    return result;
  }

  @SuppressWarnings("unchecked")
  private Map<String, SetValue> initialCells(Map<String, Object> raw, Address listAddress) {
    Object fieldsValue = raw.containsKey("initialFields") ? raw.get("initialFields") : raw.get("fields");
    if (!(fieldsValue instanceof Map<?, ?> fields)) return Map.of();
    Map<String, SetValue> result = new LinkedHashMap<>();
    fields.forEach((key, value) -> {
      JsonNode cell = json.valueToTree(value);
      Status status = Status.valueOf(cell.path("status").asText("answered"));
      result.put(key.toString(), new SetValue(listAddress, status,
          status == Status.answered && cell.has("value") ? cell.get("value") : cell));
    });
    return result;
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> asMap(JsonNode node) {
    return json.convertValue(node, Map.class);
  }
}
