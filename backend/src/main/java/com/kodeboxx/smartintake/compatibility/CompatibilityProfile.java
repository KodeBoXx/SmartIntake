package com.kodeboxx.smartintake.compatibility;

/** Named compatibility boundaries for legacy and canonical persisted packages. */
public record CompatibilityProfile(
    String key,
    String displayName,
    String contractVersion,
    boolean readOnly,
    boolean newWriteAllowed) {
  public static final CompatibilityProfile LEGACY_PROTOTYPE =
      new CompatibilityProfile("legacy-prototype", "Legacy prototype", "4.0.0", true, false);
  public static final CompatibilityProfile M1_CURRENT_PROTOTYPE =
      new CompatibilityProfile(
          "m1-current-prototype", "M1 current prototype", "4.0.0", false, true);
  public static final CompatibilityProfile CANONICAL_4_0_0 =
      new CompatibilityProfile("canonical-4.0.0", "Canonical 4.0.0", "4.0.0", false, true);
}
