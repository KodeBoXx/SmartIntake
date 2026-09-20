package com.kodeboxx.smartintake.contract;

import static org.assertj.core.api.Assertions.assertThat;

import com.kodeboxx.smartintake.web.ContractPublicationController;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class ContractPublicationControllerTests {
  private final ContractRegistry registry = new ContractRegistry(new com.fasterxml.jackson.databind.ObjectMapper());
  private final ContractPublicationController controller = new ContractPublicationController(registry);

  @Test
  void serves_exact_schema_bytes_with_digest_etag_and_immutable_cache_headers() throws Exception {
    for (String kind : new String[] {"package", "expression", "input-answer", "typed-answer", "runtime-manifest", "submission-envelope", "event"}) {
      var response = controller.schema(kind, "4.0.0");
      assertThat(response.getBody()).isEqualTo(Files.readAllBytes(Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/" + kind + ".schema.json")));
      assertThat(response.getHeaders().getContentType().toString()).startsWith("application/schema+json");
      assertThat(response.getHeaders().getETag()).isEqualTo('"' + registry.schema(kind, "4.0.0").sha256() + '"');
      assertThat(response.getHeaders().getCacheControl()).contains("max-age=31536000").contains("immutable");
      assertThat(response.getHeaders().getFirst("X-Contract-SHA256")).isEqualTo(registry.schema(kind, "4.0.0").sha256());
      assertThat(response.getHeaders().getFirst("Digest")).startsWith("SHA-256=");
    }
  }

  @Test
  void serves_registry_derived_capabilities() {
    assertThat(controller.capabilities()).isSameAs(registry.capabilities());
  }

  @Test
  void publishesBothImmutableApiVersionsThroughTheVersionedContractRoute() throws Exception {
    assertThat(controller.schema("openapi", "4.0.0").getBody())
        .isEqualTo(Files.readAllBytes(Path.of("../docs/api/openapi.yaml")));
    var m4 = controller.schema("openapi", "4.1.0");
    assertThat(m4.getBody()).isEqualTo(Files.readAllBytes(Path.of("../docs/api/openapi-4.1.0.yaml")));
    assertThat(m4.getHeaders().getContentType().toString()).isEqualTo("application/yaml");
    assertThat(m4.getHeaders().getFirst("X-Contract-SHA256"))
        .isEqualTo(registry.openApi("4.1.0").sha256());
  }
}
