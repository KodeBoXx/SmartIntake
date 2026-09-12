package com.kodeboxx.smartintake.contract;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Executes a documented, supported subset of the authoritative handoff vectors. */
class ExpressionContractVectorTests {
  private static final Set<String> EXECUTED = Set.of("EXPR-001", "EXPR-003", "EXPR-004", "EXPR-005", "EXPR-006", "EXPR-007", "EXPR-008", "EXPR-009", "EXPR-011", "EXPR-015", "EXPR-016", "EXPR-017", "EXPR-018", "EXPR-019", "EXPR-020", "EXPR-021", "EXPR-027", "EXPR-028", "EXPR-029", "EXPR-034", "EXPR-036", "EXPR-043", "EXPR-044", "EXPR-045", "EXPR-046", "EXPR-048", "EXPR-049", "EXPR-050", "EXPR-051", "EXPR-073", "EXPR-081", "INT64-01", "INT64-02", "INT64-05");

  @Test void executes_supported_authoritative_vectors_without_claiming_full_conformance() throws Exception {
    Path fixture = Path.of("..", "docs", "source-handoff", "smart-form-builder-lite-prd-v1.1", "expression-contract.json");
    assertThat(Files.exists(fixture)).as("authoritative vector fixture").isTrue();
    JsonNode vectors = new ObjectMapper().readTree(Files.readString(fixture)).path("vectors");
    ExpressionEngine engine = new ExpressionEngine();
    int executed = 0;
    for (JsonNode vector : vectors) {
      String id = vector.path("id").asText();
      if (!EXECUTED.contains(id)) continue;
      JsonNode suppliedContext = vector.path("context");
      ExpressionEngine.Context context = new ExpressionEngine.Context(
          java.util.Map.of(),
          suppliedContext.path("sessionDate").asText("2026-09-05"),
          suppliedContext.path("sessionTimeZone").asText("UTC"),
          100_000);
      ExpressionEngine.Result result = engine.evaluate(vector.path("expression"), context);
      JsonNode expected = vector.path("expected");
      assertThat(result.state()).as(id).isEqualTo(expected.path("state").asText());
      assertThat(result.type()).as(id).isEqualTo(expected.path("type").asText(null));
      if (expected.has("value")) assertThat(result.value()).as(id).isEqualTo(expected.path("value"));
      executed++;
    }
    assertThat(executed).isEqualTo(EXECUTED.size());
    assertThat(vectors.size()).isGreaterThan(executed); // Explicitly proves this is a subset harness.
  }
}
