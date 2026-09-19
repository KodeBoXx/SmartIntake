package com.kodeboxx.smartintake.contract.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.kodeboxx.smartintake.contract.compiler.CompiledForm;
import com.kodeboxx.smartintake.contract.runtime.TypedAnswerRuntime.Field;
import java.util.*;

/** Converts the server compiler output into the only field registry accepted by answer mutations. */
public final class CompiledRuntimeFactory {
  public TypedAnswerRuntime create(CompiledForm compiled) {
    List<Field> roots = new ArrayList<>();
    for (JsonNode field : compiled.canonicalPackage().path("data").path("fields")) {
      roots.add(field(field));
    }
    return new TypedAnswerRuntime(roots);
  }

  private Field field(JsonNode source) {
    Map<String, Field> children = new LinkedHashMap<>();
    // Canonical 4.0.0 stores recursive children under itemSchema.fields for both composites.
    JsonNode childFields = source.path("itemSchema").path("fields");
    for (JsonNode child : childFields) {
      Field compiled = field(child);
      children.put(compiled.id(), compiled);
    }
    Set<String> options = new LinkedHashSet<>();
    source.path("options").forEach(option -> options.add(option.path("id").asText()));
    List<String> fixedRows = new ArrayList<>();
    source.path("constraints").path("fixedItemIds").forEach(item -> fixedRows.add(item.asText()));
    Integer scale = null;
    if (source.path("constraints").has("scale")) {
      scale = source.path("constraints").path("scale").intValue();
    }
    JsonNode constraints = source.path("constraints");
    Set<String> exclusive = new LinkedHashSet<>();
    constraints.path("exclusiveOptionIds").forEach(option -> exclusive.add(option.asText()));
    return new Field(
        source.path("id").asText(),
        source.path("type").asText(),
        source.path("calculated").asBoolean(false) || "calculated".equals(source.path("mode").asText())
            || source.path("extensions").has("x-kodeboxx.calculation"),
        source.path("readOnly").asBoolean(false),
        source.path("allowUnknown").asBoolean(false),
        source.path("allowDeclined").asBoolean(false),
        source.path("allowNotApplicable").asBoolean(false),
        scale,
        options,
        children,
        fixedRows,
        source.path("hiddenRetention").asText("clear"),
        source.path("normalizer").asText("preserve"),
        source.has("default") ? source.get("default") : null,
        constraints.get("min"),
        constraints.get("max"),
        constraints.get("step"),
        constraints.has("minLength") ? constraints.path("minLength").intValue() : null,
        constraints.has("maxLength") ? constraints.path("maxLength").intValue() : null,
        constraints.has("minItems") ? constraints.path("minItems").intValue() : null,
        constraints.has("maxItems") ? constraints.path("maxItems").intValue() : null,
        exclusive);
  }
}
