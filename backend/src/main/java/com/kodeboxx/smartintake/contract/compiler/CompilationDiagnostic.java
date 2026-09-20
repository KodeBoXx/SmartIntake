package com.kodeboxx.smartintake.contract.compiler;

import java.util.Objects;

/** A deterministic, value-safe diagnostic emitted while compiling a package. */
public record CompilationDiagnostic(String code, String pointer, String message) implements Comparable<CompilationDiagnostic> {
  public CompilationDiagnostic {
    code = Objects.requireNonNull(code, "code");
    pointer = safePointer(pointer);
    message = Objects.requireNonNull(message, "message");
  }

  @Override public int compareTo(CompilationDiagnostic other) {
    int byPointer = pointer.compareTo(other.pointer);
    if (byPointer != 0) return byPointer;
    int byCode = code.compareTo(other.code);
    return byCode != 0 ? byCode : message.compareTo(other.message);
  }

  public static String child(String parent, String token) {
    return safePointer(parent) + "/" + token.replace("~", "~0").replace("/", "~1");
  }

  private static String safePointer(String value) {
    if (value == null || value.isBlank() || "/".equals(value)) return "";
    return value.startsWith("/") ? value : "/" + value.replace("~", "~0").replace("/", "~1");
  }
}
