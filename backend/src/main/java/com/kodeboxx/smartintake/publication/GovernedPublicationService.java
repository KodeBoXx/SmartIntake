package com.kodeboxx.smartintake.publication;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kodeboxx.smartintake.application.IntakeApplicationService;
import com.kodeboxx.smartintake.contract.CanonicalJson;
import com.kodeboxx.smartintake.security.StaffAuthorization;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** M8 release governance is deliberately separate from the immutable release package. */
@Service
public class GovernedPublicationService {
  private final JdbcTemplate db;
  private final ObjectMapper json;
  private final StaffAuthorization authorization;
  private final IntakeApplicationService intake;

  public GovernedPublicationService(JdbcTemplate db, ObjectMapper json, StaffAuthorization authorization,
      IntakeApplicationService intake) {
    this.db = db; this.json = json; this.authorization = authorization; this.intake = intake;
  }

  @Transactional
  public Map<String, Object> requestReview(String workspace, UUID form, String token) {
    authorization.requireOwnedForm(workspace, token, form);
    Snapshot snapshot = snapshot(form);
    invalidateChangedRequests(form, snapshot);
    UUID id = UUID.randomUUID();
    String actor = account(token).toString();
    String prior = db.query("select package::text from form_releases where form_id=? order by version desc limit 1",
        rs -> rs.next() ? rs.getString(1) : null, form);
    Map<String, Object> semantic = new LinkedHashMap<>();
    semantic.put("changed", !snapshot.packageJson().equals(prior));
    semantic.put("fromPackageHash", prior == null ? null : CanonicalJson.sha256(read(prior)));
    Map<String, Object> dependencies = Map.of("current", read(snapshot.packageJson()).path("dependencies"));
    db.update("""
        insert into form_review_requests(id,form_id,draft_id,source_revision,package_hash,manifest_hash,
          semantic_diff,dependency_diff,state,requested_by)
        values(?,?,?, ?,?,?,cast(? as jsonb),cast(? as jsonb),'OPEN',?)
        on conflict(form_id,draft_id,source_revision,package_hash,manifest_hash) do nothing
        """, id, form, form, snapshot.revision(), snapshot.packageHash(), snapshot.manifestHash(),
        write(semantic), write(dependencies), UUID.fromString(actor));
    UUID resolved = db.queryForObject("select id from form_review_requests where form_id=? and draft_id=? and source_revision=? and package_hash=? and manifest_hash=?",
        UUID.class, form, form, snapshot.revision(), snapshot.packageHash(), snapshot.manifestHash());
    return Map.of("reviewRequestId", resolved, "revision", snapshot.revision(), "packageHash", snapshot.packageHash(),
        "manifestHash", snapshot.manifestHash(), "state", "OPEN");
  }

  @Transactional
  public Map<String, Object> approve(String workspace, UUID form, UUID request, String token) {
    authorization.requireReviewForm(workspace, token, form);
    Snapshot snapshot = snapshot(form);
    Map<String, Object> row = db.queryForMap("select form_id,source_revision,package_hash,manifest_hash,state from form_review_requests where id=?", request);
    if (!form.equals(row.get("form_id")) || !"OPEN".equals(row.get("state")))
      throw conflict("REVIEW_NOT_OPEN");
    if (((Number) row.get("source_revision")).longValue() != snapshot.revision()
        || !snapshot.packageHash().equals(row.get("package_hash")) || !snapshot.manifestHash().equals(row.get("manifest_hash"))) {
      db.update("update form_review_requests set state='INVALIDATED',invalidated_at=now() where id=?", request);
      throw conflict("REVIEW_STALE");
    }
    UUID reviewer = account(token);
    db.update("""
        insert into form_review_approvals(review_request_id,reviewer_account_id,source_revision,package_hash,manifest_hash)
        values(?,?,?,?,?) on conflict(review_request_id,reviewer_account_id) do nothing
        """, request, reviewer, snapshot.revision(), snapshot.packageHash(), snapshot.manifestHash());
    db.update("update form_review_requests set state='APPROVED' where id=?", request);
    return Map.of("reviewRequestId", request, "state", "APPROVED", "packageHash", snapshot.packageHash());
  }

  @Transactional
  public ResponseEntity<?> publish(String workspace, UUID form, UUID request, String token) {
    authorization.requirePublishForm(workspace, token, form);
    Snapshot snapshot = snapshot(form);
    Integer approvals = db.queryForObject("""
        select count(*) from form_review_requests r join form_review_approvals a on a.review_request_id=r.id
        where r.id=? and r.form_id=? and r.state='APPROVED' and r.source_revision=?
          and r.package_hash=? and r.manifest_hash=? and a.source_revision=r.source_revision
          and a.package_hash=r.package_hash and a.manifest_hash=r.manifest_hash
        """, Integer.class, request, form, snapshot.revision(), snapshot.packageHash(), snapshot.manifestHash());
    if (approvals == null || approvals == 0) throw conflict("GOVERNED_APPROVAL_REQUIRED");
    ResponseEntity<?> result = intake.publish(workspace, form, token);
    @SuppressWarnings("unchecked") Map<String, Object> body = (Map<String, Object>) result.getBody();
    UUID release = UUID.fromString(body.get("releaseId").toString());
    db.update("update form_releases set package_hash=?,manifest_hash=?,release_state='ACTIVE',activated_at=now() where id=?",
        snapshot.packageHash(), snapshot.manifestHash(), release);
    db.update("update form_releases set release_state='ROLLED_BACK' where form_id=? and id<>? and release_state='ACTIVE'", form, release);
    db.update("""
        insert into form_release_selections(form_id,active_release_id,selected_by) values(?,?,?)
        on conflict(form_id) do update set active_release_id=excluded.active_release_id,
          selected_by=excluded.selected_by,selected_at=now()
        """, form, release, account(token));
    return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
        "releaseId", release, "version", body.get("version"), "shareId", form.toString(), "status", "ACTIVE",
        "packageHash", snapshot.packageHash(), "manifestHash", snapshot.manifestHash()));
  }

  @Transactional
  public Map<String, Object> transition(String workspace, UUID form, UUID release, String action, String token) {
    authorization.requirePublishForm(workspace, token, form);
    if (db.queryForObject("select count(*) from form_releases where id=? and form_id=?", Integer.class, release, form) != 1)
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Release not found");
    UUID actor = account(token);
    if ("activate".equals(action) || "rollback".equals(action)) {
      db.update("update form_releases set release_state='ROLLED_BACK' where form_id=? and id<>? and release_state='ACTIVE'", form, release);
      db.update("update form_releases set release_state='ACTIVE',activated_at=now(),retired_at=null,emergency_closed_at=null where id=?", release);
      db.update("""
          insert into form_release_selections(form_id,active_release_id,selected_by) values(?,?,?)
          on conflict(form_id) do update set active_release_id=excluded.active_release_id,selected_by=excluded.selected_by,selected_at=now()
          """, form, release, actor);
    } else if ("retire".equals(action)) {
      db.update("update form_releases set release_state='RETIRED',retired_at=now() where id=?", release);
      db.update("delete from form_release_selections where form_id=? and active_release_id=?", form, release);
    } else if ("emergency-close".equals(action)) {
      db.update("update form_releases set release_state='EMERGENCY_CLOSED',emergency_closed_at=now() where id=?", release);
      db.update("delete from form_release_selections where form_id=? and active_release_id=?", form, release);
      // Emergency close deliberately terminates existing incomplete sessions; retire does not.
      db.update("update sessions set status='CLOSED' where release_id=? and status='DRAFT'", release);
    } else throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown release action");
    return Map.of("releaseId", release, "action", action,
        "existingSessions", "emergency-close".equals(action) ? "CLOSED" : "PINNED",
        "newSessions", ("activate".equals(action) || "rollback".equals(action)) ? "ACTIVE_RELEASE" : "DENIED");
  }

  @Transactional
  public Map<String, Object> createChannel(String workspace, UUID form, UUID release, Map<String, Object> in, String token) {
    authorization.requirePublishForm(workspace, token, form);
    if (db.queryForObject("select count(*) from form_releases where id=? and form_id=?", Integer.class, release, form) != 1)
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Release not found");
    String type = String.valueOf(in.getOrDefault("type", "LINK")).toUpperCase();
    if (!List.of("LINK", "QR", "IFRAME").contains(type)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid channel type");
    List<?> origins = in.get("allowedOrigins") instanceof List<?> values ? values : List.of();
    if (origins.stream().anyMatch(value -> !(value instanceof String origin) || !origin.matches("https://[^/]+(:[0-9]+)?")))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Origins must be HTTPS origins");
    UUID id = UUID.randomUUID();
    db.update("""
        insert into form_share_channels(id,form_id,release_id,channel_type,opens_at,closes_at,response_cap,allowed_origins,created_by)
        values(?,?,?, ?,cast(? as timestamptz),cast(? as timestamptz),?,cast(? as jsonb),?)
        """, id, form, release, type, in.get("opensAt"), in.get("closesAt"), in.get("responseCap"), write(origins), account(token));
    return Map.of("channelId", id, "shareId", form.toString(), "type", type, "releaseId", release,
        "publicPath", "/v1/public/channels/" + id + "/sessions");
  }

  private Snapshot snapshot(UUID form) {
    Map<String, Object> value = intake.publicationSnapshot(form);
    return new Snapshot(((Number) value.get("revision")).longValue(), value.get("package").toString(),
        value.get("packageHash").toString(), value.get("manifestHash").toString());
  }
  private void invalidateChangedRequests(UUID form, Snapshot snapshot) {
    db.update("""
        update form_review_requests set state='INVALIDATED',invalidated_at=now()
        where form_id=? and state in ('OPEN','APPROVED') and (source_revision<>? or package_hash<>? or manifest_hash<>?)
        """, form, snapshot.revision(), snapshot.packageHash(), snapshot.manifestHash());
  }
  private UUID account(String token) { return db.queryForObject("select account_id from staff_sessions where token=?::uuid", UUID.class, token); }
  private JsonNode read(String value) { try { return json.readTree(value); } catch (Exception e) { throw new IllegalArgumentException(e); } }
  private String write(Object value) { try { return json.writeValueAsString(value); } catch (Exception e) { throw new IllegalArgumentException(e); } }
  private ResponseStatusException conflict(String code) { return new ResponseStatusException(HttpStatus.CONFLICT, code); }
  private record Snapshot(long revision, String packageJson, String packageHash, String manifestHash) {}
}
