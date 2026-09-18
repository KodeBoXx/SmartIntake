package com.kodeboxx.smartintake.contract;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kodeboxx.smartintake.web.ContractPublicationController;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class ContractPublicationControllerTests {
  private final ContractRegistry registry = new ContractRegistry(new ObjectMapper());
  private final ContractPublicationController controller = new ContractPublicationController(registry, new ObjectMapper());

  @Test
  void serves_exact_schema_bytes_with_digest_etag_and_immutable_cache_headers() throws Exception {
    var response = controller.schema("package", "4.0.0");
    assertThat(response.getBody()).isEqualTo(Files.readAllBytes(Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/package.schema.json")));
    assertThat(response.getHeaders().getETag()).isEqualTo('"' + registry.schema("package", "4.0.0").sha256() + '"');
    assertThat(response.getHeaders().getCacheControl()).contains("max-age=31536000").contains("immutable");
    assertThat(response.getHeaders().getFirst("X-Contract-SHA256")).isEqualTo(registry.schema("package", "4.0.0").sha256());
    assertThat(response.getHeaders().getFirst("Digest")).startsWith("SHA-256=");
  }

  @Test
  void serves_exact_openapi_bytes_and_registry_derived_capabilities() throws Exception {
    var openapi = controller.openApi();
    assertThat(openapi.getBody()).isEqualTo(Files.readAllBytes(Path.of("../docs/api/openapi.yaml")));
    assertThat(controller.capabilities()).isSameAs(registry.capabilities());
  }

  @Test
  void rejects_validation_payloads_over_the_public_one_megabyte_bound() {
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> controller.validate("package", "4.0.0", new byte[1_048_577]))
        .isInstanceOf(ResponseStatusException.class)
        .extracting(error -> ((ResponseStatusException) error).getStatusCode().value()).isEqualTo(413);
  }
}
