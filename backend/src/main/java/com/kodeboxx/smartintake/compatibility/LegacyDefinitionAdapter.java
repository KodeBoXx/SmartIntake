package com.kodeboxx.smartintake.compatibility;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kodeboxx.smartintake.contract.FormRuntime;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Read-only recognition for the complete pre-M1 prototype shape. It deliberately does not interpret
 * contractVersion=4.0.0 as a complete, normative package profile.
 */
@Component
public class LegacyDefinitionAdapter {
  private final ObjectMapper json;

  public LegacyDefinitionAdapter(ObjectMapper json) {
    this.json = json;
  }

  public Optional<LegacyDefinition> adapt(JsonNode source) {
    try {
      validateCurrentLite(source);
      return Optional.of(
          new LegacyDefinition(CompatibilityProfile.LEGACY_PROTOTYPE, source.deepCopy()));
    } catch (IllegalArgumentException exception) {
      return Optional.empty();
    }
  }

  /**
   * Validates the complete known M1 Lite prototype shape without promoting it to an M2 profile.
   * {@link FormRuntime} protects runtime semantics; this adds the persisted authoring members that
   * runtime evaluation does not need to inspect, especially field labels and choice option shape.
   */
  public void validateCurrentLite(JsonNode source) {
    if (source == null || !source.isObject()) {
      throw new IllegalArgumentException("DEFINITION_INVALID");
    }
    requireText(source, "formKey", "DEFINITION_INVALID");
    requireText(source, "title", "DEFINITION_INVALID");
    if (!source.path("pages").isArray() || source.path("pages").isEmpty()) {
      throw new IllegalArgumentException("DEFINITION_INVALID");
    }
    try {
      @SuppressWarnings("unchecked")
      Map<String, Object> definition = json.convertValue(source, Map.class);
      new FormRuntime(json).validateDefinition(definition);
    } catch (IllegalArgumentException exception) {
      throw exception;
    }
    for (JsonNode page : source.path("pages")) {
      requireText(page, "id", "PAGE_INVALID");
      requireText(page, "title", "PAGE_INVALID");
      if (!page.path("fields").isArray()) {
        throw new IllegalArgumentException("PAGE_INVALID");
      }
      for (JsonNode field : page.path("fields")) {
        requireText(field, "id", "FIELD_INVALID");
        requireText(field, "type", "FIELD_INVALID");
        requireText(field, "label", "FIELD_INVALID");
        if (field.has("required") && !field.path("required").isBoolean()) {
          throw new IllegalArgumentException("FIELD_INVALID");
        }
        if ("choice".equals(field.path("type").asText())
            || "multiChoice".equals(field.path("type").asText())) {
          validateOptions(field.path("options"));
        }
      }
    }
  }

  private void validateOptions(JsonNode options) {
    if (!options.isArray() || options.isEmpty()) {
      throw new IllegalArgumentException("OPTIONS_REQUIRED");
    }
    Set<String> ids = new HashSet<>();
    for (JsonNode option : options) {
      requireText(option, "id", "OPTION_INVALID");
      requireText(option, "label", "OPTION_INVALID");
      if (!ids.add(option.path("id").asText())) {
        throw new IllegalArgumentException("OPTION_INVALID");
      }
    }
  }

  private void requireText(JsonNode object, String member, String code) {
    if (!object.path(member).isTextual() || object.path(member).asText().isBlank()) {
      throw new IllegalArgumentException(code);
    }
  }

  public record LegacyDefinition(CompatibilityProfile profile, JsonNode source) {
    public JsonNode readOnlySource() {
      return source.deepCopy();
    }
  }
}
