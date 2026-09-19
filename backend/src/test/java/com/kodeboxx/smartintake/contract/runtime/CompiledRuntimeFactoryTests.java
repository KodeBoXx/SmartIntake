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
    var compiled = new FormCompiler(new ContractRegistry(json)).compile(packageNode).compiled().orElseThrow();
    var runtime = new CompiledRuntimeFactory().create(compiled);
    var accepted = runtime.apply(new State(), List.of(new SetValue(
        new Address("amount", List.of()), Status.answered, json.readTree("\"7\""))), Instant.EPOCH);
    assertTrue(accepted.accepted(), () -> accepted.diagnostics().toString());
    var rejected = runtime.apply(new State(), List.of(new SetValue(
        new Address("amount", List.of()), Status.answered, json.readTree("7"))), Instant.EPOCH);
    assertFalse(rejected.accepted());
  }
}
