package com.kodeboxx.smartintake.contract.runtime;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.kodeboxx.smartintake.contract.ContractRegistry;
import com.kodeboxx.smartintake.contract.compiler.FormCompiler;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;

class CompiledRuntimeFactoryTests {
  @Test
  void runtimeUsesCompilerTypesAndProtectionInsteadOfPayloadInference() throws Exception {
    ObjectMapper json = new ObjectMapper();
    ObjectNode packageNode = (ObjectNode) json.readTree(Files.readString(
        Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/fixtures/package.positive.json")));
    ((ArrayNode) packageNode.at("/flow/phases/0/pages/0/sections/0/nodes"))
        .add(json.readTree("{\"id\":\"review\",\"kind\":\"review\",\"labelKey\":\"title\"}"));
    ContractRegistry registry = new ContractRegistry(json);
    var result = new FormCompiler(registry).compile(packageNode);
    assertTrue(result.valid(), () -> result.diagnostics().toString());
    var compiled = result.compiled().orElseThrow();
    var runtime = new CompiledRuntimeFactory().create(compiled);
    var accepted = runtime.apply(new State(), List.of(new SetValue(
        new Address("amount", List.of()), Status.answered, json.readTree("\"7\""))), Instant.EPOCH);
    assertTrue(accepted.accepted(), () -> accepted.diagnostics().toString());
    var rejected = runtime.apply(new State(), List.of(new SetValue(
        new Address("amount", List.of()), Status.answered, json.readTree("7"))), Instant.EPOCH);
    assertFalse(rejected.accepted());
    runtime.projection(accepted.state()).fields().forEachRemaining(entry -> {
      var validation = registry.validate("typed-answer", ContractRegistry.VERSION, entry.getValue());
      assertTrue(validation.valid(), () -> entry.getKey() + ": " + validation.diagnostics());
    });
  }

  @Test
  void runtimeAppliesDefaultsNormalizersAndAuthoredConstraints() throws Exception {
    ObjectMapper json = new ObjectMapper();
    ObjectNode packageNode = (ObjectNode) json.readTree(Files.readString(
        Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/fixtures/package.positive.json")));
    ((ArrayNode) packageNode.at("/flow/phases/0/pages/0/sections/0/nodes"))
        .add(json.readTree("{\"id\":\"review\",\"kind\":\"review\",\"labelKey\":\"title\"}"));
    ObjectNode name = (ObjectNode) packageNode.at("/data/fields/0");
    name.put("normalizer", "trim");
    name.set("default", json.readTree("{\"status\":\"answered\",\"value\":\" Ada \"}"));
    name.putObject("constraints").put("minLength", 2).put("maxLength", 5);
    ObjectNode amount = (ObjectNode) packageNode.at("/data/fields/1");
    amount.putObject("constraints").put("min", "0").put("max", "10").put("step", "2");
    var result = new FormCompiler(new ContractRegistry(json)).compile(packageNode);
    assertTrue(result.valid(), () -> result.diagnostics().toString());
    var compiled = result.compiled().orElseThrow();
    var runtime = new CompiledRuntimeFactory().create(compiled);
    State initial = runtime.initialize(Instant.parse("2026-09-19T17:00:00Z"));
    assertEquals("Ada", runtime.projection(initial).at("/name/value").asText());
    assertEquals("default", runtime.projection(initial).at("/name/provenance/source").asText());
    assertFalse(runtime.apply(initial, List.of(new SetValue(
        new Address("amount", List.of()), Status.answered, json.readTree("\"5\""))), Instant.EPOCH).accepted());
    assertFalse(runtime.apply(initial, List.of(new SetValue(
        new Address("amount", List.of()), Status.answered, json.readTree("\"12\""))), Instant.EPOCH).accepted());
    assertTrue(runtime.apply(initial, List.of(new SetValue(
        new Address("amount", List.of()), Status.answered, json.readTree("\"10\""))), Instant.EPOCH).accepted());
  }
}
