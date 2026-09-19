package com.kodeboxx.smartintake.contract.runtime;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.kodeboxx.smartintake.contract.ContractRegistry;
import com.kodeboxx.smartintake.contract.compiler.FormCompiler;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;

class TypedSessionRuntimeServiceTests {
  private static final Instant NOW = Instant.parse("2026-09-19T16:09:41Z");
  private final ObjectMapper json = new ObjectMapper();
  private final TypedSessionRuntimeService service = new TypedSessionRuntimeService(
      json, new FormCompiler(new ContractRegistry(json)));

  @Test
  void appliesTypedOperationsAndReturnsTheAuthoritativeProjection() throws Exception {
    ObjectNode pkg = canonical();
    var result = service.mutate(pkg, json.createObjectNode(), List.of(
        Map.of("op", "set", "fieldId", "amount", "value", "9223372036854775807"),
        Map.of("op", "addItem", "fieldId", "attendees", "itemId", "attendee-a", "fields",
            Map.of("attendeeName", Map.of("status", "answered", "value", "Ada")))),
        "2026-09-19", "UTC", NOW);
    assertTrue(result.accepted(), () -> result.validation().toString());
    assertEquals("integer", json.valueToTree(result.answers()).at("/amount/type").asText());
    assertEquals("9223372036854775807", json.valueToTree(result.answers()).at("/amount/value").asText());
    assertEquals("attendee-a", json.valueToTree(result.answers()).at("/attendees/value/items/0/itemId").asText());
    assertEquals("Ada", json.valueToTree(result.answers())
        .at("/attendees/value/items/0/fields/attendeeName/value").asText());
  }

  @Test
  void rejectsTheWholeAtomicBatchWhenAProtectedFieldIsForged() throws Exception {
    ObjectNode pkg = canonical();
    ((ObjectNode) pkg.at("/data/fields/1")).put("readOnly", true);
    var result = service.mutate(pkg, json.createObjectNode(), List.of(
        Map.of("op", "set", "fieldId", "name", "value", "Ada"),
        Map.of("op", "set", "fieldId", "amount", "value", "7")),
        "2026-09-19", "UTC", NOW);
    assertFalse(result.accepted());
    assertEquals(List.of("READ_ONLY_FIELD"), result.validation().stream().map(value -> value.get("code")).toList());
    assertEquals("unanswered", json.valueToTree(result.answers()).at("/name/status").asText());
    assertTrue(json.valueToTree(result.answers()).at("/name/value").isMissingNode());
  }

  private ObjectNode canonical() throws Exception {
    ObjectNode pkg = (ObjectNode) json.readTree(Files.readString(
        Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/fixtures/package.positive.json")));
    ((ArrayNode) pkg.at("/flow/phases/0/pages/0/sections/0/nodes"))
        .add(json.readTree("{\"id\":\"review\",\"kind\":\"review\",\"labelKey\":\"title\"}"));
    return pkg;
  }
}
