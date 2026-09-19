package com.kodeboxx.smartintake.contract.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
      List<String> reachablePageIds,
      int requiredCount,
      int completedRequiredCount,
      boolean accepted) {
    public Outcome {
      answers = Map.copyOf(answers);
      runtimeState = Map.copyOf(runtimeState);
      validation = List.copyOf(validation);
      reachablePageIds = List.copyOf(reachablePageIds);
    }
  }

  private final ObjectMapper json;
  private final FormCompiler compiler;
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
    return mutate(packageNode, currentAnswers, null, rawOperations, sessionDate, timeZone, changedAt);
  }

  public Outcome mutate(
      JsonNode packageNode,
      JsonNode currentAnswers,
      JsonNode currentRuntimeState,
      List<Map<String, Object>> rawOperations,
      String sessionDate,
      String timeZone,
      Instant changedAt) {
    var compilation = compiler.compile(packageNode);
    if (!compilation.valid()) {
      return new Outcome(Map.of(), Map.of(), compilation.diagnostics().stream().map(diagnostic -> Map.<String, Object>of(
          "code", diagnostic.code(), "pointer", diagnostic.pointer())).toList(), List.of(), 0, 0, false);
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
      List<Map<String, Object>> validation = mutation.diagnostics().stream().map(diagnostic -> Map.<String, Object>of(
          "code", diagnostic.code(),
          "fieldId", diagnostic.fieldId(),
          "pointer", diagnostic.pointer(),
          "rowPath", diagnostic.rowPath())).toList();
      return new Outcome(asMap(runtime.projection(state)), asMap(runtime.storage(state)), validation,
          List.of(), 0, 0, false);
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
            "pointer", "/answers/" + address.fieldId()));
      }
    });
    return new Outcome(asMap(runtime.projection(projection.state())),
        asMap(runtime.storage(projection.state())), validation,
        projection.reachablePageIds(), projection.requiredCount(), projection.completedRequiredCount(), true);
  }

  private Outcome rejected(JsonNode answers, JsonNode runtimeState, String code, String fieldId) {
    Map<String, Object> validation = new LinkedHashMap<>();
    validation.put("code", code == null ? "MUTATION_INVALID" : code);
    if (fieldId != null) validation.put("fieldId", fieldId);
    return new Outcome(answers == null || !answers.isObject() ? Map.of() : asMap(answers),
        runtimeState == null || !runtimeState.isObject() ? Map.of() : asMap(runtimeState),
        List.of(validation), List.of(), 0, 0, false);
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
      case "markInvalid" -> new MarkInvalid(address);
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
    Object fieldsValue = raw.get("fields");
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
