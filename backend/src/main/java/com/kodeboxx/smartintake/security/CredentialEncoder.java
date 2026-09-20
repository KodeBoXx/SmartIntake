package com.kodeboxx.smartintake.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

/** Versioned password encoding avoids BCrypt's input-length truncation while accepting existing hashes. */
@Component
public class CredentialEncoder {
  private static final String PREHASH_V1 = "v1$";
  private final BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder(12);

  public String encode(String password) {
    return PREHASH_V1 + bcrypt.encode(prehash(password));
  }

  public boolean matches(String password, String storedHash) {
    if (storedHash == null) return false;
    if (storedHash.startsWith(PREHASH_V1)) return bcrypt.matches(prehash(password), storedHash.substring(PREHASH_V1.length()));
    return bcrypt.matches(password, storedHash);
  }

  private static String prehash(String password) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(password.getBytes(StandardCharsets.UTF_8));
      return java.util.HexFormat.of().formatHex(digest);
    } catch (Exception e) {
      throw new IllegalStateException("SHA-256 unavailable", e);
    }
  }
}
