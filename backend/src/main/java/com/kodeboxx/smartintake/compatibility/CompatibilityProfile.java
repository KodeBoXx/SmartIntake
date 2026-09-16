package com.kodeboxx.smartintake.compatibility;

/** A named M1 compatibility boundary; neither profile is an M2 normative profile. */
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
}
