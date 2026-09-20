package com.kodeboxx.smartintake.security;

import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;

/** Staff/workspace authorization backed by an opaque cookie session. */
@Component
public class StaffAuthorization {
  private final JdbcTemplate db;
  private final IdentitySessionResolver sessions;

  public StaffAuthorization(JdbcTemplate db, IdentitySessionResolver sessions) {
    this.db = db;
    this.sessions = sessions;
  }

  public UUID authorize(String workspace, String developmentHeader) {
    try {
      HttpServletRequest request = ((ServletRequestAttributes) RequestContextHolder.currentRequestAttributes()).getRequest();
      String token = sessions.session(request, developmentHeader).orElseThrow();
      UUID account = db.queryForObject(
          "select account_id from staff_sessions where token::text=? and revoked_at is null"
              + " and last_seen_at > now() - interval '2 hours' and expires_at > now() and absolute_expires_at > now()",
          UUID.class, token);
      db.update("update staff_sessions set last_seen_at=now(), expires_at=now()+interval '2 hours', updated_at=now() where token::text=?", token);
      UUID workspaceId = db.queryForObject("select id from workspaces where workspace_key=?", UUID.class, workspace);
      if (db.queryForObject("select count(*) from memberships where account_id=? and workspace_id=?", Integer.class,
          account, workspaceId) == 0) throw new IllegalStateException();
      return workspaceId;
    } catch (Exception e) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Valid staff workspace session required");
    }
  }

  public void requireOwnedForm(String workspace, String token, UUID form) {
    UUID ws = authorize(workspace, token);
    if (db.queryForObject("select count(*) from forms where id=? and workspace_id=?", Integer.class, form, ws) == 0)
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Resource not found");
  }
}
