package com.kodeboxx.smartintake.contract.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.Address;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.Cell;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.RowSegment;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.State;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.Status;
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
    if (cell == null || cell.status() == Status.notApplicable) return List.of();
    List<ReviewRow> children = new ArrayList<>();
    for (Placement child : placement.children()) children.addAll(rows(state, child, path, emitted));
    return List.of(new ReviewRow(
        placement.instanceId(), placement.fieldId(), placement.label(), path, null,
        cell.status(), statusLabel(cell.status()), cell.value(), children));
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
      case unanswered -> "Unanswered";
      case unknown -> "Unknown";
      case declined -> "Prefer not to answer";
      case respondentNotApplicable -> "Not applicable";
      case notApplicable -> "System not applicable";
    };
  }
}
