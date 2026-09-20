package com.kodeboxx.smartintake.contract;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.kodeboxx.smartintake.generated.contract.EventDocument;
import com.kodeboxx.smartintake.generated.contract.ExpressionDocument;
import com.kodeboxx.smartintake.generated.contract.InputAnswerDocument;
import com.kodeboxx.smartintake.generated.contract.PackageDocument;
import com.kodeboxx.smartintake.generated.contract.RuntimeManifestDocument;
import com.kodeboxx.smartintake.generated.contract.SubmissionEnvelopeDocument;
import com.kodeboxx.smartintake.generated.contract.TypedAnswerDocument;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.openapitools.jackson.nullable.JsonNullableModule;
import org.junit.jupiter.api.Test;

class GeneratedContractModelsTests {
  private final ObjectMapper json = new ObjectMapper()
      .registerModule(new JavaTimeModule())
      .registerModule(new JsonNullableModule())
      .setSerializationInclusion(JsonInclude.Include.NON_NULL)
      .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
  private static final Map<String, Class<?>> MODELS = Map.of(
      "package", PackageDocument.class,
      "expression", ExpressionDocument.class,
      "input-answer", InputAnswerDocument.class,
      "typed-answer", TypedAnswerDocument.class,
      "runtime-manifest", RuntimeManifestDocument.class,
      "submission-envelope", SubmissionEnvelopeDocument.class,
      "event", EventDocument.class);

  @Test
  void generated_models_round_trip_every_positive_fixture_without_scalar_loss() throws Exception {
    for (var entry : MODELS.entrySet()) {
      JsonNode source = json.readTree(Files.readString(Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/fixtures/" + entry.getKey() + ".positive.json")));
      Object model = json.treeToValue(source, entry.getValue());
      assertThat((JsonNode) json.valueToTree(model)).isEqualTo(source);
    }
  }

  @Test
  void generated_models_retain_canonical_int64_decimal_and_recursive_answers() throws Exception {
    JsonNode input = json.readTree(Files.readString(Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/fixtures/input-answer.positive.json")));
    JsonNode typed = json.readTree(Files.readString(Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/fixtures/typed-answer.positive.json")));
    InputAnswerDocument recursive = json.treeToValue(input, InputAnswerDocument.class);
    assertThat(json.valueToTree(recursive).at("/value/items/0/fields/child/value").asText()).isEqualTo("9007199254740993");
    assertThat(typed.at("/value/items/0/fields/amount/value").asText()).isEqualTo("44.75");
    assertThat((JsonNode) json.valueToTree(recursive)).isEqualTo(input);
  }

  @Test
  void contract_registry_rejects_invalid_json_before_transport_dto_deserialization() throws Exception {
    ContractRegistry registry = new ContractRegistry(json);
    JsonNode valid = json.readTree("{\"literal\":{\"type\":\"integer\",\"value\":\"9223372036854775807\"}}");
    JsonNode invalid = json.readTree("{\"literal\":{\"type\":\"integer\",\"value\":\"9223372036854775808\"}}");
    assertThat(json.treeToValue(registry.requireValid("expression", "4.0.0", valid), ExpressionDocument.class)).isNotNull();
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> registry.requireValid("expression", "4.0.0", invalid))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("Contract validation failed");
  }

  @Test
  void additiveApiModelsExposeAllRecursiveMutationFieldsInAVersionedPackage() throws Exception {
    Class<?> mutation = com.kodeboxx.smartintake.generated.contract.v410.SessionMutation.class;
    assertThat(mutation.getMethod("getRowPath")).isNotNull();
    assertThat(mutation.getMethod("getValue")).isNotNull();
    assertThat(mutation.getMethod("getReason")).isNotNull();
    assertThat(mutation.getMethod("getInitialFields")).isNotNull();
    assertThat(mutation.getMethod("getBeforeItemId")).isNotNull();
    assertThat(com.kodeboxx.smartintake.generated.contract.v410.SessionMutationOneOf.class).isNotNull();
    assertThat(com.kodeboxx.smartintake.generated.contract.v410.SessionMutationOneOf1.class).isNotNull();
    assertThat(com.kodeboxx.smartintake.generated.contract.v410.SessionMutationOneOf2.class).isNotNull();
    assertThat(com.kodeboxx.smartintake.generated.contract.v410.SessionMutationOneOf3.class).isNotNull();
    assertThat(com.kodeboxx.smartintake.generated.contract.v410.SessionMutationOneOf4.class).isNotNull();
    assertThat(com.kodeboxx.smartintake.generated.contract.v410.SessionMutationOneOf5.class).isNotNull();
  }
}
