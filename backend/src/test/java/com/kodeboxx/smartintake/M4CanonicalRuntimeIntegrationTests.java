package com.kodeboxx.smartintake;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest
class M4CanonicalRuntimeIntegrationTests {
  @Autowired IntakeApplicationService intake;
  @Autowired JdbcTemplate db;
  @Autowired RespondentSecretVerifier secrets;
  @Autowired ObjectMapper json;

  @Test
  void canonicalSessionMutationsPersistReconcileReplayAndSubmit() throws Exception {
    Fixture fixture = fixture();
    String mutationId = "mutation-typed-01";
    var patch = new IntakeApplicationService.PatchSession(0L, mutationId, null, List.of(
        Map.of("op", "set", "fieldId", "amount", "value", "9223372036854775807"),
        Map.of("op", "addItem", "fieldId", "attendees", "itemId", "attendee-a", "fields",
            Map.of("attendeeName", Map.of("status", "answered", "value", "Ada")))), "page1");
    Map<String, Object> accepted = intake.patch(fixture.session, fixture.bearer.toString(), patch);
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
    assertTrue(intake.submit(fixture.session, fixture.bearer.toString(),
        new IntakeApplicationService.Submit(1L)).getStatusCode().is2xxSuccessful());
    assertEquals(1, db.queryForObject(
        "select count(*) from submissions where session_id=?", Integer.class, fixture.session));
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
            List.of(Map.of("op", "markInvalid", "fieldId", "amount")), "page1"));
    assertTrue(json.valueToTree(marked.get("validation")).toString().contains("UNPARSEABLE_INPUT"));
    ResponseStatusException validation = assertThrows(ResponseStatusException.class,
        () -> intake.validate(fixture.session, fixture.bearer.toString()));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, validation.getStatusCode());
    var submission = intake.submit(
        fixture.session, fixture.bearer.toString(), new IntakeApplicationService.Submit(2L));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, submission.getStatusCode());
    assertEquals("INVALID_INPUT_PENDING", json.valueToTree(submission.getBody()).path("code").asText());
  }

  private Fixture fixture() throws Exception { return fixture(canonical()); }

  private Fixture fixture(ObjectNode pkg) throws Exception {
    UUID form = UUID.randomUUID(), release = UUID.randomUUID(), session = UUID.randomUUID(), bearer = UUID.randomUUID();
    String packageJson = json.writeValueAsString(pkg);
    db.update("insert into forms(id,form_key,title,definition,compatibility_profile_key)"
            + " values(?,?,?,cast(? as jsonb),?)",
        form, "m4-" + form, "M4", packageJson, CompatibilityProfile.CANONICAL_4_0_0.key());
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
