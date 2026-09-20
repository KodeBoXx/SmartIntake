package com.kodeboxx.smartintake.contract.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.Address;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.Cell;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.RowSegment;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.State;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.Status;
import com.kodeboxx.smartintake.contract.compiler.CompiledForm;
import java.util.*;

/** One ordered interpretation for respondent review and structured export. */
public final class ReviewProjectionService {
  public record Placement(
      String instanceId,
      String fieldId,
      String label,
      boolean systemHidden,
      boolean reviewGate,
      List<Placement> children) {
    public Placement {
      Objects.requireNonNull(instanceId, "instanceId");
      Objects.requireNonNull(fieldId, "fieldId");
      Objects.requireNonNull(label, "label");
      children = List.copyOf(children == null ? List.of() : children);
    }
  }

  public record ReviewRow(
      String instanceId,
      String fieldId,
      String label,
      List<RowSegment> rowPath,
      String itemId,
      Status status,
      String statusLabel,
      JsonNode value,
      List<ReviewRow> children) {
    public ReviewRow {
      rowPath = List.copyOf(rowPath);
      value = value == null ? null : value.deepCopy();
      children = List.copyOf(children);
    }
  }

  public record Projection(List<ReviewRow> answers, List<ReviewRow> reviewGates, ObjectNode export) {
    public Projection {
      answers = List.copyOf(answers);
      reviewGates = List.copyOf(reviewGates);
      export = export.deepCopy();
    }
  }

  public Projection project(State state, List<Placement> placements) {
    Set<Address> emitted = new LinkedHashSet<>();
    List<ReviewRow> answers = new ArrayList<>();
    List<ReviewRow> reviewGates = new ArrayList<>();
    ObjectNode export = JsonNodeFactory.instance.objectNode();
    for (Placement placement : placements) {
      List<ReviewRow> rows = rows(state, placement, List.of(), emitted);
      if (placement.reviewGate()) reviewGates.addAll(rows);
      else answers.addAll(rows);
      for (ReviewRow row : rows) appendExport(export, row);
    }
    return new Projection(answers, reviewGates, export);
  }

  public Projection project(CompiledForm compiled, State state) {
    List<Placement> placements = new ArrayList<>();
    for (JsonNode phase : compiled.canonicalPackage().path("flow").path("phases"))
      for (JsonNode page : phase.path("pages"))
        for (JsonNode section : page.path("sections"))
          for (JsonNode node : section.path("nodes")) {
            Placement placement = placement(node, compiled);
            if (placement != null) placements.add(placement);
          }
    return project(state, placements);
  }

  private Placement placement(JsonNode node, CompiledForm compiled) {
    if (!node.path("fieldId").isTextual()) return null;
    String fieldId = node.path("fieldId").asText();
    List<Placement> children = new ArrayList<>();
    for (JsonNode child : node.path("children")) {
      Placement nested = placement(child, compiled);
      if (nested != null) children.add(nested);
    }
    JsonNode field = compiled.fields().containsKey(fieldId)
        ? compiled.fields().get(fieldId).source() : JsonNodeFactory.instance.objectNode();
    return new Placement(node.path("id").asText(), fieldId,
        node.path("labelKey").asText(field.path("labelKey").asText(fieldId)), false,
        "acknowledgment".equals(node.path("control").asText()), children);
  }

  private List<ReviewRow> rows(
      State state, Placement placement, List<RowSegment> path, Set<Address> emitted) {
    if (placement.systemHidden()) return List.of();
    Address address = new Address(placement.fieldId(), path);
    Cell effective = state.cells().get(address);
    if (effective != null && effective.status() == Status.notApplicable) return List.of();
    List<String> items = state.itemIds(address);
    if (!items.isEmpty()) {
      List<ReviewRow> result = new ArrayList<>();
      for (String itemId : items) {
        List<RowSegment> itemPath = new ArrayList<>(path);
        itemPath.add(new RowSegment(placement.fieldId(), itemId));
        List<ReviewRow> children = new ArrayList<>();
        for (Placement child : placement.children()) children.addAll(rows(state, child, itemPath, emitted));
        result.add(new ReviewRow(
            placement.instanceId(), placement.fieldId(), placement.label(), path, itemId,
            Status.answered, "Answered", null, children));
      }
      return result;
    }
    if (!emitted.add(address)) return List.of();
    Cell cell = effective;
    if (cell != null && cell.status() == Status.notApplicable) return List.of();
    List<ReviewRow> children = new ArrayList<>();
    for (Placement child : placement.children()) children.addAll(rows(state, child, path, emitted));
    return List.of(new ReviewRow(
        placement.instanceId(), placement.fieldId(), placement.label(), path, null,
        cell == null ? Status.unanswered : cell.status(),
        statusLabel(cell == null ? Status.unanswered : cell.status()), cell == null ? null : cell.value(), children));
  }

  private void appendExport(ObjectNode target, ReviewRow row) {
    String key = exportKey(row);
    ObjectNode output = target.putObject(key);
    output.put("fieldId", row.fieldId());
    output.put("instanceId", row.instanceId());
    output.put("status", row.status().name());
    if (row.itemId() != null) output.put("itemId", row.itemId());
    if (row.value() != null) output.set("value", row.value());
    if (!row.children().isEmpty()) {
      ObjectNode children = output.putObject("children");
      for (ReviewRow child : row.children()) appendExport(children, child);
    }
  }

  private String exportKey(ReviewRow row) {
    if (row.itemId() == null) return row.instanceId();
    return row.instanceId() + "[" + row.itemId() + "]";
  }

  public static String statusLabel(Status status) {
    return switch (status) {
      case answered -> "Answered";
      case unanswered -> "Not answered";
      case unknown -> "Unknown";
      case declined -> "Prefer not to answer";
      case respondentNotApplicable -> "Not applicable (respondent answer)";
      case notApplicable -> "System not applicable";
    };
  }
}
