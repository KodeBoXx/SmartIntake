package com.kodeboxx.smartintake.contract.runtime;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.kodeboxx.smartintake.contract.compiler.CompiledForm;
import com.kodeboxx.smartintake.contract.compiler.CompiledForm.CompiledField;
import com.kodeboxx.smartintake.contract.compiler.CompiledForm.CompiledPage;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;

class RuntimeGraphTests {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Instant NOW = Instant.parse("2026-09-19T16:09:41Z");

  @Test
  void evaluatesDependenciesApplicabilityCalculationProgressAndRoutesDeterministically() throws Exception {
    CompiledForm compiled = compiled(false);
    TypedAnswerRuntime runtime = new CompiledRuntimeFactory().create(compiled);
    State state = runtime.apply(runtime.initialize(), List.of(
        new SetValue(new Address("flag", List.of()), Status.answered, JSON.readTree("false")),
        new SetValue(new Address("amount", List.of()), Status.answered, JSON.readTree("\"2\"")),
        new SetValue(new Address("secret", List.of()), Status.answered, JSON.readTree("\"retained\""))), NOW).state();
    RuntimeGraph graph = new RuntimeGraph(compiled, runtime);
    RuntimeGraph.Projection hidden = graph.evaluate(state, "2026-09-19", "UTC", NOW.plusSeconds(1));
    assertTrue(hidden.diagnostics().isEmpty(), () -> hidden.diagnostics().toString());
    assertFalse(hidden.fields().get("secret").applicable());
    assertEquals(Status.notApplicable, hidden.fields().get("secret").status());
    assertEquals("retained", hidden.state().retainedCells().get(new Address("secret", List.of())).value().textValue());
    assertEquals("5", hidden.state().cells().get(new Address("total", List.of())).value().textValue());
    assertEquals(Provenance.calculated, hidden.state().cells().get(new Address("total", List.of())).provenance());
    assertEquals(List.of("page-input", "page-review"), hidden.reachablePageIds());
    assertEquals(1, hidden.requiredCount());
    assertEquals(0, hidden.completedRequiredCount());
    RuntimeGraph.Projection repeated = graph.evaluate(
        hidden.state(), "2026-09-19", "UTC", NOW.plusSeconds(30));
    assertEquals(runtime.projection(hidden.state()), runtime.projection(repeated.state()));

    State visibleInput = runtime.apply(hidden.state(), List.of(
        new SetValue(new Address("flag", List.of()), Status.answered, JSON.readTree("true"))), NOW.plusSeconds(2)).state();
    RuntimeGraph.Projection visible = graph.evaluate(visibleInput, "2026-09-19", "UTC", NOW.plusSeconds(3));
    assertTrue(visible.fields().get("secret").applicable());
    assertEquals("retained", visible.state().cells().get(new Address("secret", List.of())).value().textValue());
  }

  @Test
  void rejectsFieldDependencyCyclesBeforeEvaluation() throws Exception {
    CompiledForm compiled = compiled(true);
    TypedAnswerRuntime runtime = new CompiledRuntimeFactory().create(compiled);
    RuntimeGraph.Projection projection = new RuntimeGraph(compiled, runtime)
        .evaluate(runtime.initialize(), "2026-09-19", "UTC", NOW);
    assertEquals(List.of("DEPENDENCY_CYCLE"), projection.diagnostics().stream()
        .map(RuntimeGraph.Diagnostic::code).distinct().toList());
  }

  @Test
  void treatsUnknownVisibilityAsNotApplicableWithoutGuessing() throws Exception {
    CompiledForm compiled = compiled(false);
    TypedAnswerRuntime runtime = new CompiledRuntimeFactory().create(compiled);
    RuntimeGraph.Projection projection = new RuntimeGraph(compiled, runtime)
        .evaluate(runtime.initialize(), "2026-09-19", "UTC", NOW);
    assertFalse(projection.fields().get("secret").applicable());
    assertEquals(Status.notApplicable, projection.fields().get("secret").status());
  }

  @Test
  void conditionalAboutRouteFallsBackToEquipmentAndAlwaysReachesReview() throws Exception {
    CompiledForm compiled = conditionalRouting();
    TypedAnswerRuntime runtime = new CompiledRuntimeFactory().create(compiled);
    RuntimeGraph graph = new RuntimeGraph(compiled, runtime);

    State needsSetup = runtime.apply(runtime.initialize(), List.of(
        new SetValue(new Address("needsSetup", List.of()), Status.answered, JSON.readTree("true"))), NOW).state();
    State noSetup = runtime.apply(runtime.initialize(), List.of(
        new SetValue(new Address("needsSetup", List.of()), Status.answered, JSON.readTree("false"))), NOW).state();

    assertEquals(List.of("page-about", "page-equipment", "page-review"),
        graph.evaluate(needsSetup, "2026-09-19", "UTC", NOW).reachablePageIds());
    assertEquals(List.of("page-about", "page-equipment", "page-review"),
        graph.evaluate(noSetup, "2026-09-19", "UTC", NOW).reachablePageIds());
  }

  private CompiledForm compiled(boolean cycle) throws Exception {
    ObjectNode pkg = (ObjectNode) JSON.readTree("""
        {
          "contractVersion":"4.0.0",
          "data":{"fields":[
            {"id":"flag","key":"flag","type":"boolean","labelKey":"flag","required":true},
            {"id":"amount","key":"amount","type":"integer","labelKey":"amount"},
            {"id":"secret","key":"secret","type":"text","labelKey":"secret","hiddenRetention":"draft","visibilityExpressionId":"showSecret"},
            {"id":"total","key":"total","type":"integer","labelKey":"total","calculated":true,
             "calculation":{"expressionRef":"#/expressions/totalExpression","outputType":"integer","readOnly":true,"recomputeOn":["/answers/amount"]}}
          ]},
          "flow":{"startPageId":"page-input","phases":[{"id":"phase","pages":[
            {"id":"page-input","sections":[],"defaultNextPageId":"page-review"},
            {"id":"page-review","sections":[]}
          ]}]}
        }
        """);
    ObjectNode showSecret = (ObjectNode) JSON.readTree(cycle
        ? "{\"ref\":{\"scope\":\"root\",\"fieldId\":\"total\"}}"
        : "{\"ref\":{\"scope\":\"root\",\"fieldId\":\"flag\"}}");
    ObjectNode total = (ObjectNode) JSON.readTree(cycle
        ? "{\"ref\":{\"scope\":\"root\",\"fieldId\":\"secret\"}}"
        : "{\"op\":\"add\",\"args\":[{\"ref\":{\"scope\":\"root\",\"fieldId\":\"amount\"}},{\"literal\":{\"type\":\"integer\",\"value\":\"3\"}}]}");
    Map<String, JsonNode> expressions = Map.of("showSecret", showSecret, "totalExpression", total);
    Map<String, CompiledField> fields = new LinkedHashMap<>();
    for (JsonNode field : pkg.at("/data/fields")) {
      fields.put(field.path("id").asText(), new CompiledField(
          field.path("id").asText(), field.path("key").asText(), field.path("type").asText(), 0,
          field.path("calculated").asBoolean(false), List.of(), field));
    }
    return new CompiledForm("4.0.0", pkg, fields,
        List.of(new CompiledPage("page-input", 0, List.of("page-review"), false),
            new CompiledPage("page-review", 1, List.of(), true)),
        expressions, List.of("page-review"));
  }

  /** Mirrors the authored About -> Equipment branch plus its mandatory fallback. */
  private CompiledForm conditionalRouting() throws Exception {
    ObjectNode pkg = (ObjectNode) JSON.readTree("""
        {
          "contractVersion":"4.0.0",
          "data":{"fields":[{"id":"needsSetup","key":"needs_setup","type":"boolean","labelKey":"needsSetup"}]},
          "flow":{"startPageId":"page-about","phases":[{"id":"phase-about","pages":[
            {"id":"page-about","sections":[],"defaultNextPageId":"page-equipment","routes":[{"id":"route-setup","targetPageId":"page-equipment","whenExpressionId":"needsSetupTrue"}]},
            {"id":"page-equipment","sections":[],"defaultNextPageId":"page-review"},
            {"id":"page-review","sections":[]}
          ]}]}
        }
        """);
    CompiledField field = new CompiledField("needsSetup", "needs_setup", "boolean", 0, false, List.of(), pkg.at("/data/fields/0"));
    JsonNode condition = JSON.readTree("""
        {"op":"eq","args":[{"ref":{"scope":"root","fieldId":"needsSetup"}},{"literal":{"type":"boolean","value":true}}]}
        """);
    return new CompiledForm("4.0.0", pkg, Map.of("needsSetup", field), List.of(
        new CompiledPage("page-about", 0, List.of("page-equipment"), false),
        new CompiledPage("page-equipment", 1, List.of("page-review"), false),
        new CompiledPage("page-review", 2, List.of(), true)), Map.of("needsSetupTrue", condition), List.of("page-review"));
  }
}
