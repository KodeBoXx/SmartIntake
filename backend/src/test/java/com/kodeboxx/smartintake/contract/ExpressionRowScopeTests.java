package com.kodeboxx.smartintake.contract;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;

class ExpressionRowScopeTests {
  private final ObjectMapper json = new ObjectMapper();

  @Test
  void evaluatesItemAndParentItemAgainstTheSelectedNestedRows() throws Exception {
    JsonNode definitions = json.readTree("""
        [{"id":"attendees","type":"list","itemFields":[
          {"id":"attendeeName","type":"text"},
          {"id":"parts","type":"list","itemFields":[{"id":"serial","type":"text"}]}
        ]}]""");
    JsonNode answers = json.readTree("""
        {"attendees":{"type":"list","status":"answered","applicable":true,"value":{"items":[
          {"itemId":"outer-a","fields":{
            "attendeeName":{"type":"text","status":"answered","applicable":true,"value":"Ada"},
            "parts":{"type":"list","status":"answered","applicable":true,"value":{"items":[
              {"itemId":"inner-a","fields":{"serial":{"type":"text","status":"answered","applicable":true,"value":"S-1"}}}
            ]}}
          }}
        ]}}}""");
    JsonNode expression = json.readTree("""
        {"op":"and","args":[
          {"op":"isAnswered","args":[{"ref":{"scope":"item","fieldId":"serial"}}]},
          {"op":"isAnswered","args":[{"ref":{"scope":"parentItem","parentDepth":1,"fieldId":"attendeeName"}}]}
        ]}""");
    var context = ExpressionEngine.projectionAt(definitions, answers,
        List.of("attendees", "parts"), List.of("outer-a", "inner-a"),
        "2026-09-19", "UTC", 100_000);
    ExpressionEngine.Result result = new ExpressionEngine().evaluate(expression, context);
    assertEquals("available", result.state());
    assertEquals(true, result.value().booleanValue());
  }
}
