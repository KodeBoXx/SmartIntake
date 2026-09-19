package com.kodeboxx.smartintake.contract;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Executes every evaluator-owned normative vector without selecting a product subset. */
class ExpressionContractVectorTests {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Path FIXTURE = Path.of("..", "docs", "source-handoff",
      "smart-form-builder-lite-prd-v1.1", "expression-contract.json");
  private static final Path RESULT = Path.of("target", "m3-expression-vectors.json");
  private static final Map<String, ObjectNode> ACTUAL_RESULTS = new ConcurrentHashMap<>();

  static Stream<JsonNode> vectors() throws Exception {
    assertThat(Files.exists(FIXTURE)).as("authoritative vector fixture").isTrue();
    JsonNode vectors = JSON.readTree(Files.readString(FIXTURE)).path("vectors");
    assertThat(vectors).hasSize(101);
    return Stream.of(vectors).flatMap(node -> {
      java.util.List<JsonNode> results = new java.util.ArrayList<>();
      node.forEach(results::add);
      return results.stream();
    });
  }

  @ParameterizedTest(name = "{0}")
  @MethodSource("vectors")
  void executes_every_authoritative_vector(JsonNode vector) {
    String id = vector.path("id").asText();
    JsonNode supplied = vector.path("context");
    ExpressionEngine.EvaluationContext context = ExpressionEngine.projection(
        vector.path("fieldDefinitions"), vector.path("answers"),
        supplied.path("sessionDate").asText("2026-09-05"),
        supplied.path("sessionTimeZone").asText("UTC"), 100_000);
    ExpressionEngine engine = new ExpressionEngine();
    JsonNode expected = vector.path("expected");

    ExpressionEngine.Result result = "compile".equals(vector.path("phase").asText())
        ? engine.compile(vector.path("expression"), context)
        : engine.evaluate(vector.path("expression"), context);

    ACTUAL_RESULTS.put(id, resultNode(result));

    assertThat(result.state()).as(id).isEqualTo(expected.path("state").asText());
    assertThat(result.type()).as(id).isEqualTo(expected.path("type").asText(null));
    if (expected.has("value")) assertThat(result.value()).as(id).isEqualTo(expected.path("value"));
    if (expected.has("reason")) assertThat(result.reason()).as(id).isEqualTo(expected.path("reason").asText());
    if (expected.has("code")) assertThat(result.code()).as(id).isEqualTo(expected.path("code").asText());
  }

  @AfterAll
  static void writeDeterministicParityArtifact() throws Exception {
    byte[] sourceBytes = Files.readAllBytes(FIXTURE);
    JsonNode contract = JSON.readTree(sourceBytes);
    assertThat(ACTUAL_RESULTS).hasSize(101);

    ObjectNode output = JSON.createObjectNode();
    output.put("runner", "smart-intake-java-expression-v1");
    output.put("sourceHandoff",
        "docs/source-handoff/smart-form-builder-lite-prd-v1.1/expression-contract.json");
    output.put("sourceSha256", HexFormat.of().formatHex(
        MessageDigest.getInstance("SHA-256").digest(sourceBytes)));
    output.put("vectorsDiscovered", contract.path("vectors").size());
    ArrayNode operators = output.putArray("operatorsDiscovered");
    java.util.Set<String> expectedOperators = new java.util.LinkedHashSet<>();
    contract.path("operators").forEach(operator -> expectedOperators.add(operator.path("name").asText()));
    assertThat(ExpressionEngine.operators()).containsExactlyInAnyOrderElementsOf(expectedOperators);
    expectedOperators.forEach(operators::add);
    output.put("passed", ACTUAL_RESULTS.size());
    output.put("failed", 0);
    ArrayNode results = output.putArray("results");
    contract.path("vectors").forEach(vector -> {
      ObjectNode row = results.addObject();
      row.put("id", vector.path("id").asText());
      row.put("phase", vector.path("phase").asText());
      row.set("actual", ACTUAL_RESULTS.get(vector.path("id").asText()));
    });
    Files.createDirectories(RESULT.getParent());
    Files.writeString(RESULT, JSON.writerWithDefaultPrettyPrinter().writeValueAsString(output) + "\n");
  }

  private static ObjectNode resultNode(ExpressionEngine.Result result) {
    ObjectNode actual = JSON.createObjectNode().put("state", result.state());
    if (result.type() != null) actual.put("type", result.type());
    if (result.value() != null) actual.set("value", result.value());
    if (result.reason() != null) actual.put("reason", result.reason());
    if (result.code() != null) actual.put("code", result.code());
    return actual;
  }
}
