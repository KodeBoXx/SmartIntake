package com.kodeboxx.smartintake.contract.compiler;

import java.util.List;
import java.util.Optional;

/** Immutable result; a graph is published only when every diagnostic is absent. */
public record CompilationResult(CompiledForm compiledForm, List<CompilationDiagnostic> diagnostics) {
  public CompilationResult {
    diagnostics = diagnostics.stream().sorted().toList();
  }

  public boolean valid() { return diagnostics.isEmpty(); }

  public Optional<CompiledForm> compiled() { return Optional.ofNullable(compiledForm); }
}
