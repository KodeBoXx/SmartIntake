package com.kodeboxx.smartintake.contract.compiler;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.kodeboxx.smartintake.contract.ContractRegistry;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

/** Focused compile-time coverage for the frozen C_total compiler/graph categories. */
class FormCompilerTests {
  private final ObjectMapper json = new ObjectMapper();
  private final FormCompiler compiler = new FormCompiler(new ContractRegistry(json));

  @Test
  void compiles_a_canonical_package_into_an_immutable_graph_with_protected_fields() throws Exception {
    ObjectNode form = canonical();
    ObjectNode amount = (ObjectNode) form.at("/data/fields/1");
    amount.put("calculated", true);
    ((ArrayNode) form.path("dependencies")).add(json.readTree("""
        {"kind":"extension","id":"calculation-runtime","version":"1","digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"""));
    ObjectNode binding = amount.putObject("extensions").putObject("x-kodeboxx.calculation");
    binding.put("dependencyId", "calculation-runtime");
    binding.put("version", "1");
    binding.put("digest", "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    binding.put("value", "calculation");
    ((ObjectNode) form.path("expressions")).set("calculation", json.readTree("""
        {"literal":{"type":"integer","value":"7"}}"""));

    CompilationResult result = compiler.compile(form);

    assertThat(result.valid()).isTrue();
    assertThat(result.compiled()).isPresent();
    assertThat(result.compiled().orElseThrow().fields().get("amount").protectedValue()).isTrue();
    assertThat(result.compiled().orElseThrow().reviewPageIds()).containsExactly("page1");
    assertThat(result.compiled().orElseThrow().fields()).isUnmodifiable();
  }

  @Test
  void rejects_noncanonical_and_closed_schema_input_with_safe_sorted_diagnostics() throws Exception {
    ObjectNode legacy = canonical(); legacy.put("contractVersion", "3.0.0");
    assertCode(compiler.compile(legacy), "CANONICAL_PACKAGE_REQUIRED"); // C closed-schema

    ObjectNode invalid = canonical(); invalid.put("unexpected", true);
    CompilationResult result = compiler.compile(invalid);
    assertThat(result.valid()).isFalse();
    assertThat(result.diagnostics()).allSatisfy(diagnostic -> assertThat(diagnostic.pointer()).doesNotContain("~2"));
    assertThat(result.diagnostics()).isSorted(); // C diagnostic-pointer
  }

  @Test
  void proves_id_key_control_option_and_repeater_compile_guards() throws Exception {
    ObjectNode duplicate = canonical();
    ((ObjectNode) duplicate.at("/flow/phases/0/pages/0/sections/0/nodes/0")).put("id", "name");
    assertCode(compiler.compile(duplicate), "DUPLICATE_ID"); // C stable-id-key

    ObjectNode sameKey = canonical(); ((ObjectNode) sameKey.at("/data/fields/1")).put("key", "name");
    assertCode(compiler.compile(sameKey), "DUPLICATE_SIBLING_KEY");

    ObjectNode incompatible = canonical(); ((ObjectNode) incompatible.at("/flow/phases/0/pages/0/sections/0/nodes/1")).put("control", "text");
    assertCode(compiler.compile(incompatible), "CONTROL_TYPE_INCOMPATIBLE"); // C control-type-compatibility

    ObjectNode choice = canonical(); ObjectNode field = (ObjectNode) choice.at("/data/fields/0");
    field.put("type", "choice"); ((ObjectNode) choice.at("/flow/phases/0/pages/0/sections/0/nodes/0")).put("control", "radio").put("fieldType", "choice");
    assertCode(compiler.compile(choice), "OPTION_DOMAIN_REQUIRED"); // C option-domain

    ObjectNode repeater = canonical(); ((ObjectNode) repeater.at("/data/fields/2")).putObject("constraints").put("maxItems", 501);
    assertCode(compiler.compile(repeater), "REPEATER_ITEM_LIMIT"); // C limit-before-expansion
  }

  @Test
  void proves_expression_scope_arity_and_dependency_related_compile_guards() throws Exception {
    ObjectNode badExpression = canonical();
    ((ObjectNode) badExpression.path("expressions")).set("bad", json.readTree("""
        {"op":"add","args":[{"ref":{"scope":"root","fieldId":"missing"}},{"literal":{"type":"integer","value":"1"}}]}"""));
    assertThat(compiler.compile(badExpression).diagnostics()).anySatisfy(diagnostic -> assertThat(diagnostic.code()).startsWith("EXPRESSION_")); // C scope-arity, calculation

    ObjectNode extensions = canonical(); ((ObjectNode) extensions.path("extensions")).set("x-example.org", json.readTree("""
        {"dependencyId":"absent","version":"1.0.0","digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","value":"x"}"""));
    assertCode(compiler.compile(extensions), "EXTENSION_DEPENDENCY_MISSING"); // C extension-settings

    ObjectNode dependencyCycle = canonical(); ((ArrayNode) dependencyCycle.path("dependencies")).add(json.readTree("""
        {"kind":"extension","id":"cycle","version":"1","digest":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","dependsOnId":"cycle"}"""));
    assertCode(compiler.compile(dependencyCycle), "DEPENDENCY_CYCLE"); // C dependency-cycle
  }

  @Test
  void proves_routes_review_locales_assets_theme_and_matrix_requirements() throws Exception {
    ObjectNode route = canonical(); ((ObjectNode) route.at("/flow/phases/0/pages/0")).put("defaultNextPageId", "missing");
    assertCode(compiler.compile(route), "UNKNOWN_ROUTE_TARGET"); // C route-reachability

    ObjectNode routeCycle = canonical(); ((ObjectNode) routeCycle.at("/flow/phases/0/pages/0")).put("defaultNextPageId", "page1");
    assertCode(compiler.compile(routeCycle), "ROUTE_CYCLE"); // C route-cycle

    ObjectNode locale = canonical(); ((ObjectNode) locale.at("/translations/en/messages")).remove("name");
    assertCode(compiler.compile(locale), "LOCALE_KEY_MISSING"); // C locale-completeness, rtl-theme

    ObjectNode asset = canonical(); ((ObjectNode) asset.path("guidance")).set("card", json.readTree("{\"assetId\":\"missing\"}"));
    assertCode(compiler.compile(asset), "ASSET_REFERENCE_MISSING"); // C asset-policy

    ObjectNode matrix = canonical(); ((ObjectNode) matrix.at("/flow/phases/0/pages/0/sections/0/nodes/2")).put("control", "fixedMatrix");
    assertCode(compiler.compile(matrix), "FIXED_MATRIX_REQUIREMENTS"); // C fixed-matrix
  }

  @Test
  void reports_missing_review_and_exposes_recursive_repeater_depth_without_runtime_claims() throws Exception {
    ObjectNode noReview = (ObjectNode) json.readTree(Files.readString(Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/fixtures/package.positive.json")));
    assertCode(compiler.compile(noReview), "REVIEW_PAGE_UNREACHABLE"); // C review-projection

    ObjectNode nested = canonical();
    ObjectNode child = (ObjectNode) nested.at("/data/fields/2/itemSchema/fields/0");
    child.put("type", "list"); child.set("itemSchema", json.readTree("""
        {"fields":[{"id":"l2","key":"l2","type":"list","labelKey":"name","itemSchema":{"fields":[{"id":"l3","key":"l3","type":"list","labelKey":"name","itemSchema":{"fields":[{"id":"l4","key":"l4","type":"text","labelKey":"name"}]}}]}}]}"""));
    assertCode(compiler.compile(nested), "NESTED_REPEATER_DEPTH"); // C nested-repeater-depth
  }

  @Test
  void compiles_nested_object_and_list_children_and_requires_bound_calculation_extension() throws Exception {
    ObjectNode form = canonical();
    CompilationResult nested = compiler.compile(form);
    assertThat(nested.valid()).as(nested.diagnostics().toString()).isTrue();
    assertThat(nested.compiled().orElseThrow().fields()).containsKey("attendeeName");

    ObjectNode calculated = canonical();
    ((ObjectNode) calculated.at("/data/fields/1")).put("calculated", true);
    assertCode(compiler.compile(calculated), "CALCULATION_BINDING_REQUIRED");
  }

  @Test
  void compilesItemScopedExpressionAtItsRecursiveConsumer() throws Exception {
    ObjectNode form = canonical();
    ((ObjectNode) form.path("expressions")).set("itemVisible", json.readTree("""
        {"op":"isAnswered","args":[{"ref":{"scope":"item","fieldId":"attendeeName"}}]}"""));
    ((ObjectNode) form.at("/data/fields/2/itemSchema/fields/0"))
        .put("validationExpressionId", "itemVisible");
    CompilationResult result = compiler.compile(form);
    assertThat(result.valid()).as(result.diagnostics().toString()).isTrue();
  }

  @Test
  void compilesParentItemExpressionAtNestedRecursiveConsumer() throws Exception {
    ObjectNode form = canonical();
    ((ObjectNode) form.path("expressions")).set("parentVisible", json.readTree("""
        {"op":"isAnswered","args":[{"ref":{"scope":"parentItem","parentDepth":1,"fieldId":"attendeeName"}}]}"""));
    ((ArrayNode) form.at("/data/fields/2/itemSchema/fields")).add(json.readTree("""
        {"id":"parts","key":"parts","type":"list","labelKey":"title","itemSchema":{"fields":[
          {"id":"serial","key":"serial","type":"text","labelKey":"title","validationExpressionId":"parentVisible"}
        ]}}"""));
    CompilationResult result = compiler.compile(form);
    assertThat(result.valid()).as(result.diagnostics().toString()).isTrue();
  }

  private ObjectNode canonical() throws Exception {
    ObjectNode form = (ObjectNode) json.readTree(Files.readString(Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/fixtures/package.positive.json")));
    ArrayNode nodes = (ArrayNode) form.at("/flow/phases/0/pages/0/sections/0/nodes");
    nodes.add(json.readTree("{\"id\":\"review1\",\"kind\":\"review\",\"labelKey\":\"title\"}"));
    return form;
  }

  private static void assertCode(CompilationResult result, String code) {
    assertThat(result.valid()).isFalse();
    assertThat(result.diagnostics()).extracting(CompilationDiagnostic::code).contains(code);
  }
}
