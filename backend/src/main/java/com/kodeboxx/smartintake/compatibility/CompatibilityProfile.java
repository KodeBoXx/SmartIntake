package com.kodeboxx.smartintake.compatibility;

/** A named, read-only compatibility boundary; this is not an M2 normative profile. */
public record CompatibilityProfile(
    String key,
    String displayName,
    String contractVersion,
    boolean readOnly,
    boolean newWriteAllowed) {
  public static final CompatibilityProfile LEGACY_PROTOTYPE = new CompatibilityProfile(
      "legacy-prototype", "Legacy prototype", "4.0.0", true, false);
}
