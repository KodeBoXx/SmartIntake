package com.kodeboxx.smartintake;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.kodeboxx.smartintake.application.IntakeApplicationService;
import com.kodeboxx.smartintake.compatibility.CompatibilityProfile;
import com.kodeboxx.smartintake.compatibility.RespondentSecretVerifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;

@ActiveProfiles("test")
@SpringBootTest
@AutoConfigureMockMvc
class M4CanonicalRuntimeIntegrationTests {
  @Autowired IntakeApplicationService intake;
  @Autowired JdbcTemplate db;
  @Autowired RespondentSecretVerifier secrets;
  @Autowired ObjectMapper json;
  @Autowired MockMvc http;

  @Test
  void canonicalSessionMutationsPersistReconcileReplayAndSubmit() throws Exception {
    Fixture fixture = fixture();
    String mutationId = "mutation-typed-01";
    var patch = new IntakeApplicationService.PatchSession(0L, mutationId, null, List.of(
        Map.of("op", "set", "fieldId", "amount", "value", "9223372036854775807"),
        Map.of("op", "addItem", "fieldId", "attendees", "itemId", "attendee-a", "initialFields",
            Map.of("attendeeName", Map.of("status", "answered", "value", "Ada")))), "page1");
    String response = http.perform(patch("/v1/sessions/{id}", fixture.session)
            .header("X-Respondent-Session", fixture.bearer.toString())
            .contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsBytes(patch)))
        .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    @SuppressWarnings("unchecked")
    Map<String, Object> accepted = json.readValue(response, Map.class);
    assertEquals(1L, ((Number) accepted.get("acceptedRevision")).longValue());
    assertEquals("integer", json.valueToTree(accepted.get("answers")).at("/amount/type").asText());
    assertEquals("attendee-a", json.valueToTree(accepted.get("answers"))
        .at("/attendees/value/items/0/itemId").asText());

    Map<String, Object> replayed = intake.patch(fixture.session, fixture.bearer.toString(), patch);
    assertEquals(((Number) accepted.get("acceptedRevision")).longValue(),
        ((Number) replayed.get("acceptedRevision")).longValue());
    assertEquals(json.valueToTree(accepted.get("answers")), json.valueToTree(replayed.get("answers")));
    ResponseStatusException reused = assertThrows(ResponseStatusException.class, () -> intake.patch(
        fixture.session, fixture.bearer.toString(), new IntakeApplicationService.PatchSession(
            0L, mutationId, null,
            List.of(Map.of("op", "clear", "fieldId", "amount")), "page1")));
    assertEquals(HttpStatus.CONFLICT, reused.getStatusCode());

    Map<String, Object> session = intake.session(fixture.session, fixture.bearer.toString());
    assertEquals(1L, ((Number) session.get("revision")).longValue());
    assertEquals("9223372036854775807", json.valueToTree(session.get("answers")).at("/amount/value").asText());
    Map<String, Object> review = intake.validate(fixture.session, fixture.bearer.toString());
    Map<String, Object> repeatedReview = intake.validate(fixture.session, fixture.bearer.toString());
    assertEquals(review.get("reviewDigest"), repeatedReview.get("reviewDigest"));
    assertEquals(review.get("review"), repeatedReview.get("review"));
    var submissionRequest = new IntakeApplicationService.Submit(
        1L, review.get("reviewDigest").toString(), List.of(), "submission-attempt-01");
    assertTrue(intake.submit(fixture.session, fixture.bearer.toString(), submissionRequest)
        .getStatusCode().is2xxSuccessful());
    assertTrue(intake.submit(fixture.session, fixture.bearer.toString(), submissionRequest)
        .getStatusCode().is2xxSuccessful());
    assertThrows(ResponseStatusException.class, () -> intake.submit(
        fixture.session, fixture.bearer.toString(), new IntakeApplicationService.Submit(
            1L, review.get("reviewDigest").toString(), List.of(), "submission-attempt-other")));
    assertEquals(1, db.queryForObject(
        "select count(*) from submissions where session_id=?", Integer.class, fixture.session));
    assertEquals(1, db.queryForObject("""
        select count(*) from submission_outbox_events o join submissions s on s.id=o.submission_id
        where s.session_id=? and o.event_type='submission.accepted'
        """, Integer.class, fixture.session));
    JsonNode sealed = json.readTree(db.queryForObject(
        "select envelope::text from submissions where session_id=?", String.class, fixture.session));
    JsonNode sealedReview = json.readTree(db.queryForObject(
        "select review_projection::text from submissions where session_id=?", String.class, fixture.session));
    assertEquals(json.valueToTree(review.get("review")), sealedReview);
    assertEquals(review.get("reviewDigest"), db.queryForObject(
        "select review_digest from submissions where session_id=?", String.class, fixture.session));
    assertEquals(review.get("reviewDigest"), sealed.at("/extensions/x-kodeboxx.review/value").asText());
    assertEquals("succeeded", intake.submissionOperation(fixture.session, fixture.bearer.toString()).get("state"));
  }

  @Test
  void canonicalProtectedMutationIsRejectedWithoutRevisionAdvance() throws Exception {
    ObjectNode pkg = canonical();
    ((ObjectNode) pkg.at("/data/fields/1")).put("readOnly", true);
    Fixture fixture = fixture(pkg);
    ResponseStatusException rejected = assertThrows(ResponseStatusException.class, () -> intake.patch(
        fixture.session, fixture.bearer.toString(), new IntakeApplicationService.PatchSession(
            0L, UUID.randomUUID(), null,
            List.of(Map.of("op", "set", "fieldId", "amount", "value", "7")), "page1")));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, rejected.getStatusCode());
    assertEquals(0L, db.queryForObject(
        "select revision from sessions where id=?", Long.class, fixture.session));
  }

  @Test
  void canonicalOperationBatchAccepts1000AndRejects1001BeforeMutationWork() throws Exception {
    Fixture acceptedFixture = fixture();
    List<Map<String, Object>> thousand = new ArrayList<>();
    for (int index = 0; index < 1000; index++)
      thousand.add(Map.of("op", "clear", "fieldId", "amount"));
    Map<String, Object> accepted = intake.patch(acceptedFixture.session, acceptedFixture.bearer.toString(),
        new IntakeApplicationService.PatchSession(0L, "mutation-limit-1000", null, thousand, "page1"));
    assertEquals(1L, ((Number) accepted.get("acceptedRevision")).longValue());

    Fixture rejectedFixture = fixture();
    List<Map<String, Object>> thousandAndOne = new ArrayList<>(thousand);
    thousandAndOne.add(Map.of("op", "clear", "fieldId", "amount"));
    ResponseStatusException rejected = assertThrows(ResponseStatusException.class,
        () -> intake.patch(rejectedFixture.session, rejectedFixture.bearer.toString(),
            new IntakeApplicationService.PatchSession(0L, "mutation-limit-1001", null,
                thousandAndOne, "page1")));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, rejected.getStatusCode());
    assertEquals(0L, db.queryForObject("select revision from sessions where id=?", Long.class,
        rejectedFixture.session));
  }

  @Test
  void retiredItemIdentityCannotBeReusedAcrossRequests() throws Exception {
    Fixture fixture = fixture();
    intake.patch(fixture.session, fixture.bearer.toString(), new IntakeApplicationService.PatchSession(
        0L, "mutation-add-01", null,
        List.of(Map.of("op", "addItem", "fieldId", "attendees", "itemId", "attendee-a")), "page1"));
    intake.patch(fixture.session, fixture.bearer.toString(), new IntakeApplicationService.PatchSession(
        1L, "mutation-remove-01", null,
        List.of(Map.of("op", "removeItem", "fieldId", "attendees", "itemId", "attendee-a")), "page1"));
    ResponseStatusException rejected = assertThrows(ResponseStatusException.class, () -> intake.patch(
        fixture.session, fixture.bearer.toString(), new IntakeApplicationService.PatchSession(
            2L, "mutation-reuse-01", null,
            List.of(Map.of("op", "addItem", "fieldId", "attendees", "itemId", "attendee-a")), "page1")));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, rejected.getStatusCode());
    assertEquals(2L, db.queryForObject("select revision from sessions where id=?", Long.class, fixture.session));
  }

  @Test
  void invalidInputMarkerSurvivesReloadAndBlocksSubmission() throws Exception {
    Fixture fixture = fixture();
    intake.patch(fixture.session, fixture.bearer.toString(), new IntakeApplicationService.PatchSession(
        0L, "mutation-value-01", null,
        List.of(Map.of("op", "set", "fieldId", "amount", "value", "7")), "page1"));
    Map<String, Object> marked = intake.patch(
        fixture.session, fixture.bearer.toString(), new IntakeApplicationService.PatchSession(
            1L, "mutation-invalid-01", null,
            List.of(Map.of("op", "markInvalid", "fieldId", "amount",
                "reason", "UNPARSEABLE_INPUT")), "page1"));
    assertTrue(json.valueToTree(marked.get("validation")).toString().contains("UNPARSEABLE_INPUT"));
    ResponseStatusException validation = assertThrows(ResponseStatusException.class,
        () -> intake.validate(fixture.session, fixture.bearer.toString()));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, validation.getStatusCode());
    var submission = intake.submit(
        fixture.session, fixture.bearer.toString(), new IntakeApplicationService.Submit(2L));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, submission.getStatusCode());
    assertEquals("INVALID_INPUT_PENDING", json.valueToTree(submission.getBody()).path("code").asText());
  }

  @Test
  void mutatedCanonicalSessionWithoutTrustedRuntimeStateFailsClosed() throws Exception {
    Fixture fixture = fixture();
    db.update("update sessions set revision=1,runtime_state=null where id=?", fixture.session);
    ResponseStatusException rejected = assertThrows(ResponseStatusException.class,
        () -> intake.session(fixture.session, fixture.bearer.toString()));
    assertEquals(HttpStatus.CONFLICT, rejected.getStatusCode());
    assertEquals("CANONICAL_RUNTIME_STATE_REQUIRED", rejected.getReason());
  }

  @Test
  void reviewTraversesLayoutWrappersAndSealsEveryNestedAnswer() throws Exception {
    ObjectNode pkg = canonical();
    ArrayNode nodes = (ArrayNode) pkg.at("/flow/phases/0/pages/0/sections/0/nodes");
    JsonNode name = nodes.remove(0);
    ObjectNode group = (ObjectNode) json.readTree(
        "{\"id\":\"identityGroup\",\"kind\":\"group\",\"labelKey\":\"title\",\"children\":[]}");
    ((ArrayNode) group.path("children")).add(name);
    nodes.insert(0, group);
    Fixture fixture = fixture(pkg);
    intake.patch(fixture.session, fixture.bearer.toString(), new IntakeApplicationService.PatchSession(
        0L, "mutation-group-review", null,
        List.of(Map.of("op", "set", "fieldId", "name",
            "value", Map.of("status", "answered", "value", "Ada"))), "page1"));
    JsonNode review = json.valueToTree(intake.validate(fixture.session, fixture.bearer.toString()).get("review"));
    assertTrue(review.path("answers").toString().contains("\"fieldId\":\"name\""));
    assertTrue(review.path("export").toString().contains("\"fieldId\":\"name\""));
  }

  @Test
  void canonicalAcknowledgmentRequiresCurrentContentHashAndIsSealed() throws Exception {
    ObjectNode pkg = canonical();
    ((ArrayNode) pkg.at("/data/fields")).add(json.readTree(
        "{\"id\":\"consent\",\"key\":\"consent\",\"type\":\"boolean\",\"labelKey\":\"consent\"}"));
    ((ObjectNode) pkg.at("/translations/en/messages")).put("consent", "I agree");
    ((ArrayNode) pkg.at("/flow/phases/0/pages/0/sections/0/nodes")).add(json.readTree("""
        {"id":"consentPlacement","kind":"question","fieldId":"consent","fieldType":"boolean",
         "control":"acknowledgment","labelKey":"consent","acknowledgmentContentKey":"consent"}"""));
    Fixture fixture = fixture(pkg);
    intake.patch(fixture.session, fixture.bearer.toString(), new IntakeApplicationService.PatchSession(
        0L, "mutation-consent-true", null,
        List.of(Map.of("op", "set", "fieldId", "consent",
            "value", Map.of("status", "answered", "value", true))), "page1"));
    Map<String, Object> validation = intake.validate(fixture.session, fixture.bearer.toString());
    JsonNode gate = json.valueToTree(validation.get("review")).path("reviewGates").get(0);
    assertThrows(ResponseStatusException.class, () -> intake.submit(
        fixture.session, fixture.bearer.toString(), new IntakeApplicationService.Submit(
            1L, validation.get("reviewDigest").toString(), List.of(), "attempt-consent-missing")));
    assertEquals("failed", intake.submissionOperation(fixture.session, fixture.bearer.toString()).get("state"));
    Map<String, Object> acknowledgment = Map.of(
        "fieldId", "consent", "rowPath", List.of(),
        "expectedContentHash", gate.path("contentHash").asText(), "accepted", true);
    assertTrue(intake.submit(fixture.session, fixture.bearer.toString(), new IntakeApplicationService.Submit(
        1L, validation.get("reviewDigest").toString(), List.of(acknowledgment),
        "attempt-consent-valid")).getStatusCode().is2xxSuccessful());
    JsonNode sealed = json.readTree(db.queryForObject(
        "select envelope::text from submissions where session_id=?", String.class, fixture.session));
    assertEquals(gate.path("contentHash").asText(), sealed.at("/acknowledgments/0/contentHash").asText());
    assertEquals("4.0.0", db.queryForObject(
        "select runtime_manifest->>'schemaVersion' from submissions where session_id=?",
        String.class, fixture.session));
    assertThrows(ResponseStatusException.class, () -> intake.submit(
        fixture.session, fixture.bearer.toString(), new IntakeApplicationService.Submit(
            1L, validation.get("reviewDigest").toString(), List.of(), "attempt-consent-missing")));
  }

  @Test
  void iframeChannelRejectsOriginsAndAtomicallyEnforcesItsCap() throws Exception {
    Fixture fixture = fixture();
    UUID form = db.queryForObject("select form_id from sessions where id=?", UUID.class, fixture.session);
    UUID release = db.queryForObject("select release_id from sessions where id=?", UUID.class, fixture.session);
    UUID account = UUID.randomUUID(), channel = UUID.randomUUID();
    db.update("insert into accounts(id,email,password_hash) values(?,?,?)", account, "channel-" + account + "@example.test", "unused");
    db.update("update form_releases set release_state='ACTIVE' where id=?", release);
    db.update("""
        insert into form_share_channels(id,form_id,release_id,channel_type,response_cap,allowed_origins,created_by)
        values(?,?,?,'IFRAME',1,cast('["https://embed.example.test"]' as jsonb),?)
        """, channel, form, release, account);
    ResponseStatusException denied = assertThrows(ResponseStatusException.class,
        () -> intake.startChannel(channel, "https://denied.example.test", null));
    assertEquals(HttpStatus.FORBIDDEN, denied.getStatusCode());
    assertTrue(intake.startChannel(channel, "https://embed.example.test", null).getStatusCode().is2xxSuccessful());
    ResponseStatusException capped = assertThrows(ResponseStatusException.class,
        () -> intake.startChannel(channel, "https://embed.example.test", null));
    assertEquals(HttpStatus.GONE, capped.getStatusCode());
    assertEquals(1L, db.queryForObject("select starts_count from form_share_channels where id=?", Long.class, channel));
  }

  @Test
  void activePlacementRequirednessAndValidationAreAuthoritative() throws Exception {
    ObjectNode pkg = canonical();
    ((ObjectNode) pkg.path("expressions")).set("placementRequired",
        json.readTree("{\"literal\":{\"type\":\"boolean\",\"value\":true}}"));
    ((ObjectNode) pkg.path("expressions")).set("placementInvalid",
        json.readTree("{\"literal\":{\"type\":\"boolean\",\"value\":false}}"));
    ObjectNode namePlacement = (ObjectNode) pkg.at("/flow/phases/0/pages/0/sections/0/nodes/0");
    namePlacement.put("requiredExpressionId", "placementRequired");
    namePlacement.put("validationExpressionId", "placementInvalid");
    Fixture fixture = fixture(pkg);
    intake.patch(fixture.session, fixture.bearer.toString(), new IntakeApplicationService.PatchSession(
        0L, "mutation-placement-required", null,
        List.of(Map.of("op", "set", "fieldId", "amount",
            "value", Map.of("status", "answered", "value", "1"))), "page1"));
    JsonNode required = json.valueToTree(intake.validate(fixture.session, fixture.bearer.toString()).get("errors"));
    assertTrue(required.toString().contains("REQUIRED"));
    intake.patch(fixture.session, fixture.bearer.toString(), new IntakeApplicationService.PatchSession(
        1L, "mutation-placement-validation", null,
        List.of(Map.of("op", "set", "fieldId", "name",
            "value", Map.of("status", "answered", "value", "Ada"))), "page1"));
    JsonNode invalid = json.valueToTree(intake.validate(fixture.session, fixture.bearer.toString()).get("errors"));
    assertTrue(invalid.toString().contains("VALIDATION_FAILED"));
  }

  @Test
  void pageCompletionIsServerValidatedAndRevokedPerPage() throws Exception {
    ObjectNode pkg = canonical();
    ((ObjectNode) pkg.at("/data/fields/0")).put("required", true);
    ((ObjectNode) pkg.at("/data/fields/1")).put("required", true);
    ArrayNode pages = (ArrayNode) pkg.at("/flow/phases/0/pages");
    ObjectNode firstPage = (ObjectNode) pages.get(0);
    ArrayNode firstNodes = (ArrayNode) firstPage.at("/sections/0/nodes");
    JsonNode amountNode = firstNodes.remove(1);
    while (firstNodes.size() > 1) firstNodes.remove(1);
    firstPage.put("defaultNextPageId", "page2");
    ObjectNode secondPage = (ObjectNode) json.readTree("""
        {"id":"page2","key":"page2","labelKey":"title","defaultNextPageId":"pageReview",
         "sections":[{"id":"section2","key":"second","labelKey":"title","nodes":[]}]}""");
    ((ArrayNode) secondPage.at("/sections/0/nodes")).add(amountNode);
    ObjectNode reviewPage = (ObjectNode) json.readTree("""
        {"id":"pageReview","key":"review_page","labelKey":"title",
         "sections":[{"id":"reviewSection","key":"review_section","labelKey":"title","nodes":[
           {"id":"review","kind":"review","labelKey":"title"}]}]}""");
    pages.add(secondPage).add(reviewPage);
    Fixture fixture = fixture(pkg);
    intake.patch(fixture.session, fixture.bearer.toString(), new IntakeApplicationService.PatchSession(
        0L, "mutation-page-answer", null,
        List.of(Map.of("op", "set", "fieldId", "name",
            "value", Map.of("status", "answered", "value", "Ada"))), "page1"));
    Map<String, Object> progressed = intake.patch(
        fixture.session, fixture.bearer.toString(), new IntakeApplicationService.PatchSession(
            1L, "mutation-page-progress", null,
            List.of(Map.of("op", "set", "fieldId", "amount",
                "value", Map.of("status", "answered", "value", "1"))), "page2"));
    assertEquals(2, progressed.get("requiredCount"));
    assertEquals(1, progressed.get("completedRequiredCount"));
    intake.patch(fixture.session, fixture.bearer.toString(), new IntakeApplicationService.PatchSession(
        2L, "mutation-page-back", null,
        List.of(Map.of("op", "set", "fieldId", "amount",
            "value", Map.of("status", "answered", "value", "1"))), "page1"));
    assertEquals("page1", db.queryForObject(
        "select runtime_state->>'currentPageId' from sessions where id=?", String.class, fixture.session));
    Map<String, Object> revoked = intake.patch(
        fixture.session, fixture.bearer.toString(), new IntakeApplicationService.PatchSession(
            3L, "mutation-page-revoke", null,
            List.of(Map.of("op", "clear", "fieldId", "name")), "page1"));
    assertEquals(0, revoked.get("completedRequiredCount"));
  }

  @Test
  void invalidMarkerHidesPriorAnswerAndPersistsItsRevision() throws Exception {
    Fixture fixture = fixture();
    intake.patch(fixture.session, fixture.bearer.toString(), new IntakeApplicationService.PatchSession(
        0L, "mutation-before-invalid", null,
        List.of(Map.of("op", "set", "fieldId", "amount",
            "value", Map.of("status", "answered", "value", "42"))), "page1"));
    Map<String, Object> invalid = intake.patch(
        fixture.session, fixture.bearer.toString(), new IntakeApplicationService.PatchSession(
            1L, "mutation-mark-invalid", null,
            List.of(Map.of("op", "markInvalid", "fieldId", "amount",
                "reason", "UNPARSEABLE_INPUT")), "page1"));
    JsonNode response = json.valueToTree(invalid);
    assertEquals("unanswered", response.at("/answers/amount/status").asText());
    assertFalse(response.at("/answers/amount").has("value"));
    assertEquals(2L, response.at("/invalidInputs/0/markedAtRevision").asLong());
    JsonNode reloaded = json.valueToTree(intake.session(fixture.session, fixture.bearer.toString()));
    assertEquals(2L, reloaded.at("/invalidInputs/0/markedAtRevision").asLong());
  }

  private Fixture fixture() throws Exception { return fixture(canonical()); }

  private Fixture fixture(ObjectNode pkg) throws Exception {
    UUID organization = UUID.randomUUID(), workspace = UUID.randomUUID();
    UUID form = UUID.randomUUID(), release = UUID.randomUUID(), session = UUID.randomUUID(), bearer = UUID.randomUUID();
    String packageJson = json.writeValueAsString(pkg);
    db.update("insert into organizations(id,name) values(?,?)", organization, "M4 organization");
    db.update("insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?)",
        workspace, organization, "m4-" + workspace, "M4 workspace");
    db.update("insert into forms(id,workspace_id,form_key,title,definition,compatibility_profile_key)"
            + " values(?,?,?,?,cast(? as jsonb),?)",
        form, workspace, "m4-" + form, "M4", packageJson, CompatibilityProfile.CANONICAL_4_0_0.key());
    db.update("insert into form_releases(id,form_id,version,package,compatibility_profile_key)"
            + " values(?,?,1,cast(? as jsonb),?)",
        release, form, packageJson, CompatibilityProfile.CANONICAL_4_0_0.key());
    db.update("insert into sessions(id,form_id,release_id,respondent_token,respondent_secret_sha256,"
            + "compatibility_profile_key,answers,session_date,time_zone,tzdb_version)"
            + " values(?,?,?,?,?,?,cast('{}' as jsonb),current_date,'UTC','IANA-tzdb-2025b-m3-complete-1')",
        session, form, release, UUID.randomUUID(), secrets.digest(bearer),
        CompatibilityProfile.CANONICAL_4_0_0.key());
    return new Fixture(session, bearer);
  }

  private ObjectNode canonical() throws Exception {
    ObjectNode pkg = (ObjectNode) json.readTree(Files.readString(
        Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/fixtures/package.positive.json")));
    ((ArrayNode) pkg.at("/flow/phases/0/pages/0/sections/0/nodes"))
        .add(json.readTree("{\"id\":\"review\",\"kind\":\"review\",\"labelKey\":\"title\"}"));
    return pkg;
  }

  private record Fixture(UUID session, UUID bearer) {}
}
