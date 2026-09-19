package com.kodeboxx.smartintake.contract;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class ExpressionCanonicalAnswerTests {
  private static final ObjectMapper JSON = new ObjectMapper();

  @Test
  void rejects_referenced_decimal_negative_zero_before_the_exists_predicate() throws Exception {
    JsonNode definitions = JSON.readTree("[{\"id\":\"amount\",\"type\":\"decimal\"}]");
    JsonNode answers = JSON.readTree("""
        {"amount":{"type":"decimal","status":"answered","applicable":true,"value":"-0.00"}}
        """);
    JsonNode expression = JSON.readTree("""
        {"op":"exists","args":[{"ref":{"fieldId":"amount","scope":"root"}}]}
        """);
    ExpressionEngine engine = new ExpressionEngine();
    ExpressionEngine.EvaluationContext context = ExpressionEngine.projection(
        definitions, answers, "2026-09-05", "UTC", 100_000);

    assertThat(engine.evaluate(expression, context))
        .extracting(ExpressionEngine.Result::state, ExpressionEngine.Result::code)
        .containsExactly("error", "DECIMAL_ENCODING");
  }

  @Test
  void resolves_object_descendants_by_their_declared_id_without_dot_paths() throws Exception {
    JsonNode definitions = JSON.readTree("""
        [{"id":"profile","type":"object","fields":[{"id":"age","type":"integer"}]}]
        """);
    JsonNode answers = JSON.readTree("""
        {"profile":{"type":"object","status":"answered","applicable":true,"value":{"fields":{
          "age":{"type":"integer","status":"answered","applicable":true,"value":"42"}
        }}}}
        """);
    JsonNode expression = JSON.readTree("""
        {"ref":{"fieldId":"age","scope":"root"}}
        """);

    ExpressionEngine.Result result = new ExpressionEngine().evaluate(expression,
        ExpressionEngine.projection(definitions, answers, "2026-09-05", "UTC", 100_000));

    assertThat(result.state()).isEqualTo("available");
    assertThat(result.type()).isEqualTo("integer");
    assertThat(result.value().asText()).isEqualTo("42");
  }

  @Test
  void distinguishes_declared_but_inaccessible_fields_from_unknown_fields() throws Exception {
    JsonNode definitions = JSON.readTree("""
        [{"id":"items","type":"list","itemFields":[{"id":"amount","type":"decimal"}]}]
        """);
    ExpressionEngine.EvaluationContext context = ExpressionEngine.projection(
        definitions, JSON.readTree("{}"), "2026-09-05", "UTC", 100_000);

    ExpressionEngine.Result inaccessible = new ExpressionEngine().compile(
        JSON.readTree("{\"ref\":{\"fieldId\":\"amount\",\"scope\":\"root\"}}"), context);
    ExpressionEngine.Result unknown = new ExpressionEngine().compile(
        JSON.readTree("{\"ref\":{\"fieldId\":\"missing\",\"scope\":\"root\"}}"), context);

    assertThat(inaccessible.code()).isEqualTo("EXPR_SCOPE");
    assertThat(unknown.code()).isEqualTo("UNKNOWN_FIELD");
  }

}
