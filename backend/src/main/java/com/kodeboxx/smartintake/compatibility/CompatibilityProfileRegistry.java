package com.kodeboxx.smartintake.compatibility;

import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;

@Component
public class CompatibilityProfileRegistry {
  private final Map<String, CompatibilityProfile> profiles = Map.of(
      CompatibilityProfile.LEGACY_PROTOTYPE.key(), CompatibilityProfile.LEGACY_PROTOTYPE);

  public Optional<CompatibilityProfile> find(String key) {
    return Optional.ofNullable(profiles.get(key));
  }

  public CompatibilityProfile legacyPrototype() {
    return CompatibilityProfile.LEGACY_PROTOTYPE;
  }
}
