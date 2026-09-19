package com.kodeboxx.smartintake.contract.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kodeboxx.smartintake.contract.compiler.FormCompiler;
import com.kodeboxx.smartintake.contract.runtime.RuntimeGraph.FieldProjection;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.*;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Component;

/** Transaction-neutral canonical package mutation and projection boundary. */
@Component
public final class TypedSessionRuntimeService {
  public record Outcome(
      Map<String, Object> answers,
      List<Map<String, Object>> validation,
      List<String> reachablePageIds,
      int requiredCount,
      int completedRequiredCount,
      boolean accepted) {
    public Outcome {
      answers = Map.copyOf(answers);
      validation = List.copyOf(validation);
      reachablePageIds = List.copyOf(reachablePageIds);
    }
  }

  private final ObjectMapper json;
  private final FormCompiler compiler;

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
    var compilation = compiler.compile(packageNode);
    if (!compilation.valid()) {
      return new Outcome(Map.of(), compilation.diagnostics().stream().map(diagnostic -> Map.<String, Object>of(
          "code", diagnostic.code(), "pointer", diagnostic.pointer())).toList(), List.of(), 0, 0, false);
    }
    var compiled = compilation.compiled().orElseThrow();
    var runtime = new CompiledRuntimeFactory().create(compiled);
    State state;
    try {
      state = currentAnswers == null || currentAnswers.isEmpty()
          ? runtime.initialize() : runtime.fromProjection(currentAnswers);
    } catch (IllegalArgumentException invalid) {
      return rejected(currentAnswers, "PROJECTION_INVALID", null);
    }
    List<Operation> operations = new ArrayList<>();
    try {
      for (Map<String, Object> raw : rawOperations == null ? List.<Map<String, Object>>of() : rawOperations) {
        operations.add(operation(raw));
      }
    } catch (IllegalArgumentException invalid) {
      return rejected(currentAnswers, invalid.getMessage(), null);
    }
    Result mutation = runtime.apply(state, operations, changedAt);
    if (!mutation.accepted()) {
      List<Map<String, Object>> validation = mutation.diagnostics().stream().map(diagnostic -> Map.<String, Object>of(
          "code", diagnostic.code(),
          "fieldId", diagnostic.fieldId(),
          "pointer", diagnostic.pointer(),
          "rowPath", diagnostic.rowPath())).toList();
      return new Outcome(asMap(runtime.projection(state)), validation, List.of(), 0, 0, false);
    }
    RuntimeGraph.Projection projection = new RuntimeGraph(compiled, runtime)
        .evaluate(mutation.state(), sessionDate, timeZone, changedAt);
    List<Map<String, Object>> validation = new ArrayList<>();
    projection.fields().forEach((fieldId, field) -> {
      if (field.required() && field.status() != Status.answered
          && field.status() != Status.declined && field.status() != Status.respondentNotApplicable) {
        validation.add(Map.of("code", "REQUIRED", "fieldId", fieldId, "pointer", "/answers/" + fieldId));
      }
    });
    projection.diagnostics().forEach(diagnostic -> validation.add(Map.of(
        "code", diagnostic.code(),
        "fieldId", diagnostic.fieldId() == null ? "" : diagnostic.fieldId(),
        "expressionId", diagnostic.expressionId() == null ? "" : diagnostic.expressionId())));
    return new Outcome(asMap(runtime.projection(projection.state())), validation,
        projection.reachablePageIds(), projection.requiredCount(), projection.completedRequiredCount(), true);
  }

  private Outcome rejected(JsonNode answers, String code, String fieldId) {
    Map<String, Object> validation = new LinkedHashMap<>();
    validation.put("code", code == null ? "MUTATION_INVALID" : code);
    if (fieldId != null) validation.put("fieldId", fieldId);
    return new Outcome(answers == null || !answers.isObject() ? Map.of() : asMap(answers),
        List.of(validation), List.of(), 0, 0, false);
  }

  private Operation operation(Map<String, Object> raw) {
    String kind = Objects.toString(raw.get("op"), "");
    Address address = new Address(Objects.toString(raw.get("fieldId"), ""), rowPath(raw.get("rowPath")));
    return switch (kind) {
      case "set" -> {
        JsonNode value = json.valueToTree(raw.get("value"));
        if (value.isObject() && value.has("status")) {
          Status status = Status.valueOf(value.path("status").asText());
          yield new SetValue(address, status, status == Status.answered ? value.get("value") : null);
        }
        yield new SetValue(address, Status.answered, value);
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
