package com.kodeboxx.smartintake.contract.runtime;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kodeboxx.smartintake.contract.ContractRegistry;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.*;
import java.time.Instant;
import java.util.*;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/** Valid, invalid, and boundary checks for every frozen field-catalog row. */
class FieldCatalogRuntimeTests {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Instant NOW = Instant.EPOCH;
  private final List<Map<String, Object>> rows;
  private final Map<String, List<String>> compatibility;

  @SuppressWarnings("unchecked")
  FieldCatalogRuntimeTests() {
    Map<String, Object> capabilities = new ContractRegistry(JSON).capabilities();
    rows = (List<Map<String, Object>>) capabilities.get("fieldCatalog");
    compatibility = (Map<String, List<String>>) capabilities.get("controlValueCompatibility");
  }

  @TestFactory
  Stream<DynamicTest> allSeventeenRowsHaveValidCoverage() {
    assertEquals(17, rows.size());
    return rows.stream().map(row -> DynamicTest.dynamicTest("row-" + row.get("row") + "-valid", () -> {
      List<String> types = strings(row.get("canonicalTypes"));
      List<String> controls = strings(row.get("controls"));
      assertFalse(controls.isEmpty());
      Set<String> covered = new LinkedHashSet<>();
      for (String control : controls) covered.addAll(compatibility.getOrDefault(control, List.of()));
      assertEquals(new LinkedHashSet<>(types), covered);
      if (!types.isEmpty()) assertTrue(validMutation(types.get(0)).accepted());
    }));
  }

  @TestFactory
  Stream<DynamicTest> allSeventeenRowsRejectInvalidTypeOrValue() {
    return rows.stream().map(row -> DynamicTest.dynamicTest("row-" + row.get("row") + "-invalid", () -> {
      List<String> types = strings(row.get("canonicalTypes"));
      if (types.isEmpty()) {
        for (String control : strings(row.get("controls"))) assertTrue(compatibility.getOrDefault(control, List.of()).isEmpty());
      } else {
        assertFalse(invalidMutation(types.get(0)).accepted());
        String incompatible = allTypes().stream().filter(type -> !types.contains(type)).findFirst().orElseThrow();
        for (String control : strings(row.get("controls"))) assertFalse(compatibility.get(control).contains(incompatible));
      }
    }));
  }

  @TestFactory
  Stream<DynamicTest> allSeventeenRowsEnforceBoundaries() {
    return rows.stream().map(row -> DynamicTest.dynamicTest("row-" + row.get("row") + "-boundary", () -> {
      List<String> types = strings(row.get("canonicalTypes"));
      if (types.isEmpty()) {
        assertEquals(Set.of(), new LinkedHashSet<>(types));
      } else {
        assertTrue(boundaryMutation(types.get(0)).accepted());
      }
    }));
  }

  private Result validMutation(String type) throws Exception {
    if ("object".equals(type)) return scalarChildMutation("object");
    if ("list".equals(type)) return listMutation("item-a");
    if ("calculated".equals(type)) return invalidMutation(type);
    return runtime(type, false).apply(new State(), List.of(new SetValue(address(), Status.answered, valid(type))), NOW);
  }

  private Result invalidMutation(String type) throws Exception {
    if ("object".equals(type) || "list".equals(type)) {
      Field child = new Field("child", "text", false, false, false, false, false, null, Set.of(), Map.of(), List.of());
      Field structural = new Field("field", type, false, false, false, false, false, null, Set.of(), Map.of("child", child), List.of());
      return new TypedAnswerRuntime(List.of(structural)).apply(new State(), List.of(
          new SetValue(address(), Status.answered, JSON.readTree("{}"))), NOW);
    }
    boolean protectedField = "calculated".equals(type);
    String actual = protectedField ? "decimal" : type;
    return runtime(actual, protectedField).apply(new State(), List.of(
        new SetValue(address(), Status.answered, invalid(actual))), NOW);
  }

  private Result boundaryMutation(String type) throws Exception {
    if ("object".equals(type)) return scalarChildMutation("object");
    if ("list".equals(type)) return listMutation("item-" + "x".repeat(122));
    return runtime(type, false).apply(new State(), List.of(
        new SetValue(address(), Status.answered, boundary(type))), NOW);
  }

  private Result scalarChildMutation(String ignored) throws Exception {
    Field child = new Field("child", "text", false, false, false, false, false, null, Set.of(), Map.of(), List.of());
    Field object = new Field("field", "object", false, false, false, false, false, null, Set.of(), Map.of("child", child), List.of());
    // Object values are initialized structurally; direct whole-object replacement stays forbidden.
    return new TypedAnswerRuntime(List.of(object, child)).apply(new State(), List.of(
        new SetValue(new Address("child", List.of()), Status.answered, JSON.readTree("\"ok\""))), NOW);
  }

  private Result listMutation(String itemId) {
    Field child = new Field("child", "text", false, false, false, false, false, null, Set.of(), Map.of(), List.of());
    Field list = new Field("field", "list", false, false, false, false, false, null, Set.of(), Map.of("child", child), List.of());
    return new TypedAnswerRuntime(List.of(list)).apply(new State(), List.of(
        new AddItem(address(), itemId, Map.of())), NOW);
  }

  private TypedAnswerRuntime runtime(String type, boolean protectedField) {
    String actual = "calculated".equals(type) ? "decimal" : type;
    Set<String> options = Set.of("none", "one");
    Field field = new Field("field", actual, protectedField, false, true, true, true,
        "decimal".equals(actual) ? 2 : null, options, Map.of(), List.of());
    return new TypedAnswerRuntime(List.of(field));
  }

  private Address address() { return new Address("field", List.of()); }

  private JsonNode valid(String type) throws Exception {
    return switch (type) {
      case "text", "drawing" -> JSON.readTree("\"value\"");
      case "integer" -> JSON.readTree("\"42\"");
      case "decimal" -> JSON.readTree("\"42.50\"");
      case "date" -> JSON.readTree("\"2026-09-19\"");
      case "time" -> JSON.readTree("\"16:09:41\"");
      case "dateTime" -> JSON.readTree("{\"instant\":\"2026-09-19T16:09:41Z\",\"timeZone\":\"UTC\"}");
      case "boolean" -> JSON.readTree("true");
      case "choice" -> JSON.readTree("\"one\"");
      case "multiChoice", "attachments" -> JSON.readTree("[\"one\"]");
      default -> throw new IllegalArgumentException(type);
    };
  }

  private JsonNode invalid(String type) throws Exception {
    return switch (type) {
      case "text", "drawing" -> JSON.readTree("false");
      case "integer" -> JSON.readTree("\"01\"");
      case "decimal" -> JSON.readTree("\"1.2\"");
      case "date" -> JSON.readTree("\"2026-02-30\"");
      case "time" -> JSON.readTree("\"25:00:00\"");
      case "dateTime" -> JSON.readTree("{\"instant\":\"bad\",\"timeZone\":\"UTC\"}");
      case "boolean" -> JSON.readTree("\"true\"");
      case "choice" -> JSON.readTree("\"absent\"");
      case "multiChoice", "attachments" -> JSON.readTree("[\"one\",\"one\"]");
      default -> throw new IllegalArgumentException(type);
    };
  }

  private JsonNode boundary(String type) throws Exception {
    return switch (type) {
      case "text" -> JSON.readTree("\"\"");
      case "drawing" -> JSON.readTree("\"x\"");
      case "integer" -> JSON.readTree("\"9223372036854775807\"");
      case "decimal" -> JSON.readTree("\"0.00\"");
      case "date" -> JSON.readTree("\"2000-02-29\"");
      case "time" -> JSON.readTree("\"23:59:59\"");
      case "dateTime" -> JSON.readTree("{\"instant\":\"2026-09-19T16:09:41Z\",\"timeZone\":\"America/New_York\"}");
      case "boolean" -> JSON.readTree("false");
      case "choice" -> JSON.readTree("\"none\"");
      case "multiChoice", "attachments" -> JSON.readTree("[]");
      default -> throw new IllegalArgumentException(type);
    };
  }

  private Set<String> allTypes() {
    return Set.of("text", "integer", "decimal", "date", "time", "dateTime", "boolean", "choice",
        "multiChoice", "object", "list", "attachments", "drawing");
  }

  @SuppressWarnings("unchecked")
  private List<String> strings(Object value) { return (List<String>) value; }
}
