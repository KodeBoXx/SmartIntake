package com.kodeboxx.smartintake.web;

import com.kodeboxx.smartintake.contract.ContractRegistry;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

/** M2 publication endpoints. They publish contract bytes, not M3+ evaluator behavior. */
@RestController
@RequestMapping("/v1")
public class ContractPublicationController {
  private final ContractRegistry contracts;

  public ContractPublicationController(ContractRegistry contracts) { this.contracts = contracts; }

  @GetMapping("/capabilities")
  public Map<String, Object> capabilities() { return contracts.capabilities(); }

  @GetMapping(value = "/schemas/{kind}/{version}", produces = "application/schema+json")
  public ResponseEntity<byte[]> schema(@PathVariable String kind, @PathVariable String version) {
    try { return immutable(contracts.schema(kind, version).document(), MediaType.parseMediaType("application/schema+json")); }
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
