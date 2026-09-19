package com.kodeboxx.smartintake.contract.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.kodeboxx.smartintake.contract.ExpressionEngine;
import com.kodeboxx.smartintake.contract.compiler.CompiledForm;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.*;
import java.time.Instant;
import java.util.*;

/** Deterministic applicability, requiredness, calculation, and progress graph. */
public final class RuntimeGraph {
  public record FieldProjection(boolean applicable, boolean required, Status status) {}
  public record Diagnostic(String code, String fieldId, String expressionId) {}
  public record Projection(
      State state,
      Map<String, FieldProjection> fields,
      List<String> reachablePageIds,
      int requiredCount,
      int completedRequiredCount,
      List<Diagnostic> diagnostics) {
    public Projection {
      fields = Map.copyOf(fields);
      reachablePageIds = List.copyOf(reachablePageIds);
      diagnostics = List.copyOf(diagnostics);
    }
  }

  private final CompiledForm compiled;
  private final TypedAnswerRuntime runtime;
  private final ExpressionEngine expressions = new ExpressionEngine();
  private final ArrayNode definitions;
  private final List<String> evaluationOrder;
  private final List<Diagnostic> compileDiagnostics;

  public RuntimeGraph(CompiledForm compiled, TypedAnswerRuntime runtime) {
    this.compiled = Objects.requireNonNull(compiled, "compiled");
    this.runtime = Objects.requireNonNull(runtime, "runtime");
    this.definitions = definitions(compiled.canonicalPackage().path("data").path("fields"));
    var order = dependencyOrder(compiled);
    this.evaluationOrder = order.order;
    this.compileDiagnostics = order.diagnostics;
  }

  public Projection evaluate(State input, String sessionDate, String timeZone, Instant changedAt) {
    if (!compileDiagnostics.isEmpty()) {
      return new Projection(input, Map.of(), List.of(), 0, 0, compileDiagnostics);
    }
    State state = input;
    Map<String, FieldProjection> projections = new LinkedHashMap<>();
    List<Diagnostic> diagnostics = new ArrayList<>();
    var budget = new ExpressionEngine.MutationBudget(100_000);
    for (String fieldId : evaluationOrder) {
      var field = compiled.fields().get(fieldId);
      if (field == null || field.repeaterDepth() > 0) continue;
      JsonNode source = field.source();
      boolean applicable = evaluateBoolean(
          source.path("visibilityExpressionId").asText(null), state, sessionDate, timeZone, budget,
          true, fieldId, diagnostics);
      state = runtime.projectApplicability(state, Map.of(new Address(fieldId, List.of()), applicable), changedAt);
      boolean required = applicable && (source.path("required").asBoolean(false)
          || evaluateBoolean(source.path("requiredExpressionId").asText(null), state, sessionDate, timeZone,
              budget, false, fieldId, diagnostics));
      if (applicable && field.protectedValue() && source.path("calculated").asBoolean(false)) {
        String expressionId = expressionReference(source.path("calculation").path("expressionRef"));
        JsonNode expression = compiled.expressions().get(expressionId);
        if (expression == null) diagnostics.add(new Diagnostic("CALCULATION_EXPRESSION_MISSING", fieldId, expressionId));
        else {
          ExpressionEngine.Result result = expressions.evaluate(expression,
              context(state, sessionDate, timeZone), budget);
          if ("available".equals(result.state())) {
            Cell calculated = new Cell(field.type(), Status.answered, Provenance.calculated,
                result.value(), changedAt, false);
            try {
              state = runtime.projectServerCells(state, Map.of(new Address(fieldId, List.of()), calculated));
            } catch (IllegalArgumentException invalid) {
              diagnostics.add(new Diagnostic(invalid.getMessage(), fieldId, expressionId));
            }
          } else if ("unknown".equals(result.state())) {
            state = runtime.projectServerCells(state, Map.of(new Address(fieldId, List.of()),
                new Cell(field.type(), Status.unknown, Provenance.calculated, null, changedAt, false)));
          } else diagnostics.add(new Diagnostic(result.code(), fieldId, expressionId));
        }
      }
      Cell cell = state.cells().get(new Address(fieldId, List.of()));
      projections.put(fieldId, new FieldProjection(applicable, required,
          cell == null ? Status.unanswered : cell.status()));
    }
    int required = (int) projections.values().stream().filter(FieldProjection::required).count();
    int complete = (int) projections.values().stream()
        .filter(FieldProjection::required)
        .filter(field -> field.status() == Status.answered
            || field.status() == Status.declined
            || field.status() == Status.respondentNotApplicable)
        .count();
    return new Projection(state, projections, reachablePages(state, sessionDate, timeZone, budget, diagnostics),
        required, complete, diagnostics);
  }

  private boolean evaluateBoolean(
      String expressionId,
      State state,
      String sessionDate,
      String timeZone,
      ExpressionEngine.MutationBudget budget,
      boolean missingDefault,
      String fieldId,
      List<Diagnostic> diagnostics) {
    if (expressionId == null || expressionId.isBlank()) return missingDefault;
    JsonNode expression = compiled.expressions().get(expressionId);
    if (expression == null) {
      diagnostics.add(new Diagnostic("EXPRESSION_MISSING", fieldId, expressionId));
      return false;
    }
    ExpressionEngine.Result result = expressions.evaluate(expression, context(state, sessionDate, timeZone), budget);
    if ("available".equals(result.state()) && "boolean".equals(result.type())) return result.value().booleanValue();
    if ("unknown".equals(result.state())) return false;
    diagnostics.add(new Diagnostic(result.code() == null ? "BOOLEAN_EXPRESSION_REQUIRED" : result.code(),
        fieldId, expressionId));
    return false;
  }

  private ExpressionEngine.EvaluationContext context(State state, String sessionDate, String timeZone) {
    return ExpressionEngine.projection(definitions, runtime.projection(state), sessionDate, timeZone, 100_000);
  }

  private List<String> reachablePages(
      State state,
      String sessionDate,
      String timeZone,
      ExpressionEngine.MutationBudget budget,
      List<Diagnostic> diagnostics) {
    if (compiled.pages().isEmpty()) return List.of();
    Map<String, JsonNode> sources = new LinkedHashMap<>();
    for (JsonNode phase : compiled.canonicalPackage().path("flow").path("phases"))
      for (JsonNode page : phase.path("pages")) sources.put(page.path("id").asText(), page);
    List<String> result = new ArrayList<>();
    String current = compiled.canonicalPackage().path("flow").path("startPageId").asText();
    Set<String> visited = new HashSet<>();
    while (!current.isBlank() && visited.add(current)) {
      result.add(current);
      JsonNode page = sources.get(current);
      if (page == null) break;
      String next = null;
      for (JsonNode route : page.path("routes")) {
        String expressionId = route.path("whenExpressionId").asText(null);
        if (evaluateBoolean(expressionId, state, sessionDate, timeZone, budget, false,
            null, diagnostics)) {
          next = route.path("targetPageId").asText();
          break;
        }
      }
      if (next == null) next = page.path("defaultNextPageId").asText("");
      current = next;
    }
    return result;
  }

  private static ArrayNode definitions(JsonNode fields) {
    ArrayNode result = JsonNodeFactory.instance.arrayNode();
    for (JsonNode field : fields) result.add(definition(field));
    return result;
  }

  private static ObjectNode definition(JsonNode field) {
    ObjectNode result = JsonNodeFactory.instance.objectNode();
    result.put("id", field.path("id").asText());
    result.put("type", field.path("type").asText());
    JsonNode children = "object".equals(field.path("type").asText())
        ? field.path("fields") : field.path("itemSchema").path("fields");
    if (children.isArray()) {
      ArrayNode itemFields = result.putArray("itemFields");
      for (JsonNode child : children) itemFields.add(definition(child));
    }
    return result;
  }

  private static String expressionReference(JsonNode reference) {
    String value = reference.asText("");
    return value.startsWith("#/expressions/") ? value.substring("#/expressions/".length()) : value;
  }

  private static Order dependencyOrder(CompiledForm compiled) {
    Map<String, Set<String>> dependencies = new TreeMap<>();
    compiled.fields().forEach((id, field) -> {
      Set<String> refs = new TreeSet<>();
      JsonNode source = field.source();
      for (String binding : List.of("visibilityExpressionId", "requiredExpressionId", "validationExpressionId")) {
        String expressionId = source.path(binding).asText(null);
        if (expressionId != null) collectReferences(compiled.expressions().get(expressionId), refs);
      }
      collectReferences(compiled.expressions().get(expressionReference(
          source.path("calculation").path("expressionRef"))), refs);
      refs.retainAll(compiled.fields().keySet());
      dependencies.put(id, refs);
    });
    List<String> order = new ArrayList<>();
    List<Diagnostic> diagnostics = new ArrayList<>();
    Set<String> visiting = new HashSet<>(), visited = new HashSet<>();
    for (String field : dependencies.keySet()) visit(field, dependencies, visiting, visited, order, diagnostics);
    return new Order(order, diagnostics);
  }

  private static void visit(
      String field,
      Map<String, Set<String>> dependencies,
      Set<String> visiting,
      Set<String> visited,
      List<String> order,
      List<Diagnostic> diagnostics) {
    if (visited.contains(field)) return;
    if (!visiting.add(field)) {
      diagnostics.add(new Diagnostic("DEPENDENCY_CYCLE", field, null));
      return;
    }
    for (String dependency : dependencies.getOrDefault(field, Set.of()))
      visit(dependency, dependencies, visiting, visited, order, diagnostics);
    visiting.remove(field);
    visited.add(field);
    order.add(field);
  }

  private static void collectReferences(JsonNode expression, Set<String> references) {
    if (expression == null || expression.isMissingNode()) return;
    if (expression.isObject()) {
      if (expression.path("ref").path("fieldId").isTextual())
        references.add(expression.path("ref").path("fieldId").asText());
      expression.fields().forEachRemaining(entry -> collectReferences(entry.getValue(), references));
    } else if (expression.isArray()) expression.forEach(value -> collectReferences(value, references));
  }

  private record Order(List<String> order, List<Diagnostic> diagnostics) {}
}
