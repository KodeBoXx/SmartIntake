package com.kodeboxx.smartintake.compatibility;

import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;

@Component
public class CompatibilityProfileRegistry {
  private final Map<String, CompatibilityProfile> profiles =
      Map.of(
          CompatibilityProfile.LEGACY_PROTOTYPE.key(), CompatibilityProfile.LEGACY_PROTOTYPE,
          CompatibilityProfile.M1_CURRENT_PROTOTYPE.key(),
              CompatibilityProfile.M1_CURRENT_PROTOTYPE,
          CompatibilityProfile.CANONICAL_4_0_0.key(), CompatibilityProfile.CANONICAL_4_0_0);

  public Optional<CompatibilityProfile> find(String key) {
    return Optional.ofNullable(profiles.get(key));
  }

  public CompatibilityProfile legacyPrototype() {
    return CompatibilityProfile.LEGACY_PROTOTYPE;
  }

  public CompatibilityProfile currentPrototype() {
    return CompatibilityProfile.M1_CURRENT_PROTOTYPE;
  }

  public CompatibilityProfile canonical4_0_0() {
    return CompatibilityProfile.CANONICAL_4_0_0;
  }
}
