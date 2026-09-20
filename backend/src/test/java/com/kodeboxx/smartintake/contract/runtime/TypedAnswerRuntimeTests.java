package com.kodeboxx.smartintake.contract.runtime;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;

class TypedAnswerRuntimeTests {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Instant NOW = Instant.parse("2026-09-19T12:00:00Z");

  private Field scalar(String id, String type) {
    return new Field(id, type, false, false, true, true, true, null, Set.of(), Map.of(), List.of());
  }

  @Test
  void preservesExactInt64AndDeclaredDecimalScale() throws Exception {
    var runtime = new TypedAnswerRuntime(List.of(
        scalar("integer", "integer"),
        new Field("money", "decimal", false, false, false, false, false, 2, Set.of(), Map.of(), List.of())));
    var result = runtime.apply(new State(), List.of(
        new SetValue(new Address("integer", List.of()), Status.answered, JSON.readTree("\"9223372036854775807\"")),
        new SetValue(new Address("money", List.of()), Status.answered, JSON.readTree("\"12.50\""))), NOW);
    assertTrue(result.accepted());
    assertEquals("9223372036854775807", result.state().cells().get(new Address("integer", List.of())).value().textValue());
    assertEquals("12.50", result.state().cells().get(new Address("money", List.of())).value().textValue());
    assertFalse(runtime.apply(result.state(), List.of(
        new SetValue(new Address("money", List.of()), Status.answered, JSON.readTree("\"12.5\""))), NOW).accepted());
  }

  @Test
  void supportsAllRespondentStatusesAndRejectsSystemStatus() throws Exception {
    var runtime = new TypedAnswerRuntime(List.of(scalar("answer", "text")));
    for (Status status : List.of(Status.answered, Status.unanswered, Status.unknown, Status.declined, Status.respondentNotApplicable)) {
      var value = status == Status.answered ? JSON.readTree("\"value\"") : null;
      assertTrue(runtime.apply(new State(), List.of(new SetValue(new Address("answer", List.of()), status, value)), NOW).accepted());
    }
    assertFalse(runtime.apply(new State(), List.of(
        new SetValue(new Address("answer", List.of()), Status.notApplicable, null)), NOW).accepted());
  }

  @Test
  void acceptsNoForgedCalculatedOrReadOnlyValues() throws Exception {
    var runtime = new TypedAnswerRuntime(List.of(
        new Field("total", "decimal", true, false, false, false, false, null, Set.of(), Map.of(), List.of()),
        new Field("notice", "text", false, true, false, false, false, null, Set.of(), Map.of(), List.of())));
    var result = runtime.apply(new State(), List.of(
        new SetValue(new Address("total", List.of()), Status.answered, JSON.readTree("\"999.99\"")),
        new SetValue(new Address("notice", List.of()), Status.answered, JSON.readTree("\"forged\""))), NOW);
    assertFalse(result.accepted());
    assertEquals(0, result.acceptedOperations());
    assertSame(result.state(), result.state());
    assertTrue(result.state().cells().isEmpty());
    assertEquals(List.of("READ_ONLY_FIELD", "READ_ONLY_FIELD"), result.diagnostics().stream().map(Diagnostic::code).toList());
  }

  @Test
  void keepsFiftyItemIdentitiesAcrossMoveAndDeleteAndForbidsReuse() throws Exception {
    Field quantity = scalar("quantity", "integer");
    Field list = new Field("equipment", "list", false, false, false, false, false, null, Set.of(), Map.of("quantity", quantity), List.of());
    var runtime = new TypedAnswerRuntime(List.of(list));
    State state = new State();
    Address listAddress = new Address("equipment", List.of());
    for (int i = 1; i <= 50; i++) {
      String id = "item-" + i;
      var value = new SetValue(new Address("quantity", List.of()), Status.answered, JSON.readTree("\"" + i + "\""));
      var result = runtime.apply(state, List.of(new AddItem(listAddress, id, Map.of("quantity", value))), NOW);
      assertTrue(result.accepted(), () -> result.diagnostics().toString());
      state = result.state();
    }
    state = runtime.apply(state, List.of(new MoveItem(listAddress, "item-50", "item-1")), NOW).state();
    assertEquals("item-50", state.itemIds(listAddress).get(0));
    for (int i = 1; i <= 50; i++) {
      Address quantityAddress = new Address("quantity", List.of(new RowSegment("equipment", "item-" + i)));
      assertEquals(Integer.toString(i), state.cells().get(quantityAddress).value().textValue());
    }
    state = runtime.apply(state, List.of(new RemoveItem(listAddress, "item-25")), NOW).state();
    assertEquals(49, state.itemIds(listAddress).size());
    assertFalse(runtime.apply(state, List.of(new AddItem(listAddress, "item-25", Map.of())), NOW).accepted());
  }

  @Test
  void appliesThreeNestedLevelsWithStableRowPaths() throws Exception {
    Field result = scalar("result", "choice");
    Field tests = new Field("tests", "list", false, false, false, false, false, null, Set.of(), Map.of("result", result), List.of());
    Field accessories = new Field("accessories", "list", false, false, false, false, false, null, Set.of(), Map.of("tests", tests), List.of());
    Field equipment = new Field("equipment", "list", false, false, false, false, false, null, Set.of(), Map.of("accessories", accessories), List.of());
    var runtime = new TypedAnswerRuntime(List.of(equipment));
    State state = runtime.apply(new State(), List.of(new AddItem(new Address("equipment", List.of()), "equip-a", Map.of())), NOW).state();
    Address accessoriesAddress = new Address("accessories", List.of(new RowSegment("equipment", "equip-a")));
    state = runtime.apply(state, List.of(new AddItem(accessoriesAddress, "accessory-a", Map.of())), NOW).state();
    Address testsAddress = new Address("tests", List.of(new RowSegment("equipment", "equip-a"), new RowSegment("accessories", "accessory-a")));
    state = runtime.apply(state, List.of(new AddItem(testsAddress, "test-a", Map.of())), NOW).state();
    Address resultAddress = new Address("result", List.of(
        new RowSegment("equipment", "equip-a"),
        new RowSegment("accessories", "accessory-a"),
        new RowSegment("tests", "test-a")));
    var finalResult = runtime.apply(state, List.of(new SetValue(resultAddress, Status.answered, JSON.readTree("\"pass\""))), NOW);
    assertTrue(finalResult.accepted(), () -> finalResult.diagnostics().toString());
    assertEquals("pass", finalResult.state().cells().get(resultAddress).value().textValue());
    assertThrows(IllegalArgumentException.class, () -> new Address("too-deep", List.of(
        new RowSegment("a", "1"), new RowSegment("b", "2"), new RowSegment("c", "3"), new RowSegment("d", "4"))));
  }

  @Test
  void fixedRowsCannotBeAddedRemovedOrMoved() {
    Field value = scalar("value", "boolean");
    Field fixed = new Field("checks", "list", false, false, false, false, false, null, Set.of(), Map.of("value", value), List.of("power", "space"));
    var runtime = new TypedAnswerRuntime(List.of(fixed));
    Address address = new Address("checks", List.of());
    State initial = runtime.initialize();
    assertEquals(List.of("power", "space"), initial.itemIds(address));
    assertFalse(runtime.apply(initial, List.of(new AddItem(address, "other", Map.of())), NOW).accepted());
    assertFalse(runtime.apply(initial, List.of(new RemoveItem(address, "power")), NOW).accepted());
    var moved = runtime.apply(initial, List.of(new MoveItem(address, "space", "power")), NOW);
    assertFalse(moved.accepted());
    assertEquals(List.of("power", "space"), moved.state().itemIds(address));
  }

  @Test
  void batchIsAtomicWhenAnyOperationFails() throws Exception {
    var runtime = new TypedAnswerRuntime(List.of(scalar("name", "text"), scalar("count", "integer")));
    var result = runtime.apply(new State(), List.of(
        new SetValue(new Address("name", List.of()), Status.answered, JSON.readTree("\"Ada\"")),
        new SetValue(new Address("count", List.of()), Status.answered, JSON.readTree("\"01\""))), NOW);
    assertFalse(result.accepted());
    assertEquals(0, result.acceptedOperations());
    assertTrue(result.state().cells().isEmpty());
  }

  @Test
  void hiddenRetentionNeverLeaksIntoEffectiveProjectionAndRestoresByStableAddress() throws Exception {
    var runtime = new TypedAnswerRuntime(List.of(scalar("private", "text")));
    Address address = new Address("private", List.of());
    State answered = runtime.apply(new State(), List.of(
        new SetValue(address, Status.answered, JSON.readTree("\"retained\""))), NOW).state();
    State hidden = runtime.projectApplicability(answered, Map.of(address, false), NOW.plusSeconds(1));
    assertEquals(Status.notApplicable, hidden.cells().get(address).status());
    assertNull(hidden.cells().get(address).value());
    assertEquals("retained", hidden.retainedCells().get(address).value().textValue());
    State restored = runtime.projectApplicability(hidden, Map.of(address, true), NOW.plusSeconds(2));
    assertEquals("retained", restored.cells().get(address).value().textValue());
    assertTrue(restored.retainedCells().isEmpty());
  }

  @Test
  void memoryRetentionRestoresInProcessButIsNotPersisted() throws Exception {
    Field memory = new Field("private", "text", false, false, false, false, false, null,
        Set.of(), Map.of(), List.of(), "memory", "preserve", null,
        null, null, null, null, null, null, null, Set.of());
    var runtime = new TypedAnswerRuntime(List.of(memory));
    Address address = new Address("private", List.of());
    State answered = runtime.apply(runtime.initialize(), List.of(
        new SetValue(address, Status.answered, JSON.readTree("\"retained\""))), NOW).state();
    State hidden = runtime.projectApplicability(answered, Map.of(address, false), NOW.plusSeconds(1));
    assertEquals("retained", runtime.projectApplicability(hidden, Map.of(address, true), NOW.plusSeconds(2))
        .cells().get(address).value().textValue());
    State restarted = runtime.fromStorage(runtime.storage(hidden));
    State reopened = runtime.projectApplicability(restarted, Map.of(address, true), NOW.plusSeconds(3));
    assertEquals(Status.unanswered, reopened.cells().get(address).status());
    assertNull(reopened.cells().get(address).value());
  }

  @Test
  void recursiveProjectionPreservesListOrderTypesAndServerProvenance() throws Exception {
    Field name = scalar("name", "text");
    Field people = new Field("people", "list", false, false, false, false, false, null,
        Set.of(), Map.of("name", name), List.of());
    var runtime = new TypedAnswerRuntime(List.of(people));
    var initial = new SetValue(new Address("name", List.of()), Status.answered, JSON.readTree("\"Ada\""));
    State state = runtime.apply(new State(), List.of(
        new AddItem(new Address("people", List.of()), "person-a", Map.of("name", initial))), NOW).state();
    var projection = runtime.projection(state);
    assertEquals("list", projection.at("/people/type").asText());
    assertEquals("person-a", projection.at("/people/value/items/0/itemId").asText());
    assertEquals("text", projection.at("/people/value/items/0/fields/name/type").asText());
    assertEquals("respondent", projection.at("/people/value/items/0/fields/name/provenance/source").asText());
  }

  @Test
  void enforcesCollectionLimitBeforeMutation() {
    Field child = scalar("child", "text");
    Field list = new Field("rows", "list", false, false, false, false, false, null,
        Set.of(), Map.of("child", child), List.of());
    var runtime = new TypedAnswerRuntime(List.of(list));
    Address address = new Address("rows", List.of());
    List<AddItem> operations = new ArrayList<>();
    for (int index = 0; index < TypedAnswerRuntime.MAX_ITEMS_PER_LIST; index++) {
      operations.add(new AddItem(address, "item-" + index, Map.of()));
    }
    Result full = runtime.apply(new State(), operations, NOW);
    assertTrue(full.accepted());
    Result overflow = runtime.apply(full.state(), List.of(new AddItem(address, "item-overflow", Map.of())), NOW);
    assertFalse(overflow.accepted());
    assertEquals(TypedAnswerRuntime.MAX_ITEMS_PER_LIST, overflow.state().itemIds(address).size());
  }

  @Test
  void projectionRoundTripsWithoutInferringTypesOrChangingItemIdentity() throws Exception {
    Field name = scalar("name", "text");
    Field people = new Field("people", "list", false, false, false, false, false, null,
        Set.of(), Map.of("name", name), List.of());
    var runtime = new TypedAnswerRuntime(List.of(people));
    State state = runtime.apply(new State(), List.of(new AddItem(
        new Address("people", List.of()), "person-a", Map.of("name",
            new SetValue(new Address("name", List.of()), Status.answered, JSON.readTree("\"Ada\""))))), NOW).state();
    var projection = runtime.projection(state);
    assertEquals(projection, runtime.projection(runtime.fromProjection(projection)));
    ((com.fasterxml.jackson.databind.node.ObjectNode) projection.at("/people/value/items/0/fields/name")).put("type", "integer");
    assertThrows(IllegalArgumentException.class, () -> runtime.fromProjection(projection));
  }

  @Test
  void hiddenCollectionsRetainRowsPrivatelyAndRejectClientMutation() {
    Field child = scalar("child", "text");
    Field rows = new Field("rows", "list", false, false, false, false, false, null,
        Set.of(), Map.of("child", child), List.of());
    var runtime = new TypedAnswerRuntime(List.of(rows));
    Address address = new Address("rows", List.of());
    AddItem add = new AddItem(address, "row-a", Map.of(
        "child", new SetValue(new Address("child", List.of()), Status.answered,
            com.fasterxml.jackson.databind.node.TextNode.valueOf("retained"))));
    State populated = runtime.apply(new State(), List.of(add), NOW).state();
    State hidden = runtime.projectApplicability(populated, Map.of(address, false), NOW.plusSeconds(1));
    hidden = runtime.fromStorage(runtime.storage(hidden));
    assertEquals("notApplicable", runtime.projection(hidden).at("/rows/status").asText());
    assertTrue(runtime.projection(hidden).at("/rows/value").isMissingNode());
    assertEquals(List.of("row-a"), hidden.itemIds(address));
    assertFalse(runtime.apply(hidden, List.of(new RemoveItem(address, "row-a")), NOW.plusSeconds(2)).accepted());
    State restored = runtime.projectApplicability(hidden, Map.of(address, true), NOW.plusSeconds(3));
    assertEquals("row-a", runtime.projection(restored).at("/rows/value/items/0/itemId").asText());
    assertEquals("retained", runtime.projection(restored).at("/rows/value/items/0/fields/child/value").asText());
  }

  @Test
  void cellValuesRemainImmutableAcrossAccessAndStateCopies() throws Exception {
    var runtime = new TypedAnswerRuntime(List.of(scalar("choices", "multiChoice")));
    Address address = new Address("choices", List.of());
    State original = runtime.apply(new State(), List.of(new SetValue(
        address, Status.answered, JSON.readTree("[\"a\"]"))), NOW).state();
    State copy = original.copy();
    ((ArrayNode) original.cells().get(address).value()).add("forged");
    assertEquals(1, original.cells().get(address).value().size());
    assertEquals(1, copy.cells().get(address).value().size());
  }

  @Test
  void invalidMarkerHidesPreviousTypedValueUntilRespondentReentry() throws Exception {
    var runtime = new TypedAnswerRuntime(List.of(scalar("name", "text")));
    Address address = new Address("name", List.of());
    State answered = runtime.apply(runtime.initialize(), List.of(
        new SetValue(address, Status.answered, JSON.readTree("\"old value\""))), NOW).state();
    State invalid = runtime.apply(answered, List.of(new MarkInvalid(address)), NOW.plusSeconds(1)).state();
    assertEquals("unanswered", runtime.projection(invalid).at("/name/status").asText());
    assertFalse(runtime.projection(invalid).at("/name").has("value"));
    assertTrue(invalid.cells().get(address).needsReentry());
    assertEquals("old value", invalid.retainedCells().get(address).value().textValue());
    State corrected = runtime.apply(invalid, List.of(
        new SetValue(address, Status.answered, JSON.readTree("\"new value\""))), NOW.plusSeconds(2)).state();
    assertFalse(corrected.cells().get(address).needsReentry());
    assertFalse(corrected.retainedCells().containsKey(address));
  }

  @Test
  void structuralClearRetiresAllNestedItemIdsAndRemovesRows() {
    Field leaf = scalar("leaf", "text");
    Field inner = new Field("inner", "list", false, false, false, false, false, null,
        Set.of(), Map.of("leaf", leaf), List.of());
    Field outer = new Field("outer", "list", false, false, false, false, false, null,
        Set.of(), Map.of("inner", inner), List.of());
    var runtime = new TypedAnswerRuntime(List.of(outer));
    Address outerAddress = new Address("outer", List.of());
    State outerAdded = runtime.apply(new State(), List.of(
        new AddItem(outerAddress, "outer-a", Map.of())), NOW).state();
    Address innerAddress = new Address("inner", List.of(new RowSegment("outer", "outer-a")));
    State nested = runtime.apply(outerAdded, List.of(new AddItem(innerAddress, "inner-a", Map.of())), NOW).state();
    State cleared = runtime.apply(nested, List.of(new Clear(outerAddress)), NOW.plusSeconds(1)).state();
    assertEquals("unanswered", runtime.projection(cleared).at("/outer/status").asText());
    assertTrue(cleared.retired(outerAddress, "outer-a"));
    assertTrue(cleared.retired(innerAddress, "inner-a"));
    assertFalse(runtime.apply(cleared, List.of(new AddItem(outerAddress, "inner-a", Map.of())),
        NOW.plusSeconds(2)).accepted());
  }

  @Test
  void hiddenObjectBlocksDescendantMutation() throws Exception {
    Field child = scalar("child", "text");
    Field object = new Field("object", "object", false, false, false, false, false, null,
        Set.of(), Map.of("child", child), List.of());
    var runtime = new TypedAnswerRuntime(List.of(object));
    State hidden = runtime.projectApplicability(new State(),
        Map.of(new Address("object", List.of()), false), NOW);
    assertFalse(runtime.apply(hidden, List.of(new SetValue(new Address("child", List.of()),
        Status.answered, com.fasterxml.jackson.databind.node.TextNode.valueOf("forged"))), NOW).accepted());
  }
}
