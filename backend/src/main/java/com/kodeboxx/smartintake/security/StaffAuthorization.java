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

  /** Workspace grants are additive; organization and platform authority never imply one. */
  public UUID authorizeAuthoring(String workspace, String header) { return authorize(workspace, header, "AUTHOR"); }
  public UUID authorizeDraftRead(String workspace, String header) {
    return authorize(workspace, header, "AUTHOR", "REVIEWER", "TRANSLATOR", "PUBLISHER");
  }
  public UUID authorizeContentWrite(String workspace, String header) {
    return authorize(workspace, header, "AUTHOR", "REVIEWER", "TRANSLATOR");
  }
  public UUID authorizeGuidanceWrite(String workspace, String header) { return authorize(workspace, header, "AUTHOR"); }
  public UUID authorizeTranslationWrite(String workspace, String header) { return authorize(workspace, header, "TRANSLATOR"); }
  public UUID authorizeTranslationReview(String workspace, String header) { return authorize(workspace, header, "REVIEWER"); }
  public UUID authorizePublishing(String workspace, String header) { return authorize(workspace, header, "PUBLISHER"); }
  public UUID authorizeResponseRead(String workspace, String header) { return authorize(workspace, header, "RESPONSE_VIEWER", "RESPONSE_EXPORTER"); }
  public UUID authorizeResponseExport(String workspace, String header) { return authorize(workspace, header, "RESPONSE_EXPORTER"); }
  public UUID authorizeWorkspaceAdministration(String workspace, String header) {
    // OWNER is read only as a compatibility alias for workspaces created before M6.
    return authorize(workspace, header, "WORKSPACE_ADMINISTRATOR", "OWNER");
  }

  private UUID authorize(String workspace, String developmentHeader, String... roles) {
    HttpServletRequest request;
    String token;
    UUID account;
    try {
      request = ((ServletRequestAttributes) RequestContextHolder.currentRequestAttributes()).getRequest();
      token = sessions.session(request, developmentHeader).orElseThrow();
      account = db.queryForObject(
          "select s.account_id from staff_sessions s join accounts a on a.id=s.account_id where s.token::text=? and s.revoked_at is null"
              + " and s.setup_only=false and a.account_status='active' and s.last_seen_at > now() - interval '2 hours' and s.expires_at > now() and s.absolute_expires_at > now()",
          UUID.class, token);
    } catch (Exception e) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Valid staff workspace session required");
    }
    UUID workspaceId;
    try {
      workspaceId = db.queryForObject("select id from workspaces where workspace_key=? or id=?::uuid", UUID.class,
          workspace, workspaceId(workspace));
    } catch (Exception e) {
      // Do not reveal workspace existence at this session authorization boundary.
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Valid staff workspace session required");
    }
    String permitted = String.join("','", roles);
    Integer memberships = db.queryForObject("select count(*) from memberships m join workspaces w on w.id=m.workspace_id join organizations o on o.id=w.organization_id "
            + "join organization_memberships om on om.account_id=m.account_id and om.organization_id=w.organization_id "
            + "where m.account_id=? and m.workspace_id=? and o.organization_status='active' and om.membership_status='active' and m.role in ('" + permitted + "')", Integer.class,
        account, workspaceId);
    if (memberships == null || memberships == 0)
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Current workspace role required");
    db.update("update staff_sessions set last_seen_at=now(), expires_at=now()+interval '2 hours', updated_at=now() where token::text=?", token);
    return workspaceId;
  }

  private UUID workspaceId(String value) {
    try {
      String raw = value != null && value.startsWith("workspace-") ? value.substring("workspace-".length()) : value;
      return UUID.fromString(raw);
    } catch (Exception ignored) {
      // A key is still valid; the UUID predicate simply cannot match it.
      return new UUID(0, 0);
    }
  }

  public void requireOwnedForm(String workspace, String token, UUID form) {
    UUID ws = authorizeAuthoring(workspace, token);
    if (db.queryForObject("select count(*) from forms where id=? and workspace_id=?", Integer.class, form, ws) == 0)
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Resource not found");
  }

  public void requireReadableForm(String workspace, String token, UUID form) {
    UUID ws = authorizeDraftRead(workspace, token);
    if (db.queryForObject("select count(*) from forms where id=? and workspace_id=?", Integer.class, form, ws) == 0)
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Resource not found");
  }
  public void requireContentForm(String workspace, String token, UUID form) {
    UUID ws = authorizeContentWrite(workspace, token);
    if (db.queryForObject("select count(*) from forms where id=? and workspace_id=?", Integer.class, form, ws) == 0)
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Resource not found");
  }
  public void requireGuidanceForm(String workspace, String token, UUID form) { requireForm(workspace, token, form, this::authorizeGuidanceWrite); }
  public void requireTranslationForm(String workspace, String token, UUID form) { requireForm(workspace, token, form, this::authorizeTranslationWrite); }
  public void requireReviewForm(String workspace, String token, UUID form) { requireForm(workspace, token, form, this::authorizeTranslationReview); }
  private void requireForm(String workspace,String token,UUID form,java.util.function.BiFunction<String,String,UUID> authorization) {
    UUID ws=authorization.apply(workspace,token);
    if (db.queryForObject("select count(*) from forms where id=? and workspace_id=?", Integer.class, form, ws) == 0)
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Resource not found");
  }

  public void requirePublishForm(String workspace, String token, UUID form) {
    UUID ws = authorizePublishing(workspace, token);
    if (db.queryForObject("select count(*) from forms where id=? and workspace_id=?", Integer.class, form, ws) == 0)
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Resource not found");
  }
}
