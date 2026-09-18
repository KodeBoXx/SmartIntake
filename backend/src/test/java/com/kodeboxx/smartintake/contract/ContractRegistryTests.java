package com.kodeboxx.smartintake.contract;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class ContractRegistryTests {
  private final ObjectMapper json = new ObjectMapper();
  private final ContractRegistry registry = new ContractRegistry(json);

  @Test
  void publishes_seven_schema_digests_catalogs_operations_and_exact_resource_bytes() throws Exception {
    var capabilities = registry.capabilities();
    assertThat((java.util.List<?>) capabilities.get("schemas")).hasSize(7);
    assertThat((java.util.List<?>) capabilities.get("fieldCatalog")).hasSize(17);
    assertThat((java.util.List<?>) capabilities.get("operatorSignatures")).hasSize(34);
    assertThat((java.util.List<?>) ((java.util.Map<?, ?>) capabilities.get("operations")).get("items")).hasSize(82);
    @SuppressWarnings("unchecked")
    var operations = (java.util.List<java.util.Map<String, Object>>) ((java.util.Map<?, ?>) capabilities.get("operations")).get("items");
    assertThat(operations.stream().filter(operation -> "/v1/schemas/{kind}/{version}".equals(operation.get("path"))).toList())
        .singleElement().satisfies(operation -> {
          assertThat(operation.get("implementationStatus")).isEqualTo("implemented");
          assertThat(operation.get("implementedRoute")).isEqualTo("/v1/schemas/{kind}/{version}");
        });
    assertThat((java.util.List<?>) capabilities.get("limits")).hasSize(11);
    assertThat(registry.schema("package", "4.0.0").bytes())
        .isEqualTo(Files.readAllBytes(Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/package.schema.json")));
    assertThat(registry.openApi().bytes()).isEqualTo(Files.readAllBytes(Path.of("../docs/api/openapi.yaml")));
  }

  @Test
  void validates_every_positive_and_rejects_every_negative_fixture_with_exact_kind_version() throws Exception {
    for (String kind : new String[] {"package", "expression", "input-answer", "typed-answer", "runtime-manifest", "submission-envelope", "event"}) {
      JsonNode positive = json.readTree(Files.readString(Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/fixtures/" + kind + ".positive.json")));
      JsonNode negative = json.readTree(Files.readString(Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/fixtures/" + kind + ".negative.json")));
      var valid = registry.validate(kind, "4.0.0", positive);
      var invalid = registry.validate(kind, "4.0.0", negative);
      assertThat(valid.kind()).isEqualTo(kind);
      assertThat(valid.version()).isEqualTo("4.0.0");
      assertThat(valid.valid()).isTrue();
      assertThat(invalid.valid()).isFalse();
      assertThat(invalid.diagnostics()).allSatisfy(diagnostic -> assertThat(diagnostic.pointer()).isNotNull());
    }
  }

  @Test
  void preserves_canonical_int64_decimal_strings_and_recursive_answer_items() throws Exception {
    JsonNode answer = json.readTree(Files.readString(Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/fixtures/input-answer.positive.json")));
    JsonNode typed = json.readTree(Files.readString(Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/fixtures/typed-answer.positive.json")));
    assertThat(answer.at("/value/items/0/fields/child/value").isTextual()).isTrue();
    assertThat(answer.at("/value/items/0/fields/child/value").asText()).isEqualTo("9007199254740993");
    assertThat(typed.at("/value/items/0/fields/amount/value").isTextual()).isTrue();
    assertThat(typed.at("/value/items/0/fields/amount/value").asText()).isEqualTo("44.75");
    assertThat(typed.at("/value/items/0/itemId").asText()).isEqualTo("item-1");
    assertThat(registry.validate("typed-answer", "4.0.0", typed).valid()).isTrue();
  }
}
