package com.kodeboxx.smartintake.security;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

class CredentialEncoderTests {
  private final CredentialEncoder encoder = new CredentialEncoder();

  @Test
  void versionedPrehashSupportsSixtyFourUnicodeCodePointsWithoutTruncation() {
    String password = "😀".repeat(64);
    String hash = encoder.encode(password);
    assertTrue(hash.startsWith("v1$"));
    assertTrue(encoder.matches(password, hash));
    assertFalse(encoder.matches("😀".repeat(63) + "x", hash));
  }

  @Test
  void existingBcryptHashesRemainValid() {
    String password = "legacy password retained exactly";
    String legacyHash = new BCryptPasswordEncoder(4).encode(password);
    assertTrue(encoder.matches(password, legacyHash));
    assertFalse(encoder.matches(password + " ", legacyHash));
  }
}
