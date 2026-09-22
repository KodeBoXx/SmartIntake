package com.kodeboxx.smartintake;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.kodeboxx.smartintake.application.IntakeApplicationService;
import com.kodeboxx.smartintake.contract.CanonicalJson;
import com.kodeboxx.smartintake.publication.GovernedPublicationService;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import jakarta.servlet.http.Cookie;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;

@ActiveProfiles("test")
@SpringBootTest
class GovernedPublicationIntegrationTests {
  @Autowired JdbcTemplate db;
  @Autowired ObjectMapper json;
  @Autowired GovernedPublicationService governed;
  @Autowired IntakeApplicationService intake;
  UUID account, form, workspaceId;
  String workspace, token;
  ObjectNode definition;

  @BeforeEach void seed() throws Exception {
    account = UUID.randomUUID(); form = UUID.randomUUID(); workspaceId = UUID.randomUUID(); token = UUID.randomUUID().toString();
    UUID org = UUID.randomUUID(); workspace = "m8-" + form.toString().substring(0, 8);
    db.update("insert into accounts(id,email,password_hash) values(?,?,?)", account, account + "@example.test", "x");
    db.update("insert into organizations(id,name) values(?,?)", org, "M8");
    db.update("insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?)", workspaceId, org, workspace, "M8");
    db.update("insert into organization_memberships(account_id,organization_id,roles,membership_status) values(?,?,array['member'],'active')", account, org);
    for (String role : List.of("AUTHOR", "REVIEWER", "PUBLISHER")) db.update("insert into memberships(account_id,workspace_id,role) values(?,?,?)", account, workspaceId, role);
    db.update("insert into staff_sessions(token,account_id,expires_at,absolute_expires_at,last_seen_at) values(?,?,now()+interval '1 hour',now()+interval '2 hours',now())", UUID.fromString(token), account);
    definition = (ObjectNode) json.readTree(Files.readString(Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/fixtures/package.positive.json")));
    ((ArrayNode) definition.at("/flow/phases/0/pages/0/sections/0/nodes"))
        .add(json.readTree("{\"id\":\"review\",\"kind\":\"review\",\"labelKey\":\"title\"}"));
    db.update("insert into forms(id,workspace_id,form_key,title,definition,revision,compatibility_profile_key) values(?,?,?,?,cast(? as jsonb),1,?)",
        form, workspaceId, "m8-" + form.toString().substring(0, 8), "M8", json.writeValueAsString(definition), "canonical-4.0.0");
    requestContext(); approveLocales(1, definition);
  }

  @AfterEach void clearRequest() { RequestContextHolder.resetRequestAttributes(); }

  @Test void staleReviewIsDurablyInvalidatedAndSnapshotsSemanticAndDependencyDiffs() throws Exception {
    UUID request = UUID.fromString(governed.requestReview(workspace, form, token).get("reviewRequestId").toString());
    JsonNode semantic = json.readTree(db.queryForObject("select semantic_diff::text from form_review_requests where id=?", String.class, request));
    JsonNode dependencies = json.readTree(db.queryForObject("select dependency_diff::text from form_review_requests where id=?", String.class, request));
    assertEquals(CanonicalJson.sha256(definition), semantic.path("toPackageHash").asText());
    assertTrue(semantic.has("fromPackageHash"));
    assertTrue(dependencies.has("from") && dependencies.has("to") && dependencies.has("changed"));

    definition.put("title", "changed after request");
    db.update("update forms set definition=cast(? as jsonb),revision=2 where id=?", json.writeValueAsString(definition), form);
    ResponseStatusException stale = assertThrows(ResponseStatusException.class, () -> governed.approve(workspace, form, request, token));
    assertEquals(HttpStatus.CONFLICT, stale.getStatusCode());
    assertEquals("INVALIDATED", db.queryForObject("select state from form_review_requests where id=?", String.class, request));
  }

  @Test void governedWorkflowResolvesCookieOnlyStaffActor() {
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.setCookies(new Cookie("SI_STAFF_SESSION", token));
    RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    UUID review = UUID.fromString(governed.requestReview(workspace, form, null).get("reviewRequestId").toString());
    governed.approve(workspace, form, review, null);
    assertTrue(governed.publish(workspace, form, review, null).getStatusCode().is2xxSuccessful());
  }

  @Test void governedPublishIsAtomicAndIdempotentAndLifecyclePinsExistingSessions() throws Exception {
    UUID first = publishGoverned();
    assertEquals(1, db.queryForObject("select count(*) from form_releases where form_id=?", Integer.class, form));
    UUID request = db.queryForObject("select id from form_review_requests where form_id=?", UUID.class, form);
    assertEquals(HttpStatus.OK, governed.publish(workspace, form, request, token).getStatusCode());
    assertEquals(1, db.queryForObject("select count(*) from form_releases where form_id=?", Integer.class, form));

    UUID firstChannel = channel(first, "LINK", null, null, null, List.of());
    var old = intake.startChannel(firstChannel, null, null); assertTrue(old.getStatusCode().is2xxSuccessful());
    UUID oldSession = UUID.fromString(((Map<?, ?>) old.getBody()).get("sessionId").toString());
    definition.withObject("translations").withObject("en").withObject("messages").put("title", "release two");
    db.update("update forms set definition=cast(? as jsonb),revision=2 where id=?", json.writeValueAsString(definition), form);
    approveLocales(2, definition);
    UUID second = publishGoverned();
    UUID secondChannel = channel(second, "LINK", null, null, null, List.of());
    UUID activeSession = UUID.fromString(((Map<?, ?>) intake.startChannel(secondChannel, null, null).getBody()).get("sessionId").toString());
    assertEquals(second, db.queryForObject("select release_id from sessions where id=?", UUID.class, activeSession));
    assertEquals(first, db.queryForObject("select release_id from sessions where id=?", UUID.class, oldSession));

    governed.transition(workspace, form, first, "rollback", token);
    UUID rollbackChannel = channel(first, "LINK", null, null, null, List.of());
    UUID rollbackSession = UUID.fromString(((Map<?, ?>) intake.startChannel(rollbackChannel, null, null).getBody()).get("sessionId").toString());
    assertEquals(first, db.queryForObject("select release_id from sessions where id=?", UUID.class, rollbackSession));
    assertEquals(second, db.queryForObject("select release_id from sessions where id=?", UUID.class, activeSession));

    governed.transition(workspace, form, first, "retire", token);
    assertThrows(ResponseStatusException.class, () -> intake.start(form, null));
    assertEquals("DRAFT", db.queryForObject("select status from sessions where id=?", String.class, rollbackSession));
    governed.transition(workspace, form, second, "activate", token);
    UUID emergencyChannel = channel(second, "LINK", null, null, null, List.of());
    var emergency = intake.startChannel(emergencyChannel, null, null);
    UUID emergencySession = UUID.fromString(((Map<?, ?>) emergency.getBody()).get("sessionId").toString());
    governed.transition(workspace, form, second, "emergency-close", token);
    assertEquals("CLOSED", db.queryForObject("select status from sessions where id=?", String.class, emergencySession));
  }

  @Test void channelsEnforceAllHalfOpenBoundariesOriginsAndConcurrentCaps() throws Exception {
    UUID release = publishGoverned();
    assertStatus(HttpStatus.UNPROCESSABLE_ENTITY,
        () -> channel(release, "IFRAME", null, null, null, List.of("https://not-configured.example.test")));
    UUID future = channel(release, "LINK", Instant.now().plusSeconds(3600), null, null, List.of());
    UUID expired = channel(release, "LINK", null, Instant.now().minusSeconds(1), null, List.of());
    assertGone(future, null); assertGone(expired, null);
    UUID iframe = channel(release, "IFRAME", null, null, null, List.of("https://embed.example.test"));
    String embed = intake.embedChannel(iframe, "https://embed.example.test", "testnonce");
    assertTrue(embed.contains("nonce=\"testnonce\""));
    assertTrue(embed.contains("typeof d.receiptId==='string'"));
    assertTrue(embed.contains("x.receiptId=d.receiptId"));
    assertStatus(HttpStatus.FORBIDDEN, () -> intake.startChannel(iframe, null, null));
    assertStatus(HttpStatus.FORBIDDEN, () -> intake.bootstrapChannel(iframe, "https://denied.example.test"));
    String bootstrap = intake.bootstrapChannel(iframe, "https://embed.example.test").get("bootstrap").toString();
    assertTrue(intake.startChannel(iframe, bootstrap, new IntakeApplicationService.StartSession("en", "UTC", "https://embed.example.test")).getStatusCode().is2xxSuccessful());

    UUID capped = channel(release, "LINK", null, null, 1L, List.of());
    var pool = Executors.newFixedThreadPool(2); List<Future<Boolean>> starts = new ArrayList<>();
    for (int i = 0; i < 2; i++) starts.add(pool.submit(() -> { try { return intake.startChannel(capped, null, null).getStatusCode().is2xxSuccessful(); } catch (ResponseStatusException gone) { return false; } }));
    int accepted = 0; for (Future<Boolean> start : starts) if (start.get()) accepted++; pool.shutdown();
    assertEquals(2, accepted); assertEquals(0L, db.queryForObject("select accepted_count from form_share_channels where id=?", Long.class, capped));
  }

  private UUID publishGoverned() {
    UUID review = UUID.fromString(governed.requestReview(workspace, form, token).get("reviewRequestId").toString());
    governed.approve(workspace, form, review, token);
    @SuppressWarnings("unchecked") Map<String, Object> release = (Map<String, Object>) governed.publish(workspace, form, review, token).getBody();
    return UUID.fromString(release.get("releaseId").toString());
  }
  private UUID channel(UUID release, String type, Instant opens, Instant closes, Long cap, List<String> origins) {
    Map<String, Object> input = new java.util.LinkedHashMap<>(); input.put("type", type); if (opens != null) input.put("opensAt", opens.toString()); if (closes != null) input.put("closesAt", closes.toString()); if (cap != null) input.put("responseCap", cap); input.put("allowedOrigins", origins);
    return UUID.fromString(governed.createChannel(workspace, form, release, input, token).get("channelId").toString());
  }
  private void approveLocales(long revision, JsonNode packageNode) {
    String hash = CanonicalJson.sha256(packageNode);
    for (JsonNode locale : packageNode.path("supportedLocales")) db.update("""
        insert into form_authoring_locale_reviews(form_id,draft_id,locale,source_revision,source_package_hash,status,reviewed_by,reviewed_at)
        values(?,?,?,?,?,'APPROVED',?,now()) on conflict(form_id,draft_id,locale) do update set source_revision=excluded.source_revision,source_package_hash=excluded.source_package_hash,status='APPROVED',reviewed_by=excluded.reviewed_by,reviewed_at=now()
        """, form, form, locale.asText(), revision, hash, account);
  }
  private void requestContext() { MockHttpServletRequest request = new MockHttpServletRequest(); request.addHeader("X-Staff-Session", token); RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request)); }
  private void assertGone(UUID channel, String origin) { assertStatus(HttpStatus.CONFLICT, () -> intake.startChannel(channel, origin, null)); }
  private void assertStatus(HttpStatus expected, Runnable action) { ResponseStatusException response = assertThrows(ResponseStatusException.class, action::run); assertEquals(expected, response.getStatusCode()); }
}
