package com.kodeboxx.smartintake;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kodeboxx.smartintake.compatibility.CompatibilityReconciliationService;
import com.kodeboxx.smartintake.compatibility.LegacyDefinitionAdapter;
import com.kodeboxx.smartintake.compatibility.RespondentSecretVerifier;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest
class DatabaseCompatibilityIntegrationTests {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Map<String, String> V1_TO_V4_SHA256 = Map.of(
      "V1__smart_intake.sql", "da622444bfe419c93f5276af76d9a3c5063711d35e4fc2e1d6e86eab6566f1e2",
      "V2__identity_workspaces_and_release_binding.sql", "b1025c6cc1e3829ae4b1bc0375964775fe4ce69ee9dbd977e6fd576117b72f8b",
      "V3__respondent_session_secret.sql", "cfb30d4fbddab1bff009d1901956803871bdcdc7858f881dcadc2390fc6b55d1",
      "V4__session_mutation_replay.sql", "d535f190c37efdc29f74b51815cdfad8e1f525fddbea27fb3e805e5c0cf1754f");

  @Autowired JdbcTemplate db;
  @Autowired CompatibilityReconciliationService reconciliation;
  @Autowired LegacyDefinitionAdapter legacyDefinitions;
  @Autowired RespondentSecretVerifier secretVerifier;

  @Test void preserves_v1_to_v4_migration_bytes() throws Exception {
    for (var expected : V1_TO_V4_SHA256.entrySet()) {
      try (InputStream input = getClass().getClassLoader().getResourceAsStream("db/migration/" + expected.getKey())) {
        assertTrue(input != null, expected.getKey());
        assertEquals(expected.getValue(), HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(input.readAllBytes())));
      }
    }
  }

  @Test void recognizes_only_the_read_only_legacy_prototype_shape() throws Exception {
    var legacy = JSON.readTree("{\"contractVersion\":\"4.0.0\",\"pages\":[]}");
    assertEquals("legacy-prototype", legacyDefinitions.adapt(legacy).orElseThrow().profile().key());
    assertTrue(legacyDefinitions.adapt(JSON.readTree("{\"contractVersion\":\"4.0.0\"}")).isEmpty());
  }

  @Test void reconciles_without_guessing_and_remains_digest_bound_across_restart_invocation() throws Exception {
    UUID form = UUID.randomUUID();
    UUID release = UUID.randomUUID();
    UUID usableSession = UUID.randomUUID();
    UUID tenantlessForm = UUID.randomUUID();
    UUID tenantlessRelease = UUID.randomUUID();
    UUID releaseLessSession = UUID.randomUUID();
    UUID usableToken = UUID.randomUUID();
    UUID releaseLessToken = UUID.randomUUID();
    UUID account = UUID.randomUUID();
    UUID organization = UUID.randomUUID();
    UUID workspace = UUID.randomUUID();
    String workspaceKey = "compat-" + account;
    String definition = "{\"contractVersion\":\"4.0.0\",\"pages\":[]}";

    db.update("insert into accounts(id,email,password_hash) values(?,?,?)", account, account + "@example.test", "hash");
    db.update("insert into organizations(id,name) values(?,?)", organization, "Compatibility test");
    db.update("insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?)", workspace, organization, workspaceKey, "Compatibility test");
    db.update("insert into forms(id,workspace_id,form_key,title,definition) values(?,?,?,?,cast(? as jsonb))", form, workspace, "compat-" + form, "Usable legacy", definition);
    db.update("insert into form_releases(id,form_id,version,package) values(?,?,1,cast(? as jsonb))", release, form, definition);
    db.update("insert into sessions(id,form_id,release_id,respondent_token,answers) values(?,?,?,?,cast(? as jsonb))", usableSession, form, release, usableToken, "{\"answer\":\"kept\"}");
    db.update("insert into session_mutations(session_id,client_mutation_id,accepted_revision,response) values(?,?,1,cast(? as jsonb))", usableSession, UUID.randomUUID(), "{\"acceptedRevision\":1}");
    db.update("insert into submissions(id,form_id,session_id,envelope) values(?,?,?,cast(? as jsonb))", UUID.randomUUID(), form, usableSession, "{\"kept\":true}");
    db.update("insert into forms(id,form_key,title,definition) values(?,?,?,cast(? as jsonb))", tenantlessForm, "compat-tenantless-" + tenantlessForm, "Tenantless", definition);
    db.update("insert into form_releases(id,form_id,version,package) values(?,?,1,cast(? as jsonb))", tenantlessRelease, tenantlessForm, definition);
    db.update("insert into sessions(id,form_id,respondent_token,answers) values(?,?,?,cast(? as jsonb))", releaseLessSession, form, releaseLessToken, "{\"answer\":\"unlinked\"}");

    reconciliation.reconcile();
    String formState = db.queryForObject("select state from record_migration_state where record_type='FORM' and record_key=?", String.class, form.toString());
    String tenantlessState = db.queryForObject("select state from record_migration_state where record_type='FORM' and record_key=?", String.class, tenantlessForm.toString());
    String sessionState = db.queryForObject("select state from record_migration_state where record_type='SESSION' and record_key=?", String.class, usableSession.toString());
    String releaseLessState = db.queryForObject("select state from record_migration_state where record_type='SESSION' and record_key=?", String.class, releaseLessSession.toString());
    int firstAttempts = db.queryForObject("select attempt_count from record_migration_state where record_type='SESSION' and record_key=?", Integer.class, usableSession.toString());
    String firstSourceDigest = db.queryForObject("select source_digest from record_migration_state where record_type='SESSION' and record_key=?", String.class, usableSession.toString());
    String storedToken = db.queryForObject("select respondent_token::text from sessions where id=?", String.class, usableSession);
    String secretDigest = db.queryForObject("select respondent_secret_sha256 from sessions where id=?", String.class, usableSession);
    String legacySecretDigest = db.queryForObject("select respondent_secret_sha256 from sessions where id=?", String.class, releaseLessSession);

    assertEquals("LEGACY_READABLE", formState);
    assertEquals("LEGACY_READABLE", sessionState);
    assertEquals("QUARANTINED", tenantlessState);
    assertEquals("QUARANTINED", releaseLessState);
    assertEquals(usableToken.toString(), storedToken);
    assertEquals(secretVerifier.digest(usableToken), secretDigest);
    assertNotEquals(usableToken.toString(), secretDigest);
    assertEquals(secretVerifier.digest(releaseLessToken), legacySecretDigest);
    assertEquals("TENANT_MISSING", db.queryForObject("select reason_code from compatibility_quarantine_evidence where record_type='FORM' and record_key=?", String.class, tenantlessForm.toString()));
    assertEquals("RELEASE_MISSING", db.queryForObject("select reason_code from compatibility_quarantine_evidence where record_type='SESSION' and record_key=?", String.class, releaseLessSession.toString()));

    reconciliation.reconcile();
    assertEquals(firstAttempts, db.queryForObject("select attempt_count from record_migration_state where record_type='SESSION' and record_key=?", Integer.class, usableSession.toString()));
    assertEquals(firstSourceDigest, db.queryForObject("select source_digest from record_migration_state where record_type='SESSION' and record_key=?", String.class, usableSession.toString()));
    assertStoredJson(definition, db.queryForObject("select definition::text from forms where id=?", String.class, form));
    assertStoredJson(definition, db.queryForObject("select package::text from form_releases where id=?", String.class, release));
    assertStoredJson("{\"answer\":\"kept\"}", db.queryForObject("select answers::text from sessions where id=?", String.class, usableSession));
    assertStoredJson("{\"acceptedRevision\":1}", db.queryForObject("select response::text from session_mutations where session_id=? limit 1", String.class, usableSession));
    assertStoredJson("{\"kept\":true}", db.queryForObject("select envelope::text from submissions where session_id=? limit 1", String.class, usableSession));
  }

  private static void assertStoredJson(String expected, String persisted) throws Exception {
    JsonNode expectedTree = JSON.readTree(expected);
    JsonNode persistedTree = JSON.readTree(persisted);
    assertEquals(expectedTree, persistedTree);
  }
}
