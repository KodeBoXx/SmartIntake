package com.kodeboxx.smartintake.contract.compiler;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Immutable compiler output consumed by later M4 runtime and projection work. */
public record CompiledForm(
    String contractVersion,
    JsonNode canonicalPackage,
    Map<String, CompiledField> fields,
    List<CompiledPage> pages,
    Map<String, JsonNode> expressions,
    List<String> reviewPageIds) {
  public CompiledForm {
    contractVersion = Objects.requireNonNull(contractVersion, "contractVersion");
    canonicalPackage = Objects.requireNonNull(canonicalPackage, "canonicalPackage").deepCopy();
    fields = Map.copyOf(fields);
    pages = List.copyOf(pages);
    expressions = expressions.entrySet().stream().collect(java.util.stream.Collectors.toUnmodifiableMap(
        Map.Entry::getKey, entry -> entry.getValue().deepCopy()));
    reviewPageIds = List.copyOf(reviewPageIds);
  }

  @Override public JsonNode canonicalPackage() { return canonicalPackage.deepCopy(); }

  @Override public Map<String, JsonNode> expressions() {
    return expressions.entrySet().stream().collect(java.util.stream.Collectors.toUnmodifiableMap(
        Map.Entry::getKey, entry -> entry.getValue().deepCopy()));
  }

  public record CompiledField(String id, String key, String type, int repeaterDepth, boolean protectedValue,
                              List<String> optionIds, JsonNode source) {
    public CompiledField {
      optionIds = List.copyOf(optionIds);
      source = source.deepCopy();
    }
    @Override public JsonNode source() { return source.deepCopy(); }
  }

  public record CompiledPage(String id, int order, List<String> routeTargetIds, boolean reviewPage) {
    public CompiledPage {
      routeTargetIds = List.copyOf(routeTargetIds);
    }
  }
}
