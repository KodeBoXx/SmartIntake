package com.kodeboxx.smartintake.contract.compiler;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.kodeboxx.smartintake.contract.ContractRegistry;
import com.kodeboxx.smartintake.contract.ExpressionEngine;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * The server-authoritative compiler for complete canonical 4.0.0 packages.
 * It intentionally does not reinterpret M1's legacy definition shape.
 */
@Component
public final class FormCompiler {
  private static final String VERSION = ContractRegistry.VERSION;
  private final ContractRegistry registry;
  private final ExpressionEngine expressions = new ExpressionEngine();
  private final Map<String, Set<String>> controls;

  public FormCompiler(ContractRegistry registry) {
    this.registry = registry;
    this.controls = controlCompatibility(registry.capabilities());
  }

  public CompilationResult compile(JsonNode candidate) {
    List<CompilationDiagnostic> problems = new ArrayList<>();
    if (candidate == null || !candidate.isObject() || !VERSION.equals(candidate.path("contractVersion").asText())
        || !VERSION.equals(candidate.path("schemaVersion").asText()) || !VERSION.equals(candidate.path("engineContract").asText())) {
      problems.add(problem("CANONICAL_PACKAGE_REQUIRED", "", "Only complete canonical 4.0.0 packages are compiled."));
      return new CompilationResult(null, problems);
    }
    ContractRegistry.ValidationResult schema = registry.validate("package", VERSION, candidate);
    for (ContractRegistry.Diagnostic diagnostic : schema.diagnostics()) {
      problems.add(problem("SCHEMA_" + diagnostic.code(), diagnostic.pointer(), "Package schema validation failed."));
    }
    State state = new State(candidate, problems);
    collectFields(candidate.path("data").path("fields"), "/data/fields", 0, List.of(), state, new HashSet<>());
    collectPages(candidate.path("flow").path("phases"), state);
    checkNodes(candidate.path("flow").path("phases"), "/flow/phases", state);
    checkExpressions(candidate.path("expressions"), state);
    checkExpressionConsumers(candidate, state);
    checkCalculationBindings(state);
    checkRoutes(candidate, state);
    checkLocales(candidate, state);
    checkReferences(candidate, state);
    checkDependencyCycles(candidate, state);
    checkFixedMatrices(candidate.path("flow").path("phases"), "/flow/phases", state);
    if (!problems.isEmpty()) return new CompilationResult(null, problems);

    Map<String, CompiledForm.CompiledField> fields = new LinkedHashMap<>();
    state.fields.forEach((id, field) -> fields.put(id, new CompiledForm.CompiledField(id, field.key, field.type,
        field.repeaterDepth, field.protectedValue, field.optionIds, field.source)));
    List<CompiledForm.CompiledPage> pages = state.pages.stream().map(page -> new CompiledForm.CompiledPage(
        page.id, page.order, page.targets, page.review)).toList();
    return new CompilationResult(new CompiledForm(VERSION, candidate, fields, pages, state.expressionNodes, state.reviewPages), problems);
  }

  private void collectFields(JsonNode nodes, String pointer, int repeaterDepth, List<String> listAncestors,
      State state, Set<String> siblingKeys) {
    if (!nodes.isArray()) return;
    for (int index = 0; index < nodes.size(); index++) {
      JsonNode field = nodes.get(index); String at = pointer + "/" + index;
      String id = field.path("id").asText(); String key = field.path("key").asText();
      if (!state.ids.add(id)) state.error("DUPLICATE_ID", at + "/id", "IDs must be unique globally.");
      if (!siblingKeys.add(key)) state.error("DUPLICATE_SIBLING_KEY", at + "/key", "Sibling keys must be unique.");
      List<String> options = optionIds(field.path("options"), at + "/options", state);
      int childDepth = "list".equals(field.path("type").asText()) ? repeaterDepth + 1 : repeaterDepth;
      if (childDepth > 3) state.error("NESTED_REPEATER_DEPTH", at, "Repeaters may nest at most three levels.");
      boolean protectedValue = hasCalculation(field) || field.path("readOnly").asBoolean(false)
          || "calculated".equals(field.path("mode").asText());
      state.fields.put(id, new Field(id, key, field.path("type").asText(), childDepth, protectedValue,
          options, listAncestors, field, at));
      if (field.path("constraints").path("maxItems").asInt(0) > 500)
        state.error("REPEATER_ITEM_LIMIT", at + "/constraints/maxItems", "Repeaters may contain at most 500 items.");
      checkOptionDefault(field, options, at, state);
      // The closed 4.0.0 package grammar uses itemSchema.fields for both object and list descendants.
      // Do not accept the old prototype's direct fields shape here.
      if (field.path("itemSchema").has("fields")) {
        List<String> childAncestors = listAncestors;
        if ("list".equals(field.path("type").asText())) {
          childAncestors = new ArrayList<>(listAncestors);
          childAncestors.add(id);
        }
        collectFields(field.path("itemSchema").path("fields"), at + "/itemSchema/fields", childDepth,
            childAncestors, state, new HashSet<>());
      }
    }
  }

  private List<String> optionIds(JsonNode options, String pointer, State state) {
    List<String> ids = new ArrayList<>(); Set<String> seen = new HashSet<>();
    if (!options.isArray()) return ids;
    for (int i = 0; i < options.size(); i++) {
      String id = options.get(i).path("id").asText();
      if (!seen.add(id)) state.error("DUPLICATE_OPTION_ID", pointer + "/" + i + "/id", "Option IDs must be unique in their field.");
      ids.add(id);
    }
    return ids;
  }

  private void collectPages(JsonNode phases, State state) {
    if (!phases.isArray()) return;
    for (int p = 0; p < phases.size(); p++) {
      JsonNode phase = phases.get(p); String phaseAt = "/flow/phases/" + p;
      addId(phase.path("id").asText(), phaseAt + "/id", state);
      Set<String> pageKeys = new HashSet<>();
      for (int i = 0; i < phase.path("pages").size(); i++) {
      JsonNode page = phase.path("pages").get(i);
      String at = "/flow/phases/" + p + "/pages/" + i;
      String id = page.path("id").asText();
      addId(id, at + "/id", state);
      if (!page.path("key").isMissingNode() && !pageKeys.add(page.path("key").asText()))
        state.error("DUPLICATE_SIBLING_KEY", at + "/key", "Sibling keys must be unique.");
      Set<String> sectionKeys = new HashSet<>();
      for (int section = 0; section < page.path("sections").size(); section++) {
        JsonNode value = page.path("sections").get(section); String sectionAt = at + "/sections/" + section;
        addId(value.path("id").asText(), sectionAt + "/id", state);
        if (!value.path("key").isMissingNode() && !sectionKeys.add(value.path("key").asText()))
          state.error("DUPLICATE_SIBLING_KEY", sectionAt + "/key", "Sibling keys must be unique.");
      }
      boolean review = hasReview(page.path("sections"));
      if (review) state.reviewPages.add(id);
      List<String> targets = new ArrayList<>(); page.path("routes").forEach(route -> targets.add(route.path("targetPageId").asText()));
      if (page.has("defaultNextPageId")) targets.add(page.path("defaultNextPageId").asText());
      state.pages.add(new Page(id, state.pages.size(), targets, review, at));
      }
    }
  }

  private boolean hasReview(JsonNode sections) {
    if (!sections.isArray()) return false;
    for (JsonNode section : sections) if (hasReviewNode(section.path("nodes"))) return true;
    return false;
  }
  private boolean hasReviewNode(JsonNode nodes) {
    if (!nodes.isArray()) return false;
    for (JsonNode node : nodes) if ("review".equals(node.path("kind").asText()) || hasReviewNode(node.path("children"))) return true;
    return false;
  }

  private void checkNodes(JsonNode phases, String ignored, State state) {
    for (int p = 0; p < phases.size(); p++) for (int i = 0; i < phases.get(p).path("pages").size(); i++)
      checkNodeArray(phases.get(p).path("pages").get(i).path("sections"), "/flow/phases/" + p + "/pages/" + i + "/sections", state);
  }
  private void checkNodeArray(JsonNode sections, String pointer, State state) {
    for (int section = 0; section < sections.size(); section++) {
      JsonNode nodes = sections.get(section).path("nodes");
      for (int n = 0; n < nodes.size(); n++) checkNode(nodes.get(n), pointer + "/" + section + "/nodes/" + n, state);
    }
  }
  private void checkNode(JsonNode node, String at, State state) {
    String id = node.path("id").asText();
    if (!state.ids.add(id)) state.error("DUPLICATE_ID", at + "/id", "IDs must be unique globally.");
    if ("question".equals(node.path("kind").asText())) {
      Field field = state.fields.get(node.path("fieldId").asText());
      if (field == null) state.error("UNKNOWN_FIELD", at + "/fieldId", "Question must reference a declared field.");
      else {
        String suppliedType = node.path("fieldType").asText(field.type);
        if (!field.type.equals(suppliedType)) state.error("FIELD_TYPE_MISMATCH", at + "/fieldType", "Question type must match its field.");
        if (!controls.getOrDefault(node.path("control").asText(), Set.of()).contains(field.type))
          state.error("CONTROL_TYPE_INCOMPATIBLE", at + "/control", "Control is incompatible with the canonical field type.");
        if (("choice".equals(field.type) || "multiChoice".equals(field.type)) && field.optionIds.isEmpty())
          state.error("OPTION_DOMAIN_REQUIRED", at + "/fieldId", "Choice fields require a non-empty option domain.");
      }
    }
    JsonNode children = node.path("children");
    for (int i = 0; i < children.size(); i++) checkNode(children.get(i), at + "/children/" + i, state);
  }

  private void checkExpressions(JsonNode expressionNodes, State state) {
    if (!expressionNodes.isObject()) return;
    expressionNodes.fields().forEachRemaining(entry -> {
      state.expressionNodes.put(entry.getKey(), entry.getValue().deepCopy());
      ExpressionEngine.Result result = expressions.compile(entry.getValue());
      if (!"available".equals(result.state())) state.error("EXPRESSION_" + result.code(),
          CompilationDiagnostic.child("/expressions", entry.getKey()), "Expression does not compile against the declared fields and scopes.");
    });
  }

  private void checkExpressionConsumers(JsonNode candidate, State state) {
    JsonNode definitions = expressionDefinitions(candidate.path("data").path("fields"));
    for (Field field : state.fields.values()) {
      for (String binding : List.of("visibilityExpressionId", "requiredExpressionId", "validationExpressionId"))
        checkExpressionAt(field.source.path(binding).asText(null), field, definitions, state);
      JsonNode calculation = calculationBinding(field.source);
      if (calculation.path("value").isTextual())
        checkExpressionAt(calculation.path("value").asText(), field, definitions, state);
    }
    checkNodeExpressionConsumers(candidate.path("flow").path("phases"), definitions, state);
    state.expressionNodes.forEach((id, expression) -> {
      if (!state.expressionConsumers.contains(id))
        checkExpressionAt(id, null, definitions, state);
    });
  }

  private void checkNodeExpressionConsumers(JsonNode phases, JsonNode definitions, State state) {
    for (JsonNode phase : phases) for (JsonNode page : phase.path("pages")) {
      for (JsonNode route : page.path("routes"))
        checkExpressionAt(route.path("whenExpressionId").asText(null), null, definitions, state);
      for (JsonNode section : page.path("sections")) for (JsonNode node : section.path("nodes"))
        checkNodeExpressionConsumer(node, definitions, state);
    }
  }

  private void checkNodeExpressionConsumer(JsonNode node, JsonNode definitions, State state) {
    Field field = state.fields.get(node.path("fieldId").asText());
    for (String binding : List.of("visibilityExpressionId", "requiredExpressionId", "validationExpressionId"))
      checkExpressionAt(node.path(binding).asText(null), field, definitions, state);
    for (JsonNode child : node.path("children")) checkNodeExpressionConsumer(child, definitions, state);
  }

  private static ArrayNode expressionDefinitions(JsonNode fields) {
    ArrayNode result = JsonNodeFactory.instance.arrayNode();
    for (JsonNode field : fields) result.add(expressionDefinition(field));
    return result;
  }

  private static ObjectNode expressionDefinition(JsonNode field) {
    ObjectNode result = JsonNodeFactory.instance.objectNode();
    result.put("id", field.path("id").asText());
    result.put("type", field.path("type").asText());
    JsonNode children = field.path("itemSchema").path("fields");
    if (children.isArray()) {
      ArrayNode itemFields = result.putArray("itemFields");
      for (JsonNode child : children) itemFields.add(expressionDefinition(child));
    }
    return result;
  }

  private void checkExpressionAt(
      String expressionId, Field field, JsonNode definitions, State state) {
    if (expressionId == null || expressionId.isBlank()) return;
    state.expressionConsumers.add(expressionId);
    JsonNode expression = state.expressionNodes.get(expressionId);
    if (expression == null) return;
    try {
      List<String> ancestors = field == null ? List.of() : field.listAncestors;
      ExpressionEngine.Result result = expressions.compile(expression,
          ExpressionEngine.definitionContextAt(definitions, ancestors));
      if (!"available".equals(result.state())) state.error("EXPRESSION_" + result.code(),
          CompilationDiagnostic.child("/expressions", expressionId),
          "Expression does not compile in its consuming field or placement scope.");
    } catch (IllegalArgumentException invalid) {
      state.error("EXPRESSION_EXPR_SCOPE", CompilationDiagnostic.child("/expressions", expressionId),
          "Expression does not compile in its consuming field or placement scope.");
    }
  }

  /**
   * Calculations are an additive dependency-bound field extension.  The package schema deliberately
   * keeps extension values scalar, so the scalar is the expression id rather than an alternate
   * calculation object that would change the immutable 4.0.0 bytes.
   */
  private void checkCalculationBindings(State state) {
    Set<String> dependencies = new HashSet<>();
    state.candidate.path("dependencies").forEach(dependency -> dependencies.add(dependency.path("id").asText()));
    for (Field field : state.fields.values()) {
      JsonNode binding = calculationBinding(field.source);
      boolean calculated = field.source.path("calculated").asBoolean(false)
          || "calculated".equals(field.source.path("mode").asText());
      if (!calculated && binding.isMissingNode()) continue;
      if (!binding.isObject() || !binding.path("value").isTextual()
          || binding.path("value").asText().isBlank()) {
        state.error("CALCULATION_BINDING_REQUIRED", fieldPointer(field.id, state),
            "Calculated fields require an x-kodeboxx.calculation scalar expression binding.");
        continue;
      }
      String expressionId = binding.path("value").asText();
      if (!state.expressionNodes.containsKey(expressionId))
        state.error("CALCULATION_EXPRESSION_MISSING", fieldPointer(field.id, state),
            "Calculation binding must name a declared expression.");
      String dependencyId = binding.path("dependencyId").asText();
      if (dependencyId.isBlank() || !dependencies.contains(dependencyId))
        state.error("CALCULATION_DEPENDENCY_REQUIRED", fieldPointer(field.id, state),
            "Calculation binding must remain dependency-bound.");
    }
  }

  private static boolean hasCalculation(JsonNode field) {
    return field.path("calculated").asBoolean(false)
        || "calculated".equals(field.path("mode").asText())
        || !calculationBinding(field).isMissingNode();
  }

  private static JsonNode calculationBinding(JsonNode field) {
    return field.path("extensions").path("x-kodeboxx.calculation");
  }

  private static String fieldPointer(String fieldId, State state) {
    for (Field field : state.fields.values()) if (field.id.equals(fieldId)) return field.sourcePointer;
    return "/data/fields";
  }

  private void checkRoutes(JsonNode candidate, State state) {
    Map<String, Page> pages = new HashMap<>(); state.pages.forEach(page -> pages.put(page.id, page));
    for (Page page : state.pages) for (String target : page.targets) {
      Page targetPage = pages.get(target);
      if (targetPage == null) state.error("UNKNOWN_ROUTE_TARGET", page.pointer, "Route target must name a page.");
      else if (targetPage.order <= page.order) state.error("ROUTE_NOT_FORWARD", page.pointer, "Routes may target only later pages.");
    }
    if (hasRouteCycle(pages)) state.error("ROUTE_CYCLE", "/flow", "Routes must not form a cycle.");
    String start = candidate.path("flow").path("startPageId").asText();
    if (!pages.containsKey(start)) state.error("UNKNOWN_START_PAGE", "/flow/startPageId", "Start page must name a page.");
    if (state.reviewPages.isEmpty()) state.error("REVIEW_PAGE_UNREACHABLE", "/flow", "A final review page is required.");
    else if (pages.containsKey(start) && !reachable(start, pages, state.reviewPages))
      state.error("REVIEW_PAGE_UNREACHABLE", "/flow", "At least one review page must be reachable from the start page.");
  }

  private boolean hasRouteCycle(Map<String, Page> pages) {
    Set<String> visiting = new HashSet<>(), visited = new HashSet<>();
    for (String id : pages.keySet()) if (routeCycle(id, pages, visiting, visited)) return true;
    return false;
  }
  private boolean routeCycle(String id, Map<String, Page> pages, Set<String> visiting, Set<String> visited) {
    if (visiting.contains(id)) return true; if (!visited.add(id)) return false; visiting.add(id);
    Page page = pages.get(id); if (page != null) for (String target : page.targets) if (pages.containsKey(target) && routeCycle(target, pages, visiting, visited)) return true;
    visiting.remove(id); return false;
  }

  private boolean reachable(String start, Map<String, Page> pages, List<String> reviews) {
    Set<String> visited = new HashSet<>(); ArrayDeque<String> pending = new ArrayDeque<>(); pending.add(start);
    while (!pending.isEmpty()) { String id = pending.remove(); if (!visited.add(id)) continue; if (reviews.contains(id)) return true;
      Page page = pages.get(id); if (page != null) pending.addAll(page.targets); }
    return false;
  }

  private void checkLocales(JsonNode candidate, State state) {
    Set<String> required = new HashSet<>(); collectKeys(candidate.path("data").path("fields"), required);
    required.add(candidate.path("titleKey").asText());
    for (JsonNode locale : candidate.path("supportedLocales")) {
      JsonNode messages = candidate.path("translations").path(locale.asText()).path("messages");
      for (String key : required) if (!key.isBlank() && !messages.has(key))
        state.error("LOCALE_KEY_MISSING", CompilationDiagnostic.child("/translations", locale.asText()), "Every declared locale must contain referenced message keys.");
    }
  }
  private void collectKeys(JsonNode fields, Set<String> keys) {
    for (JsonNode field : fields) { keys.add(field.path("labelKey").asText()); if (field.path("itemSchema").has("fields")) collectKeys(field.path("itemSchema").path("fields"), keys); }
  }

  private void checkReferences(JsonNode candidate, State state) {
    Set<String> dependencies = new HashSet<>(); candidate.path("dependencies").forEach(item -> dependencies.add(item.path("id").asText()));
    candidate.path("extensions").fields().forEachRemaining(entry -> {
      if (!dependencies.contains(entry.getValue().path("dependencyId").asText()))
        state.error("EXTENSION_DEPENDENCY_MISSING", CompilationDiagnostic.child("/extensions", entry.getKey()), "Extensions must bind a declared dependency.");
    });
    Set<String> assets = new HashSet<>(); candidate.path("assets").forEach(asset -> assets.add(asset.path("id").asText()));
    scanAssetReferences(candidate, "", assets, state);
    JsonNode theme = candidate.path("theme");
    if (theme.path("themeKey").asText().isBlank() || theme.path("tokens").isMissingNode())
      state.error("THEME_REFERENCE_INVALID", "/theme", "A complete bounded theme is required.");
    if (candidate.path("policies").isMissingNode()) state.error("POLICY_REFERENCE_INVALID", "/policies", "Policies are required.");
  }
  private void scanAssetReferences(JsonNode node, String pointer, Set<String> assets, State state) {
    if (node.isObject()) node.fields().forEachRemaining(entry -> {
      String child = CompilationDiagnostic.child(pointer, entry.getKey());
      if ("assetId".equals(entry.getKey()) && entry.getValue().isTextual() && !assets.contains(entry.getValue().asText()))
        state.error("ASSET_REFERENCE_MISSING", child, "Asset references must name a declared asset.");
      scanAssetReferences(entry.getValue(), child, assets, state);
    }); else if (node.isArray()) for (int i = 0; i < node.size(); i++) scanAssetReferences(node.get(i), pointer + "/" + i, assets, state);
  }

  private void checkDependencyCycles(JsonNode candidate, State state) {
    Map<String, String> edges = new HashMap<>();
    candidate.path("dependencies").forEach(item -> { if (item.has("dependsOnId")) edges.put(item.path("id").asText(), item.path("dependsOnId").asText()); });
    for (String start : edges.keySet()) { Set<String> seen = new HashSet<>(); String current = start;
      while (current != null && edges.containsKey(current)) { if (!seen.add(current)) { state.error("DEPENDENCY_CYCLE", "/dependencies", "Dependencies must be acyclic."); break; } current = edges.get(current); } }
  }

  private void checkFixedMatrices(JsonNode phases, String pointer, State state) {
    scanFixed(phases, pointer, state);
  }

  private void checkOptionDefault(JsonNode field, List<String> options, String at, State state) {
    JsonNode value = field.path("default").path("value");
    if (value.isMissingNode() || options.isEmpty()) return;
    if ("choice".equals(field.path("type").asText()) && value.isTextual() && !options.contains(value.asText()))
      state.error("OPTION_DOMAIN_INVALID", at + "/default/value", "Choice default must be in the option domain.");
    if ("multiChoice".equals(field.path("type").asText()) && value.isArray()) for (int i = 0; i < value.size(); i++)
      if (!options.contains(value.get(i).asText())) state.error("OPTION_DOMAIN_INVALID", at + "/default/value/" + i, "Choice default must be in the option domain.");
  }

  private void addId(String id, String pointer, State state) {
    if (!state.ids.add(id)) state.error("DUPLICATE_ID", pointer, "IDs must be unique globally.");
  }
  private void scanFixed(JsonNode node, String pointer, State state) {
    if (node.isObject()) {
      if ("fixedMatrix".equals(node.path("control").asText())) {
        Field field = state.fields.get(node.path("fieldId").asText());
        if (field == null || !"list".equals(field.type) || field.source.path("constraints").path("fixedItemIds").isEmpty())
          state.error("FIXED_MATRIX_REQUIREMENTS", pointer, "Fixed matrices require a list field with fixed item IDs.");
      }
      node.fields().forEachRemaining(entry -> scanFixed(entry.getValue(), CompilationDiagnostic.child(pointer, entry.getKey()), state));
    } else if (node.isArray()) for (int i = 0; i < node.size(); i++) scanFixed(node.get(i), pointer + "/" + i, state);
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Set<String>> controlCompatibility(Map<String, Object> capabilities) {
    Map<String, Set<String>> result = new HashMap<>();
    ((Map<String, Object>) capabilities.get("controlValueCompatibility")).forEach((control, types) -> result.put(control, Set.copyOf((List<String>) types)));
    return Map.copyOf(result);
  }

  private static CompilationDiagnostic problem(String code, String pointer, String message) { return new CompilationDiagnostic(code, pointer, message); }
  private record Field(String id, String key, String type, int repeaterDepth, boolean protectedValue,
                       List<String> optionIds, List<String> listAncestors, JsonNode source,
                       String sourcePointer) {
    private Field { listAncestors = List.copyOf(listAncestors); }
  }
  private record Page(String id, int order, List<String> targets, boolean review, String pointer) {}
  private static final class State {
    final JsonNode candidate; final List<CompilationDiagnostic> problems; final Set<String> ids = new HashSet<>();
    final Map<String, Field> fields = new LinkedHashMap<>(); final List<Page> pages = new ArrayList<>();
    final Map<String, JsonNode> expressionNodes = new LinkedHashMap<>(); final List<String> reviewPages = new ArrayList<>();
    final Set<String> expressionConsumers = new HashSet<>();
    State(JsonNode candidate, List<CompilationDiagnostic> problems) { this.candidate = candidate; this.problems = problems; }
    void error(String code, String pointer, String message) { problems.add(problem(code, pointer, message)); }
  }
}
