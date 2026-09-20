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
      Map<Address, FieldProjection> addresses,
      List<String> reachablePageIds,
      int requiredCount,
      int completedRequiredCount,
      List<Diagnostic> diagnostics) {
    public Projection {
      fields = Map.copyOf(fields);
      addresses = Map.copyOf(addresses);
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
  private final Map<String, List<Placement>> placements;

  public RuntimeGraph(CompiledForm compiled, TypedAnswerRuntime runtime) {
    this.compiled = Objects.requireNonNull(compiled, "compiled");
    this.runtime = Objects.requireNonNull(runtime, "runtime");
    this.definitions = definitions(compiled.canonicalPackage().path("data").path("fields"));
    var order = dependencyOrder(compiled);
    this.evaluationOrder = order.order;
    this.compileDiagnostics = order.diagnostics;
    this.placements = placements(compiled.canonicalPackage());
  }

  public Projection evaluate(State input, String sessionDate, String timeZone, Instant changedAt) {
    return evaluate(input, sessionDate, timeZone, changedAt, true);
  }

  private Projection evaluate(
      State input, String sessionDate, String timeZone, Instant changedAt, boolean allowRouteRerun) {
    if (!compileDiagnostics.isEmpty()) {
      return new Projection(input, Map.of(), Map.of(), List.of(), 0, 0, compileDiagnostics);
    }
    State state = input;
    Map<String, FieldProjection> projections = new LinkedHashMap<>();
    Map<Address, FieldProjection> addressProjections = new LinkedHashMap<>();
    List<Diagnostic> diagnostics = new ArrayList<>();
    var budget = new ExpressionEngine.MutationBudget(100_000);
    List<String> initiallyReachable = reachablePages(state, sessionDate, timeZone, budget, diagnostics);
    Map<String, Integer> orderIndex = new HashMap<>();
    for (int index = 0; index < evaluationOrder.size(); index++) orderIndex.put(evaluationOrder.get(index), index);
    for (Target target : targets(state).stream()
        .sorted(Comparator.comparingInt(value -> orderIndex.getOrDefault(value.address.fieldId(), Integer.MAX_VALUE)))
        .toList()) {
      String fieldId = target.address.fieldId();
      var field = compiled.fields().get(fieldId);
      if (field == null) continue;
      JsonNode source = target.source;
      boolean applicable = evaluateBoolean(
          source.path("visibilityExpressionId").asText(null), state, sessionDate, timeZone, budget,
          true, fieldId, diagnostics, target.address);
      applicable = applicable && (field.protectedValue() || placementApplicable(fieldId, initiallyReachable,
          state, sessionDate, timeZone, budget, diagnostics, target.address));
      applicable = applicable && target.ancestorsApplicable && runtime.ancestorsApplicable(state, target.address);
      state = runtime.projectApplicability(state, Map.of(target.address, applicable), changedAt);
      boolean required = applicable && (source.path("required").asBoolean(false)
          || source.path("constraints").path("required").asBoolean(false)
          || evaluateBoolean(source.path("requiredExpressionId").asText(null), state, sessionDate, timeZone,
              budget, false, fieldId, diagnostics, target.address));
      if (applicable && field.protectedValue() && calculationExpressionId(source) != null) {
        String expressionId = calculationExpressionId(source);
        JsonNode expression = compiled.expressions().get(expressionId);
        if (expression == null) diagnostics.add(new Diagnostic("CALCULATION_EXPRESSION_MISSING", fieldId, expressionId));
        else {
          ExpressionEngine.Result result = expressions.evaluate(expression,
              context(state, sessionDate, timeZone, target.address), budget);
          if ("available".equals(result.state())) {
            Cell calculated = new Cell(field.type(), Status.answered, Provenance.calculated,
                result.value(), changedAt, false);
            Cell existing = state.cells().get(target.address);
            if (sameDerivedCell(existing, calculated)) calculated = existing;
            try {
              state = runtime.projectServerCells(state, Map.of(target.address, calculated));
            } catch (IllegalArgumentException invalid) {
              diagnostics.add(new Diagnostic(invalid.getMessage(), fieldId, expressionId));
            }
          } else if ("unknown".equals(result.state())) {
            Cell calculated = new Cell(field.type(), Status.unknown, Provenance.calculated, null, changedAt, false);
            Cell existing = state.cells().get(target.address);
            state = runtime.projectServerCells(state, Map.of(target.address,
                sameDerivedCell(existing, calculated) ? existing : calculated));
          } else diagnostics.add(new Diagnostic(result.code(), fieldId, expressionId));
        }
      }
      Cell cell = state.cells().get(target.address);
      FieldProjection projection = new FieldProjection(applicable, required,
          cell == null ? Status.unanswered : cell.status());
      addressProjections.put(target.address, projection);
      projections.putIfAbsent(fieldId, projection);
      validate(source, cell, applicable, state, sessionDate, timeZone, budget, fieldId,
          target.address, diagnostics);
    }
    List<String> reachable = reachablePages(state, sessionDate, timeZone, budget, diagnostics);
    if (allowRouteRerun && !reachable.equals(initiallyReachable))
      return evaluate(state, sessionDate, timeZone, changedAt, false);
    Set<String> reviewPages = new HashSet<>(compiled.reviewPageIds());
    int answerPages = (int) reachable.stream().filter(page -> !reviewPages.contains(page)).count();
    return new Projection(state, projections, addressProjections, reachable,
        answerPages, 0, diagnostics);
  }

  private static boolean sameDerivedCell(Cell left, Cell right) {
    return left != null && left.type().equals(right.type()) && left.status() == right.status()
        && left.provenance() == right.provenance() && Objects.equals(left.value(), right.value())
        && left.needsReentry() == right.needsReentry();
  }

  private boolean placementApplicable(
      String fieldId,
      List<String> reachable,
      State state,
      String sessionDate,
      String timeZone,
      ExpressionEngine.MutationBudget budget,
      List<Diagnostic> diagnostics,
      Address address) {
    List<Placement> instances = placements.getOrDefault(fieldId, List.of());
    if (instances.isEmpty()) return true;
    for (Placement placement : instances) {
      if (!reachable.contains(placement.pageId)) continue;
      boolean visible = true;
      for (String expressionId : placement.visibilityExpressionIds) {
        if (!evaluateBoolean(expressionId, state, sessionDate, timeZone, budget,
            true, fieldId, diagnostics, address)) {
          visible = false;
          break;
        }
      }
      if (visible) return true;
    }
    return false;
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
    return evaluateBoolean(expressionId, state, sessionDate, timeZone, budget, missingDefault,
        fieldId, diagnostics, null);
  }

  private boolean evaluateBoolean(
      String expressionId,
      State state,
      String sessionDate,
      String timeZone,
      ExpressionEngine.MutationBudget budget,
      boolean missingDefault,
      String fieldId,
      List<Diagnostic> diagnostics,
      Address address) {
    if (expressionId == null || expressionId.isBlank()) return missingDefault;
    JsonNode expression = compiled.expressions().get(expressionId);
    if (expression == null) {
      diagnostics.add(new Diagnostic("EXPRESSION_MISSING", fieldId, expressionId));
      return false;
    }
    ExpressionEngine.Result result = expressions.evaluate(expression,
        context(state, sessionDate, timeZone, address), budget);
    if ("available".equals(result.state()) && "boolean".equals(result.type())) return result.value().booleanValue();
    if ("unknown".equals(result.state())) return false;
    diagnostics.add(new Diagnostic(result.code() == null ? "BOOLEAN_EXPRESSION_REQUIRED" : result.code(),
        fieldId, expressionId));
    return false;
  }

  private ExpressionEngine.EvaluationContext context(State state, String sessionDate, String timeZone) {
    return context(state, sessionDate, timeZone, null);
  }

  private ExpressionEngine.EvaluationContext context(
      State state, String sessionDate, String timeZone, Address address) {
    ObjectNode internalProjection = runtime.projection(state).deepCopy();
    addApplicability(internalProjection);
    if (address != null && !address.rowPath().isEmpty()) {
      return ExpressionEngine.projectionAt(definitions, internalProjection,
          address.rowPath().stream().map(RowSegment::listFieldId).toList(),
          address.rowPath().stream().map(RowSegment::itemId).toList(),
          sessionDate, timeZone, 100_000);
    }
    return ExpressionEngine.projection(definitions, internalProjection, sessionDate, timeZone, 100_000);
  }

  private static void addApplicability(JsonNode fields) {
    if (!fields.isObject()) return;
    fields.fields().forEachRemaining(entry -> {
      JsonNode cell = entry.getValue();
      if (!(cell instanceof ObjectNode object)) return;
      object.put("applicable", !"notApplicable".equals(object.path("status").asText()));
      JsonNode nestedFields = object.path("value").path("fields");
      addApplicability(nestedFields);
      JsonNode items = object.path("value").path("items");
      if (items.isArray()) items.forEach(item -> addApplicability(item.path("fields")));
    });
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
    JsonNode children = field.path("itemSchema").path("fields");
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
      for (String binding : List.of("visibilityExpressionId", "requiredExpressionId")) {
        String expressionId = source.path(binding).asText(null);
        if (expressionId != null) collectReferences(compiled.expressions().get(expressionId), refs);
      }
      String calculation = calculationExpressionId(source);
      if (calculation != null) collectReferences(compiled.expressions().get(calculation), refs);
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

  private record Target(Address address, JsonNode source, boolean ancestorsApplicable) {}
  private record Placement(String pageId, List<String> visibilityExpressionIds) {
    private Placement { visibilityExpressionIds = List.copyOf(visibilityExpressionIds); }
  }

  private static Map<String, List<Placement>> placements(JsonNode packageNode) {
    Map<String, List<Placement>> result = new LinkedHashMap<>();
    for (JsonNode phase : packageNode.path("flow").path("phases")) {
      for (JsonNode page : phase.path("pages")) {
        for (JsonNode section : page.path("sections")) {
          for (JsonNode node : section.path("nodes"))
            collectPlacements(node, page.path("id").asText(), List.of(), result);
        }
      }
    }
    result.replaceAll((field, values) -> List.copyOf(values));
    return Map.copyOf(result);
  }

  private static void collectPlacements(
      JsonNode node, String pageId, List<String> ancestorVisibility,
      Map<String, List<Placement>> result) {
    List<String> visibility = new ArrayList<>(ancestorVisibility);
    if (node.path("visibilityExpressionId").isTextual())
      visibility.add(node.path("visibilityExpressionId").asText());
    if (node.path("fieldId").isTextual()) {
      result.computeIfAbsent(node.path("fieldId").asText(), ignored -> new ArrayList<>())
          .add(new Placement(pageId, visibility));
    }
    for (JsonNode child : node.path("children")) collectPlacements(child, pageId, visibility, result);
  }

  /** Enumerates every active stable address rather than reducing repeaters to their root definition. */
  private List<Target> targets(State state) {
    List<Target> result = new ArrayList<>();
    for (JsonNode root : compiled.canonicalPackage().path("data").path("fields"))
      collectTargets(root, List.of(), true, state, result);
    return result;
  }

  private void collectTargets(JsonNode field, List<RowSegment> path, boolean ancestorsApplicable, State state,
      List<Target> result) {
    Address address = new Address(field.path("id").asText(), path);
    Cell cell = state.cells().get(address);
    boolean active = ancestorsApplicable && (cell == null || cell.status() != Status.notApplicable);
    result.add(new Target(address, field, ancestorsApplicable));
    JsonNode children = field.path("itemSchema").path("fields");
    if ("list".equals(field.path("type").asText())) {
      for (String itemId : state.itemIds(address)) {
        List<RowSegment> itemPath = new ArrayList<>(path);
        itemPath.add(new RowSegment(field.path("id").asText(), itemId));
        for (JsonNode child : children) collectTargets(child, itemPath, active, state, result);
      }
    } else if ("object".equals(field.path("type").asText())) {
      for (JsonNode child : children) collectTargets(child, path, active, state, result);
    }
  }

  private static boolean ancestorsApplicable(Address address, State state) {
    for (int index = 0; index < address.rowPath().size(); index++) {
      RowSegment segment = address.rowPath().get(index);
      Cell parent = state.cells().get(new Address(segment.listFieldId(), address.rowPath().subList(0, index)));
      if (parent != null && parent.status() == Status.notApplicable) return false;
    }
    return true;
  }

  private static String calculationExpressionId(JsonNode source) {
    JsonNode binding = source.path("extensions").path("x-kodeboxx.calculation");
    if (binding.path("value").isTextual()) return binding.path("value").asText();
    // Compatibility for in-memory test/projection objects created before the canonical compiler.
    // FormCompiler never publishes a canonical package with this unbound legacy representation.
    String legacy = expressionReference(source.path("calculation").path("expressionRef"));
    return legacy.isBlank() ? null : legacy;
  }

  private void validate(JsonNode source, Cell cell, boolean applicable, State state, String sessionDate,
      String timeZone, ExpressionEngine.MutationBudget budget, String fieldId, Address address,
      List<Diagnostic> diagnostics) {
    if (!applicable || cell == null || cell.status() != Status.answered) return;
    String expressionId = source.path("validationExpressionId").asText(null);
    if (expressionId != null && !evaluateBoolean(expressionId, state, sessionDate, timeZone, budget, false,
        fieldId, diagnostics, address)) diagnostics.add(new Diagnostic("VALIDATION_FAILED", fieldId, expressionId));
  }
}
