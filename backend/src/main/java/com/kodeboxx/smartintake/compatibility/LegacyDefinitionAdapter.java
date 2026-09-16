package com.kodeboxx.smartintake.compatibility;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Read-only recognition for the pre-M1 prototype shape. It deliberately does not
 * interpret contractVersion=4.0.0 as a complete, normative package profile.
 */
@Component
public class LegacyDefinitionAdapter {
  public Optional<LegacyDefinition> adapt(JsonNode source) {
    if (source == null || !source.isObject() || !source.path("pages").isArray()) {
      return Optional.empty();
    }
    return Optional.of(new LegacyDefinition(CompatibilityProfile.LEGACY_PROTOTYPE, source.deepCopy()));
  }

  public record LegacyDefinition(CompatibilityProfile profile, JsonNode source) {
    public JsonNode readOnlySource() {
      return source.deepCopy();
    }
  }
}
