package com.kodeboxx.smartintake.web;

import java.util.Map;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.CannotSerializeTransactionException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Converts PostgreSQL SERIALIZABLE retry outcomes into a deterministic owner-safety conflict. */
@RestControllerAdvice(assignableTypes = IdentityAdministrationController.class)
class IdentityAdministrationExceptionHandler {
  @ExceptionHandler({CannotAcquireLockException.class, CannotSerializeTransactionException.class})
  ResponseEntity<?> ownerSafetyConflict(RuntimeException ignored) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(Map.of("requestId", "req-conflict", "message", "Owner membership changed; retry the request"));
  }
}
