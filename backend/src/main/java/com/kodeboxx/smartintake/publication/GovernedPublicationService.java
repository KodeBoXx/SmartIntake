package com.kodeboxx.smartintake.publication;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kodeboxx.smartintake.application.IntakeApplicationService;
import com.kodeboxx.smartintake.contract.CanonicalJson;
import com.kodeboxx.smartintake.security.StaffAuthorization;
import com.kodeboxx.smartintake.security.BrowserSecurityConfiguration;
import com.kodeboxx.smartintake.security.IdentitySessionResolver;
import jakarta.servlet.http.HttpServletRequest;
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
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/** M8 release governance is deliberately separate from the immutable release package. */
@Service
public class GovernedPublicationService {
  private final JdbcTemplate db;
  private final ObjectMapper json;
  private final StaffAuthorization authorization;
  private final IntakeApplicationService intake;
  private final BrowserSecurityConfiguration browserSecurity;
  private final IdentitySessionResolver sessions;

  public GovernedPublicationService(JdbcTemplate db, ObjectMapper json, StaffAuthorization authorization,
      IntakeApplicationService intake, BrowserSecurityConfiguration browserSecurity, IdentitySessionResolver sessions) {
    this.db = db; this.json = json; this.authorization = authorization; this.intake = intake; this.browserSecurity = browserSecurity; this.sessions = sessions;
  }

  @Transactional
  public Map<String, Object> requestReview(String workspace, UUID form, String token) {
    authorization.requireReadableForm(workspace, token, form);
    intake.lockWorkspacePolicy(form);
    db.queryForObject("select id from forms where id=? for update", UUID.class, form);
    Snapshot snapshot = snapshot(form);
    invalidateChangedRequests(form, snapshot);
    UUID id = UUID.randomUUID();
    String actor = account(token).toString();
    String prior = db.query("select package::text from form_releases where form_id=? order by version desc limit 1",
        rs -> rs.next() ? rs.getString(1) : null, form);
    JsonNode previous = prior == null ? json.nullNode() : read(prior);
    Map<String, Object> semantic = new LinkedHashMap<>();
    semantic.put("changed", !snapshot.packageJson().equals(prior));
    semantic.put("changedPaths", changedPaths(previous, read(snapshot.packageJson()), ""));
    semantic.put("fromPackageHash", prior == null ? null : CanonicalJson.sha256(previous));
    semantic.put("toPackageHash", snapshot.packageHash());
    semantic.put("fromReleaseVersion", prior == null ? null : db.query("select max(version) from form_releases where form_id=?",
        rs -> rs.next() ? rs.getObject(1) : null, form));
    semantic.put("toRevision", snapshot.revision());
    Map<String, Object> dependencies = new LinkedHashMap<>();
    dependencies.put("from", previous.path("dependencies"));
    dependencies.put("to", read(snapshot.packageJson()).path("dependencies"));
    dependencies.put("changed", !previous.path("dependencies").equals(read(snapshot.packageJson()).path("dependencies")));
    dependencies.put("changedPaths", changedPaths(previous.path("dependencies"), read(snapshot.packageJson()).path("dependencies"), "/dependencies"));
    db.update("""
        insert into form_review_requests(id,form_id,draft_id,source_revision,package_hash,manifest_hash,
          semantic_diff,dependency_diff,state,requested_by)
        values(?,?,?, ?,?,?,cast(? as jsonb),cast(? as jsonb),'OPEN',?)
        on conflict(form_id,draft_id,source_revision,package_hash,manifest_hash) do nothing
        """, id, form, form, snapshot.revision(), snapshot.packageHash(), snapshot.manifestHash(),
        write(semantic), write(dependencies), UUID.fromString(actor));
    UUID resolved = db.queryForObject("select id from form_review_requests where form_id=? and draft_id=? and source_revision=? and package_hash=? and manifest_hash=?",
        UUID.class, form, form, snapshot.revision(), snapshot.packageHash(), snapshot.manifestHash());
    int reopened = db.update("update form_review_requests set state='OPEN',requested_by=?,requested_at=now(),invalidated_at=null,semantic_diff=cast(? as jsonb),dependency_diff=cast(? as jsonb) where id=? and state='INVALIDATED'",
        UUID.fromString(actor), write(semantic), write(dependencies), resolved);
    if (reopened == 1) db.update("delete from form_review_approvals where review_request_id=?", resolved);
    String state = db.queryForObject("select state from form_review_requests where id=?", String.class, resolved);
    return Map.of("reviewRequestId", resolved, "revision", snapshot.revision(), "packageHash", snapshot.packageHash(),
        "manifestHash", snapshot.manifestHash(), "state", state, "semanticDiff", semantic, "dependencyDiff", dependencies);
  }

  public Map<String,Object> state(String workspace, UUID form, String token) {
    authorization.requireReadableForm(workspace, token, form);
    List<Map<String,Object>> reviews = db.queryForList("""
        select id as "reviewRequestId",source_revision as revision,package_hash as "packageHash",
          manifest_hash as "manifestHash",state,semantic_diff as "semanticDiff",dependency_diff as "dependencyDiff",
          published_release_id as "publishedReleaseId",requested_at as "requestedAt"
        from form_review_requests where form_id=? order by requested_at desc limit 1
        """, form);
    for (Map<String,Object> review : reviews) {
      review.computeIfPresent("semanticDiff", (key, value) -> read(value.toString()));
      review.computeIfPresent("dependencyDiff", (key, value) -> read(value.toString()));
    }
    if (!reviews.isEmpty()) {
      Snapshot current = snapshot(form); Map<String,Object> review = reviews.get(0);
      review.put("matchesCurrentSnapshot", ((Number) review.get("revision")).longValue() == current.revision()
          && current.packageHash().equals(review.get("packageHash")) && current.manifestHash().equals(review.get("manifestHash")));
    }
    List<Map<String,Object>> releases = db.queryForList("""
        select id as "releaseId",version,release_state as state,activated_at as "activatedAt",
          retired_at as "retiredAt",emergency_closed_at as "emergencyClosedAt"
        from form_releases where form_id=? order by version desc
        """, form);
    List<Map<String,Object>> channels = db.queryForList("""
        select id as "channelId",release_id as "releaseId",channel_type as type,state,opens_at as "opensAt",
          closes_at as "closesAt",response_cap as "responseCap",accepted_count as "acceptedCount",
          allowed_origins as "allowedOrigins",
          case when channel_type='IFRAME' then '/v1/public/channels/'||id::text||'/embed?parentOrigin='||coalesce(allowed_origins->>0,'')
            else '/f/'||form_id::text||'?channel='||id::text end as "publicPath"
        from form_share_channels where form_id=? order by created_at desc
        """, form);
    for (Map<String,Object> channel : channels) channel.computeIfPresent("allowedOrigins", (key, value) -> read(value.toString()));
    return Map.of("review", reviews.isEmpty() ? Map.of() : reviews.get(0), "releases", releases, "channels", channels);
  }

  @Transactional(noRollbackFor = ResponseStatusException.class)
  public Map<String, Object> approve(String workspace, UUID form, UUID request, String token) {
    authorization.requireReviewForm(workspace, token, form);
    intake.lockWorkspacePolicy(form);
    db.queryForObject("select id from forms where id=? for update", UUID.class, form);
    Map<String, Object> row = db.queryForMap("select form_id,source_revision,package_hash,manifest_hash,state from form_review_requests where id=? for update", request);
    if (!form.equals(row.get("form_id")) || !"OPEN".equals(row.get("state")))
      throw conflict("REVIEW_NOT_OPEN");
    Snapshot snapshot = snapshot(form);
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
    intake.lockWorkspacePolicy(form);
    db.queryForObject("select id from forms where id=? for update", UUID.class, form);
    Snapshot snapshot = snapshot(form);
    Map<String, Object> requestRow;
    try {
      requestRow = db.queryForMap("select state,published_release_id from form_review_requests where id=? and form_id=? for update", request, form);
    } catch (org.springframework.dao.EmptyResultDataAccessException missing) {
      throw conflict("GOVERNED_APPROVAL_REQUIRED");
    }
    if (requestRow.get("published_release_id") != null) {
      UUID release = (UUID) requestRow.get("published_release_id");
      Map<String, Object> releaseRow = db.queryForMap("select version,package_hash,manifest_hash,release_state from form_releases where id=?", release);
      return ResponseEntity.ok(Map.of("releaseId", release, "version", releaseRow.get("version"), "shareId", form.toString(),
          "status", releaseRow.get("release_state"), "packageHash", releaseRow.get("package_hash"), "manifestHash", releaseRow.get("manifest_hash")));
    }
    Integer approvals = db.queryForObject("""
        select count(*) from form_review_requests r join form_review_approvals a on a.review_request_id=r.id
        where r.id=? and r.form_id=? and r.state='APPROVED' and r.source_revision=?
          and r.package_hash=? and r.manifest_hash=? and a.source_revision=r.source_revision
          and a.package_hash=r.package_hash and a.manifest_hash=r.manifest_hash
        """, Integer.class, request, form, snapshot.revision(), snapshot.packageHash(), snapshot.manifestHash());
    if (approvals == null || approvals == 0) throw conflict("GOVERNED_APPROVAL_REQUIRED");
    ResponseEntity<?> result = intake.publishGoverned(workspace, form, token, snapshot.packageJson(), snapshot.manifestJson());
    @SuppressWarnings("unchecked") Map<String, Object> body = (Map<String, Object>) result.getBody();
    UUID release = UUID.fromString(body.get("releaseId").toString());
    db.update("update form_releases set release_state='ROLLED_BACK' where form_id=? and id<>? and release_state='ACTIVE'", form, release);
    db.update("update form_releases set package_hash=?,manifest_hash=?,release_state='ACTIVE',activated_at=now() where id=?",
        snapshot.packageHash(), snapshot.manifestHash(), release);
    // A published share identity is durable; activation changes its target but never recreates its cap.
    db.update("update form_share_channels set release_id=? where form_id=? and state='ACTIVE'", release, form);
    db.update("""
        insert into form_release_selections(form_id,active_release_id,selected_by) values(?,?,?)
        on conflict(form_id) do update set active_release_id=excluded.active_release_id,
          selected_by=excluded.selected_by,selected_at=now()
        """, form, release, account(token));
    db.update("update form_review_requests set state='PUBLISHED',published_release_id=? where id=?", release, request);
    return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
        "releaseId", release, "version", body.get("version"), "shareId", form.toString(), "status", "ACTIVE",
        "packageHash", snapshot.packageHash(), "manifestHash", snapshot.manifestHash()));
  }

  @Transactional
  public Map<String, Object> transition(String workspace, UUID form, UUID release, String action, String token) {
    authorization.requirePublishForm(workspace, token, form);
    intake.lockWorkspacePolicy(form);
    db.queryForObject("select id from forms where id=? for update", UUID.class, form);
    if (db.queryForObject("select count(*) from form_releases where id=? and form_id=?", Integer.class, release, form) != 1)
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Release not found");
    UUID actor = account(token);
    if ("activate".equals(action) || "rollback".equals(action)) {
      String state = db.queryForObject("select release_state from form_releases where id=? for update", String.class, release);
      if ("RETIRED".equals(state) || "EMERGENCY_CLOSED".equals(state)) throw conflict("RELEASE_TERMINAL");
      db.update("update form_releases set release_state='ROLLED_BACK' where form_id=? and id<>? and release_state='ACTIVE'", form, release);
      db.update("update form_releases set release_state='ACTIVE',activated_at=now(),retired_at=null,emergency_closed_at=null where id=?", release);
      db.update("update form_share_channels set release_id=? where form_id=? and state='ACTIVE'", release, form);
      db.update("""
          insert into form_release_selections(form_id,active_release_id,selected_by) values(?,?,?)
          on conflict(form_id) do update set active_release_id=excluded.active_release_id,selected_by=excluded.selected_by,selected_at=now()
          """, form, release, actor);
    } else if ("retire".equals(action)) {
      db.update("update form_releases set release_state='RETIRED',retired_at=now() where id=?", release);
      db.update("update form_release_selections set active_release_id=null,selected_by=?,selected_at=now() where form_id=? and active_release_id=?", actor, form, release);
    } else if ("emergency-close".equals(action)) {
      db.update("update form_releases set release_state='EMERGENCY_CLOSED',emergency_closed_at=now() where id=?", release);
      db.update("update form_release_selections set active_release_id=null,selected_by=?,selected_at=now() where form_id=? and active_release_id=?", actor, form, release);
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
    if (db.queryForObject("select count(*) from form_releases where id=? and form_id=? and release_state='ACTIVE'", Integer.class, release, form) != 1)
      throw conflict("RELEASE_NOT_ACTIVE");
    String type = String.valueOf(in.getOrDefault("type", "LINK")).toUpperCase();
    if (!List.of("LINK", "QR", "IFRAME").contains(type)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid channel type");
    List<?> origins = in.get("allowedOrigins") instanceof List<?> values ? values : List.of();
    if ("IFRAME".equals(type) && origins.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Iframe channels require an allowed parent origin");
    if (origins.stream().anyMatch(value -> !(value instanceof String origin) || !origin.matches("https://[^/]+(:[0-9]+)?")))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Origins must be HTTPS origins");
    if (origins.stream().map(String::valueOf).anyMatch(origin -> !browserSecurity.allowsOrigin(origin)))
      throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "CHANNEL_ORIGIN_NOT_CORS_ALLOWED");
    UUID id = UUID.randomUUID();
    db.update("""
        insert into form_share_channels(id,form_id,release_id,channel_type,opens_at,closes_at,response_cap,allowed_origins,created_by)
        values(?,?,?, ?,cast(? as timestamptz),cast(? as timestamptz),?,cast(? as jsonb),?)
        """, id, form, release, type, in.get("opensAt"), in.get("closesAt"), in.get("responseCap"), write(origins), account(token));
    String publicPath = "IFRAME".equals(type)
        ? "/v1/public/channels/" + id + "/embed?parentOrigin=" + (origins.isEmpty() ? "" : origins.get(0))
        : "/f/" + form + "?channel=" + id;
    return Map.of("channelId", id, "shareId", form.toString(), "type", type, "releaseId", release, "publicPath", publicPath);
  }
  @Transactional
  public Map<String,Object> revokeChannel(String workspace, UUID form, UUID channel, String token) {
    authorization.requirePublishForm(workspace, token, form);
    if (db.update("update form_share_channels set state='CLOSED' where id=? and form_id=? and state='ACTIVE'", channel, form) != 1)
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Share channel not active");
    return Map.of("channelId",channel,"state","REVOKED");
  }

  private Snapshot snapshot(UUID form) {
    Map<String, Object> value = intake.publicationSnapshot(form);
    JsonNode packageNode = read(value.get("package").toString());
    if (hasRequiredUnsupportedCapture(packageNode))
      throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "UNSUPPORTED_REQUIRED_CAPTURE");
    return new Snapshot(((Number) value.get("revision")).longValue(), value.get("package").toString(),
        value.get("packageHash").toString(), value.get("manifestHash").toString(), value.get("manifest").toString());
  }
  private List<String> changedPaths(JsonNode before, JsonNode after, String path) {
    if (before.equals(after)) return List.of();
    if (before.isObject() && after.isObject()) {
      java.util.Set<String> names = new java.util.TreeSet<>(); before.fieldNames().forEachRemaining(names::add); after.fieldNames().forEachRemaining(names::add);
      List<String> changed = new java.util.ArrayList<>();
      for (String name : names) changed.addAll(changedPaths(before.path(name), after.path(name), path + "/" + name.replace("~", "~0").replace("/", "~1")));
      return changed;
    }
    if (before.isArray() && after.isArray()) {
      List<String> changed = new java.util.ArrayList<>(); int length = Math.max(before.size(), after.size());
      for (int index=0; index<length; index++) changed.addAll(changedPaths(before.path(index), after.path(index), path + "/" + index));
      return changed;
    }
    return List.of(path.isEmpty() ? "/" : path);
  }
  private boolean hasRequiredUnsupportedCapture(JsonNode packageNode) {
    java.util.Set<String> captureIds = new java.util.HashSet<>();
    collectRequiredCaptures(packageNode.path("data").path("fields"), captureIds, packageNode);
    return hasStaticRequiredCapture(packageNode.path("data").path("fields"), packageNode) || hasRequiredCapturePlacement(packageNode.path("flow"), captureIds, packageNode);
  }
  private void collectRequiredCaptures(JsonNode fields, java.util.Set<String> captureIds, JsonNode pkg) {
    if (!fields.isArray()) return;
    for (JsonNode field : fields) {
      String type = field.path("type").asText();
      if ("attachments".equals(type) || "drawing".equals(type)) {
        captureIds.add(field.path("id").asText());
      }
      collectRequiredCaptures(field.path("fields"), captureIds, pkg); collectRequiredCaptures(field.path("itemSchema").path("fields"), captureIds, pkg);
    }
  }
  private boolean hasStaticRequiredCapture(JsonNode fields, JsonNode pkg) {
    if(!fields.isArray()) return false; for(JsonNode field:fields) {
      if (("attachments".equals(field.path("type").asText()) || "drawing".equals(field.path("type").asText()))
          && (field.path("required").asBoolean(false) || field.path("constraints").path("required").asBoolean(false) || requiredExpressionCanBeTrue(field.path("requiredExpressionId").asText(null),pkg))) return true;
      if(hasStaticRequiredCapture(field.path("fields"),pkg) || hasStaticRequiredCapture(field.path("itemSchema").path("fields"),pkg)) return true;
    } return false;
  }
  private boolean hasRequiredCapturePlacement(JsonNode node, java.util.Set<String> captures, JsonNode pkg) {
    if (node.isObject()) {
      if (captures.contains(node.path("fieldId").asText()) && requiredExpressionCanBeTrue(node.path("requiredExpressionId").asText(null),pkg)) return true;
      java.util.Iterator<JsonNode> values=node.elements(); while(values.hasNext()) if(hasRequiredCapturePlacement(values.next(),captures,pkg)) return true;
    } else if(node.isArray()) for(JsonNode child:node) if(hasRequiredCapturePlacement(child,captures,pkg)) return true;
    return false;
  }
  private boolean requiredExpressionCanBeTrue(String id, JsonNode pkg) {
    if(id==null||id.isBlank()) return false;
    JsonNode expressions=pkg.path("expressions"); JsonNode expression=expressions.path(id);
    if(expression.isMissingNode()&&expressions.isArray()) for(JsonNode item:expressions) if(id.equals(item.path("id").asText())) { expression=item.path("expression").isMissingNode()?item:item.path("expression"); break; }
    if(expression.isBoolean()) return expression.booleanValue();
    if(expression.has("value")&&expression.path("value").isBoolean()) return expression.path("value").booleanValue();
    if(expression.path("literal").path("type").asText().equals("boolean") && expression.path("literal").path("value").isBoolean()) return expression.path("literal").path("value").booleanValue();
    return true; // unknown/nonconstant expression is conservatively required
  }
  private void invalidateChangedRequests(UUID form, Snapshot snapshot) {
    db.update("""
        update form_review_requests set state='INVALIDATED',invalidated_at=now()
        where form_id=? and state in ('OPEN','APPROVED') and (source_revision<>? or package_hash<>? or manifest_hash<>?)
        """, form, snapshot.revision(), snapshot.packageHash(), snapshot.manifestHash());
  }
  private UUID account(String token) {
    try {
      HttpServletRequest request = ((ServletRequestAttributes) RequestContextHolder.currentRequestAttributes()).getRequest();
      String session = sessions.session(request, token).orElseThrow();
      return db.queryForObject("select account_id from staff_sessions where token::text=?", UUID.class, session);
    } catch (Exception e) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Valid staff workspace session required");
    }
  }
  private JsonNode read(String value) { try { return json.readTree(value); } catch (Exception e) { throw new IllegalArgumentException(e); } }
  private String write(Object value) { try { return json.writeValueAsString(value); } catch (Exception e) { throw new IllegalArgumentException(e); } }
  private ResponseStatusException conflict(String code) { return new ResponseStatusException(HttpStatus.CONFLICT, code); }
  private record Snapshot(long revision, String packageJson, String packageHash, String manifestHash, String manifestJson) {}
}
