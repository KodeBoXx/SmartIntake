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
    JsonNode childFields = "object".equals(source.path("type").asText())
        ? source.path("fields")
        : source.path("itemSchema").path("fields");
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
    } else if (source.path("calculation").path("rounding").has("scale")) {
      scale = source.path("calculation").path("rounding").path("scale").intValue();
    }
    return new Field(
        source.path("id").asText(),
        source.path("type").asText(),
        source.path("calculated").asBoolean(false) || "calculated".equals(source.path("mode").asText()),
        source.path("readOnly").asBoolean(false),
        source.path("allowUnknown").asBoolean(false),
        source.path("allowDeclined").asBoolean(false),
        source.path("allowNotApplicable").asBoolean(false),
        scale,
        options,
        children,
        fixedRows);
  }
}
