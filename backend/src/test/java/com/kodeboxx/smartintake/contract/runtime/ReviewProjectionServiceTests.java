package com.kodeboxx.smartintake.contract.runtime;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kodeboxx.smartintake.contract.runtime.ReviewProjectionService.Placement;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;

class ReviewProjectionServiceTests {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Instant NOW = Instant.parse("2026-09-19T12:00:00Z");

  private Field field(String id, String type) {
    return new Field(id, type, false, false, true, true, true, null, Set.of(), Map.of(), List.of());
  }

  @Test
  void preservesFalseZeroEmptyAndNonAnswerStatusesWithoutDeduplicationLeaks() throws Exception {
    var runtime = new TypedAnswerRuntime(List.of(
        field("no", "boolean"), field("zero", "integer"), field("empty", "text"),
        field("unknown", "text"), field("declined", "text"), field("na", "text")));
    var state = runtime.apply(new State(), List.of(
        new SetValue(new Address("no", List.of()), Status.answered, JSON.readTree("false")),
        new SetValue(new Address("zero", List.of()), Status.answered, JSON.readTree("\"0\"")),
        new SetValue(new Address("empty", List.of()), Status.answered, JSON.readTree("\"\"")),
        new SetValue(new Address("unknown", List.of()), Status.unknown, null),
        new SetValue(new Address("declined", List.of()), Status.declined, null),
        new SetValue(new Address("na", List.of()), Status.respondentNotApplicable, null)), NOW).state();
    List<Placement> placements = List.of(
        new Placement("no-a", "no", "No", false, false, List.of()),
        new Placement("no-b", "no", "Duplicate no", false, false, List.of()),
        new Placement("zero", "zero", "Zero", false, false, List.of()),
        new Placement("empty", "empty", "Empty", false, false, List.of()),
        new Placement("unknown", "unknown", "Unknown", false, false, List.of()),
        new Placement("declined", "declined", "Declined", false, false, List.of()),
        new Placement("na", "na", "NA", false, false, List.of()));
    var projection = new ReviewProjectionService().project(state, placements);
    assertEquals(6, projection.answers().size());
    assertFalse(projection.answers().get(0).value().booleanValue());
    assertEquals("0", projection.answers().get(1).value().textValue());
    assertEquals("", projection.answers().get(2).value().textValue());
    assertEquals(List.of("Unknown", "Prefer not to answer", "Not applicable"),
        projection.answers().subList(3, 6).stream().map(ReviewProjectionService.ReviewRow::statusLabel).toList());
  }

  @Test
  void omitsHiddenAndSystemNotApplicableAndSeparatesReviewGates() throws Exception {
    var runtime = new TypedAnswerRuntime(List.of(field("visible", "text"), field("hidden", "text"), field("gate", "boolean")));
    var state = runtime.apply(new State(), List.of(
        new SetValue(new Address("visible", List.of()), Status.answered, JSON.readTree("\"yes\"")),
        new SetValue(new Address("hidden", List.of()), Status.answered, JSON.readTree("\"private\"")),
        new SetValue(new Address("gate", List.of()), Status.answered, JSON.readTree("true"))), NOW).state();
    var projection = new ReviewProjectionService().project(state, List.of(
        new Placement("visible", "visible", "Visible", false, false, List.of()),
        new Placement("hidden", "hidden", "Hidden", true, false, List.of()),
        new Placement("gate", "gate", "I agree", false, true, List.of())));
    assertEquals(List.of("visible"), projection.answers().stream().map(ReviewProjectionService.ReviewRow::fieldId).toList());
    assertEquals(List.of("gate"), projection.reviewGates().stream().map(ReviewProjectionService.ReviewRow::fieldId).toList());
    assertFalse(projection.export().toString().contains("private"));
  }

  @Test
  void preservesListItemIdentityAndOrderWithChildren() throws Exception {
    Field name = field("name", "text");
    Field people = new Field("people", "list", false, false, false, false, false, null, Set.of(), Map.of("name", name), List.of());
    var runtime = new TypedAnswerRuntime(List.of(people));
    Address list = new Address("people", List.of());
    State state = new State();
    for (String id : List.of("person-b", "person-a")) {
      var initial = new SetValue(new Address("name", List.of()), Status.answered, JSON.readTree("\"" + id + "\""));
      state = runtime.apply(state, List.of(new AddItem(list, id, Map.of("name", initial))), NOW).state();
    }
    Placement placement = new Placement("people-placement", "people", "People", false, false,
        List.of(new Placement("name-placement", "name", "Name", false, false, List.of())));
    var projection = new ReviewProjectionService().project(state, List.of(placement));
    assertEquals(List.of("person-b", "person-a"), projection.answers().stream().map(ReviewProjectionService.ReviewRow::itemId).toList());
    assertEquals("person-b", projection.answers().get(0).children().get(0).value().textValue());
    assertEquals("person-a", projection.answers().get(1).children().get(0).value().textValue());
  }
}
