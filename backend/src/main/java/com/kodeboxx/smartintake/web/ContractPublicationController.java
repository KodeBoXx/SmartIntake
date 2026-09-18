package com.kodeboxx.smartintake.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kodeboxx.smartintake.contract.ContractRegistry;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

/** M2 publication endpoints. They publish contract bytes, not M3+ evaluator behavior. */
@RestController
@RequestMapping("/v1")
public class ContractPublicationController {
  private static final int MAX_VALIDATION_BYTES = 1_048_576;
  private final ContractRegistry contracts;
  private final ObjectMapper json;

  public ContractPublicationController(ContractRegistry contracts, ObjectMapper json) { this.contracts = contracts; this.json = json; }

  @GetMapping("/capabilities")
  public Map<String, Object> capabilities() { return contracts.capabilities(); }

  @GetMapping(value = "/schemas/{kind}/{version}", produces = "application/schema+json")
  public ResponseEntity<byte[]> schema(@PathVariable String kind, @PathVariable String version) {
    try { return immutable(contracts.schema(kind, version).document(), MediaType.parseMediaType("application/schema+json")); }
    catch (ContractRegistry.UnknownContract ignored) { throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown contract schema"); }
  }

  @GetMapping(value = "/openapi", produces = {"application/yaml", "text/yaml"})
  public ResponseEntity<byte[]> openApi() { return immutable(contracts.openApi(), MediaType.parseMediaType("application/yaml")); }

  @PostMapping(value = "/schemas/{kind}/{version}/validate", produces = MediaType.APPLICATION_JSON_VALUE)
  public ContractRegistry.ValidationResult validate(
      @PathVariable String kind, @PathVariable String version, @RequestBody byte[] body) {
    if (body.length > MAX_VALIDATION_BYTES) throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Validation payload exceeds 1048576 bytes");
    try { return contracts.validate(kind, version, json.readTree(body)); }
    catch (java.io.IOException ignored) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid JSON validation payload"); }
    catch (ContractRegistry.UnknownContract ignored) { throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown contract schema"); }
  }

  private ResponseEntity<byte[]> immutable(ContractRegistry.PublishedDocument document, MediaType mediaType) {
    return ResponseEntity.ok()
        .contentType(mediaType)
        .contentLength(document.bytes().length)
        .eTag('"' + document.sha256() + '"')
        .cacheControl(CacheControl.maxAge(java.time.Duration.ofDays(365)).cachePublic().immutable())
        .header("Digest", document.digestHeader())
        .header("X-Contract-SHA256", document.sha256())
        .body(document.bytes());
  }
}
