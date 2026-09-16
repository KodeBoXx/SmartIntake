package com.kodeboxx.smartintake.compatibility;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** Compatibility seam for later respondent-token adoption; it never replaces V3's token column. */
@Component
public class RespondentSecretVerifier {
  public String digest(UUID respondentToken) {
    return sha256(respondentToken.toString());
  }

  public boolean matches(UUID respondentToken, String expectedDigest) {
    return MessageDigest.isEqual(digest(respondentToken).getBytes(StandardCharsets.US_ASCII),
        expectedDigest.getBytes(StandardCharsets.US_ASCII));
  }

  static String sha256(String source) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
          .digest(source.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 unavailable", exception);
    }
  }
}
