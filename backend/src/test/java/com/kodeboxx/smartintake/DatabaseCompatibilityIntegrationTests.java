package com.kodeboxx.smartintake;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kodeboxx.smartintake.application.IntakeApplicationService;
import com.kodeboxx.smartintake.compatibility.CompatibilityReconciliationService;
import com.kodeboxx.smartintake.compatibility.LegacyDefinitionAdapter;
import com.kodeboxx.smartintake.compatibility.RespondentSecretVerifier;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

@ActiveProfiles("test")
@SpringBootTest
class DatabaseCompatibilityIntegrationTests {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Map<String, String> V1_TO_V4_SHA256 =
      Map.of(
          "V1__smart_intake.sql",
              "da622444bfe419c93f5276af76d9a3c5063711d35e4fc2e1d6e86eab6566f1e2",
          "V2__identity_workspaces_and_release_binding.sql",
              "b1025c6cc1e3829ae4b1bc0375964775fe4ce69ee9dbd977e6fd576117b72f8b",
          "V3__respondent_session_secret.sql",
              "cfb30d4fbddab1bff009d1901956803871bdcdc7858f881dcadc2390fc6b55d1",
          "V4__session_mutation_replay.sql",
              "d535f190c37efdc29f74b51815cdfad8e1f525fddbea27fb3e805e5c0cf1754f");
  private static final List<FlywayHistory> ROLLBACK_FLYWAY_ALLOWLIST =
      List.of(
          new FlywayHistory("1", "SQL", "V1__smart_intake.sql", 1285295916),
          new FlywayHistory(
              "2", "SQL", "V2__identity_workspaces_and_release_binding.sql", -906896927),
          new FlywayHistory("3", "SQL", "V3__respondent_session_secret.sql", -549079748),
          new FlywayHistory("4", "SQL", "V4__session_mutation_replay.sql", -758059602),
          new FlywayHistory(
              "5", "SQL", "V5__compatibility_profiles_and_reconciliation_state.sql", 125753238),
          new FlywayHistory("6", "SQL", "V6__compatibility_reconciliation_indexes.sql", -848544773),
      new FlywayHistory(
              "7", "SQL", "V7__m1_current_profile_and_submission_uniqueness.sql", -648692813),
          new FlywayHistory(
              "8", "SQL", "V8__freeze_expression_session_context.sql", 874801699),
          new FlywayHistory(
              "9", "SQL", "V9__default_frozen_session_context.sql", 1901026173),
          new FlywayHistory(
              "10", "SQL", "V10__bind_session_mutation_request_digest.sql", 1365084057),
          new FlywayHistory("11", "SQL", "V11__m4_compatibility_runtime.sql", 1780789261),
          new FlywayHistory("12", "SQL", "V12__submission_attempt_review_evidence.sql", -1868713494),
          new FlywayHistory("13", "SQL", "V13__pinned_runtime_manifests.sql", -1265314321),
          new FlywayHistory("14", "SQL", "V14__staff_identity_sessions.sql", 724788122),
          new FlywayHistory("15", "SQL", "V15__identity_lifecycle_tenant_administration.sql", -2047153491),
          new FlywayHistory("16", "SQL", "V16__catalog_administration.sql", -2129090709),
          new FlywayHistory("17", "SQL", "V17__pending_organization_owner_activation.sql", -1184501692),
          new FlywayHistory("18", "SQL", "V18__widen_organization_lifecycle_state.sql", 1138518176),
          new FlywayHistory("19", "SQL", "V19__m7_visual_authoring.sql", 845506169),
          new FlywayHistory("20", "SQL", "V20__m7_authoring_theme_locks.sql", 578832989),
          new FlywayHistory("21", "SQL", "V21__m7_import_policy_binding.sql", 1785856019),
          new FlywayHistory("22", "SQL", "V22__m7_locale_review_governance.sql", -1479797992),
          new FlywayHistory("23", "SQL", "V23__m7_locale_review_package_binding.sql", -1415859726),
          new FlywayHistory("24", "SQL", "V24__m7_locale_review_package_hash_length.sql", -31656550),
          new FlywayHistory("25", "SQL", "V25__m7_speech_quota_controls.sql", -1822548525),
          new FlywayHistory("26", "SQL", "V26__m7_history_invalid_draft_acceptance.sql", 517151081),
          new FlywayHistory("27", "SQL", "V27__m8_governed_publication_sharing_outbox.sql", 1150234132),
          new FlywayHistory("28", "SQL", "V28__m8_governed_publication_idempotency.sql", -1451223491),
          new FlywayHistory("29", "SQL", "V29__m8_channel_submission_caps_and_selection.sql", 1794656124),
          new FlywayHistory("30", "SQL", "V30__m8_iframe_bootstrap.sql", 1373360594),
          new FlywayHistory("31", "SQL", "V31__m8_receipt_capabilities.sql", 1418682170),
          new FlywayHistory("32", "SQL", "V32__m8_single_active_release.sql", 1894983600));

  @Autowired JdbcTemplate db;
  @Autowired CompatibilityReconciliationService reconciliation;
  @Autowired LegacyDefinitionAdapter legacyDefinitions;
  @Autowired RespondentSecretVerifier secretVerifier;
  @Autowired IntakeApplicationService intake;

  @Test
  void preserves_v1_to_v4_migration_bytes() throws Exception {
    for (var expected : V1_TO_V4_SHA256.entrySet()) {
      try (InputStream input =
          getClass().getClassLoader().getResourceAsStream("db/migration/" + expected.getKey())) {
        assertTrue(input != null, expected.getKey());
        assertEquals(
            expected.getValue(),
            HexFormat.of()
                .formatHex(MessageDigest.getInstance("SHA-256").digest(input.readAllBytes())));
      }
    }
  }

  @Test
  void rollback_preflight_allowlist_matches_successful_flyway_history() {
    assertEquals(
        ROLLBACK_FLYWAY_ALLOWLIST,
        db.query(
            "select version,type,script,checksum from flyway_schema_history where success"
                + " order by installed_rank",
            (rs, rowNum) ->
                new FlywayHistory(
                    rs.getString("version"),
                    rs.getString("type"),
                    rs.getString("script"),
                    rs.getInt("checksum"))));
  }

  @Test
  void v11_registers_writable_canonical_profile_and_preserves_opaque_mutation_keys() {
    assertEquals(
        List.of("canonical-4.0.0", "4.0.0", false, true),
        db.queryForObject(
            "select profile_key,contract_version,read_only,new_write_allowed from compatibility_profiles"
                + " where profile_key='canonical-4.0.0'",
            (rs, row) ->
                List.of(
                    rs.getString("profile_key"),
                    rs.getString("contract_version"),
                    rs.getBoolean("read_only"),
                    rs.getBoolean("new_write_allowed"))));
    assertEquals(
        "jsonb",
        db.queryForObject(
            "select data_type from information_schema.columns where table_name='sessions' and"
                + " column_name='runtime_state'",
            String.class));
    assertEquals(
        "character varying",
        db.queryForObject(
            "select data_type from information_schema.columns where table_name='session_mutations'"
                + " and column_name='client_mutation_id'",
            String.class));
  }

  @Test
  void recognizes_only_the_read_only_legacy_prototype_shape() throws Exception {
    var legacy = JSON.readTree(validDefinition());
    assertEquals("legacy-prototype", legacyDefinitions.adapt(legacy).orElseThrow().profile().key());
    assertTrue(legacyDefinitions.adapt(JSON.readTree("{\"contractVersion\":\"4.0.0\"}")).isEmpty());
    assertTrue(
        legacyDefinitions
            .adapt(JSON.readTree("{\"contractVersion\":\"4.0.0\",\"pages\":[{\"fields\":[]}] }"))
            .isEmpty());
    assertTrue(
        legacyDefinitions
            .adapt(
                JSON.readTree(
                    "{\"contractVersion\":\"4.0.0\",\"formKey\":\"legacy\",\"title\":\"Legacy\",\"pages\":[{\"id\":\"page\",\"title\":\"Page\",\"fields\":[{\"id\":\"name\",\"type\":\"text\"}]}]}"))
            .isEmpty());
    assertTrue(
        legacyDefinitions
            .adapt(
                JSON.readTree(
                    "{\"contractVersion\":\"4.0.0\",\"formKey\":\"legacy\",\"title\":\"Legacy\",\"pages\":[{\"id\":\"page\",\"title\":\"Page\",\"fields\":[{\"id\":\"choice\",\"type\":\"choice\",\"label\":\"Choice\",\"options\":[{\"id\":\"yes\"}]}]}]}"))
            .isEmpty());
  }

  @Test
  void reconciles_without_guessing_and_remains_digest_bound_across_restart_invocation()
      throws Exception {
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
    String definition = validDefinition();

    db.update(
        "insert into accounts(id,email,password_hash) values(?,?,?)",
        account,
        account + "@example.test",
        "hash");
    db.update("insert into organizations(id,name) values(?,?)", organization, "Compatibility test");
    db.update(
        "insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?)",
        workspace,
        organization,
        workspaceKey,
        "Compatibility test");
    db.update(
        "insert into forms(id,workspace_id,form_key,title,definition) values(?,?,?,?,cast(? as"
            + " jsonb))",
        form,
        workspace,
        "compat-" + form,
        "Usable legacy",
        definition);
    db.update(
        "insert into form_releases(id,form_id,version,package) values(?,?,1,cast(? as jsonb))",
        release,
        form,
        definition);
    db.update(
        "insert into sessions(id,form_id,release_id,respondent_token,answers) values(?,?,?,?,cast(?"
            + " as jsonb))",
        usableSession,
        form,
        release,
        usableToken,
        "{\"answer\":\"kept\"}");
    db.update(
        "insert into session_mutations(session_id,client_mutation_id,accepted_revision,response)"
            + " values(?,?,1,cast(? as jsonb))",
        usableSession,
        UUID.randomUUID(),
        "{\"acceptedRevision\":1}");
    db.update(
        "insert into submissions(id,form_id,session_id,envelope) values(?,?,?,cast(? as jsonb))",
        UUID.randomUUID(),
        form,
        usableSession,
        "{\"kept\":true}");
    db.update(
        "insert into forms(id,form_key,title,definition) values(?,?,?,cast(? as jsonb))",
        tenantlessForm,
        "compat-tenantless-" + tenantlessForm,
        "Tenantless",
        definition);
    db.update(
        "insert into form_releases(id,form_id,version,package) values(?,?,1,cast(? as jsonb))",
        tenantlessRelease,
        tenantlessForm,
        definition);
    db.update(
        "insert into sessions(id,form_id,respondent_token,answers) values(?,?,?,cast(? as jsonb))",
        releaseLessSession,
        form,
        releaseLessToken,
        "{\"answer\":\"unlinked\"}");

    reconciliation.reconcile();
    String formState =
        db.queryForObject(
            "select state from record_migration_state where record_type='FORM' and record_key=?",
            String.class,
            form.toString());
    String tenantlessState =
        db.queryForObject(
            "select state from record_migration_state where record_type='FORM' and record_key=?",
            String.class,
            tenantlessForm.toString());
    String sessionState =
        db.queryForObject(
            "select state from record_migration_state where record_type='SESSION' and record_key=?",
            String.class,
            usableSession.toString());
    String releaseLessState =
        db.queryForObject(
            "select state from record_migration_state where record_type='SESSION' and record_key=?",
            String.class,
            releaseLessSession.toString());
    int firstAttempts =
        db.queryForObject(
            "select attempt_count from record_migration_state where record_type='SESSION' and"
                + " record_key=?",
            Integer.class,
            usableSession.toString());
    String firstSourceDigest =
        db.queryForObject(
            "select source_digest from record_migration_state where record_type='SESSION' and"
                + " record_key=?",
            String.class,
            usableSession.toString());
    String storedToken =
        db.queryForObject(
            "select respondent_token::text from sessions where id=?", String.class, usableSession);
    String secretDigest =
        db.queryForObject(
            "select respondent_secret_sha256 from sessions where id=?",
            String.class,
            usableSession);
    String legacySecretDigest =
        db.queryForObject(
            "select respondent_secret_sha256 from sessions where id=?",
            String.class,
            releaseLessSession);

    assertEquals("LEGACY_READABLE", formState);
    assertEquals("LEGACY_READABLE", sessionState);
    assertEquals("QUARANTINED", tenantlessState);
    assertEquals("QUARANTINED", releaseLessState);
    assertEquals(usableToken.toString(), storedToken);
    assertNull(secretDigest);
    assertNull(legacySecretDigest);
    assertEquals(
        "TENANT_MISSING",
        db.queryForObject(
            "select reason_code from compatibility_quarantine_evidence where record_type='FORM' and"
                + " record_key=?",
            String.class,
            tenantlessForm.toString()));
    assertEquals(
        "RELEASE_MISSING",
        db.queryForObject(
            "select reason_code from compatibility_quarantine_evidence where record_type='SESSION'"
                + " and record_key=?",
            String.class,
            releaseLessSession.toString()));
    assertEquals(
        "QUARANTINED",
        db.queryForObject(
            "select state from record_migration_state where record_type='RELEASE' and record_key=?",
            String.class,
            tenantlessRelease.toString()));
    assertTrue(
        db.queryForObject(
            "select target_digest is not null from record_migration_state where"
                + " record_type='SESSION' and record_key=?",
            Boolean.class,
            usableSession.toString()));

    reconciliation.reconcile();
    assertEquals(
        firstAttempts + 1,
        db.queryForObject(
            "select attempt_count from record_migration_state where record_type='SESSION' and"
                + " record_key=?",
            Integer.class,
            usableSession.toString()));
    assertNotEquals(
        firstSourceDigest,
        db.queryForObject(
            "select source_digest from record_migration_state where record_type='SESSION' and"
                + " record_key=?",
            String.class,
            usableSession.toString()));
    int stableAttempts =
        db.queryForObject(
            "select attempt_count from record_migration_state where record_type='SESSION' and"
                + " record_key=?",
            Integer.class,
            usableSession.toString());
    String stableSourceDigest =
        db.queryForObject(
            "select source_digest from record_migration_state where record_type='SESSION' and"
                + " record_key=?",
            String.class,
            usableSession.toString());
    reconciliation.reconcile();
    assertEquals(
        stableAttempts,
        db.queryForObject(
            "select attempt_count from record_migration_state where record_type='SESSION' and"
                + " record_key=?",
            Integer.class,
            usableSession.toString()));
    assertEquals(
        stableSourceDigest,
        db.queryForObject(
            "select source_digest from record_migration_state where record_type='SESSION' and"
                + " record_key=?",
            String.class,
            usableSession.toString()));
    assertStoredJson(
        definition,
        db.queryForObject("select definition::text from forms where id=?", String.class, form));
    assertStoredJson(
        definition,
        db.queryForObject(
            "select package::text from form_releases where id=?", String.class, release));
    assertStoredJson(
        "{\"answer\":\"kept\"}",
        db.queryForObject(
            "select answers::text from sessions where id=?", String.class, usableSession));
    assertStoredJson(
        "{\"acceptedRevision\":1}",
        db.queryForObject(
            "select response::text from session_mutations where session_id=? limit 1",
            String.class,
            usableSession));
    assertStoredJson(
        "{\"kept\":true}",
        db.queryForObject(
            "select envelope::text from submissions where session_id=? limit 1",
            String.class,
            usableSession));

    assertTrue(intake.session(usableSession, usableToken.toString()).containsKey("definition"));
    secretDigest =
        db.queryForObject(
            "select respondent_secret_sha256 from sessions where id=?",
            String.class,
            usableSession);
    assertEquals(secretVerifier.digest(usableToken), secretDigest);
    assertNotEquals(usableToken.toString(), secretDigest);

    UUID changedToken = UUID.randomUUID();
    db.update("update sessions set respondent_token=? where id=?", changedToken, usableSession);
    reconciliation.reconcile();
    assertNotEquals(
        stableSourceDigest,
        db.queryForObject(
            "select source_digest from record_migration_state where record_type='SESSION' and"
                + " record_key=?",
            String.class,
            usableSession.toString()));
    assertEquals(
        secretDigest,
        db.queryForObject(
            "select respondent_secret_sha256 from sessions where id=?",
            String.class,
            usableSession));
  }

  @Test
  void reconciles_across_actual_closed_and_restarted_application_contexts() throws Exception {
    UUID form = UUID.randomUUID();
    UUID release = UUID.randomUUID();
    UUID session = UUID.randomUUID();
    UUID token = UUID.randomUUID();
    UUID account = UUID.randomUUID();
    UUID organization = UUID.randomUUID();
    UUID workspace = UUID.randomUUID();
    String definition = validDefinition();
    db.update(
        "insert into accounts(id,email,password_hash) values(?,?,?)",
        account,
        account + "@example.test",
        "hash");
    db.update(
        "insert into organizations(id,name) values(?,?)", organization, "Restart organization");
    db.update(
        "insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?)",
        workspace,
        organization,
        "restart-" + workspace,
        "Restart workspace");
    db.update(
        "insert into forms(id,workspace_id,form_key,title,definition) values(?,?,?,?,cast(? as"
            + " jsonb))",
        form,
        workspace,
        "restart-" + form,
        "Restart evidence",
        definition);
    db.update(
        "insert into form_releases(id,form_id,version,package) values(?,?,1,cast(? as jsonb))",
        release,
        form,
        definition);
    db.update(
        "insert into sessions(id,form_id,release_id,respondent_token,answers) values(?,?,?,?,cast(?"
            + " as jsonb))",
        session,
        form,
        release,
        token,
        "{\"answer\":\"kept\"}");

    try (ConfigurableApplicationContext first = restartableContext()) {
      assertEquals(
          "LEGACY_READABLE",
          first
              .getBean(JdbcTemplate.class)
              .queryForObject(
                  "select state from record_migration_state where record_type='SESSION' and"
                      + " record_key=?",
                  String.class,
                  session.toString()));
      assertNull(
          first
              .getBean(JdbcTemplate.class)
              .queryForObject(
                  "select respondent_secret_sha256 from sessions where id=?",
                  String.class,
                  session));
    }
    try (ConfigurableApplicationContext second = restartableContext()) {
      assertEquals(
          2,
          second
              .getBean(JdbcTemplate.class)
              .queryForObject(
                  "select attempt_count from record_migration_state where record_type='SESSION' and"
                      + " record_key=?",
                  Integer.class,
                  session.toString()));
      IntakeApplicationService service = second.getBean(IntakeApplicationService.class);
      Map<String, Object> view = service.session(session, token.toString());
      assertEquals(Map.of("answer", "kept"), view.get("answers"));
      assertEquals(JSON.readTree(definition), JSON.valueToTree(view.get("definition")));
      assertEquals(
          secretVerifier.digest(token),
          second
              .getBean(JdbcTemplate.class)
              .queryForObject(
                  "select respondent_secret_sha256 from sessions where id=?",
                  String.class,
                  session));
    }
  }

  @Test
  void preserves_compiler_valid_canonical_records_and_runtime_state_across_restart()
      throws Exception {
    UUID form = UUID.randomUUID();
    UUID release = UUID.randomUUID();
    UUID session = UUID.randomUUID();
    UUID mutationSession = session;
    UUID submission = UUID.randomUUID();
    UUID token = UUID.randomUUID();
    UUID account = UUID.randomUUID();
    UUID organization = UUID.randomUUID();
    UUID workspace = UUID.randomUUID();
    String mutation = "mutation-01J2W5RFR3K24SFWDX2C0N9VW3";
    JsonNode canonicalNode =
        JSON.readTree(
            Files.readString(
                Path.of(
                    "../docs/contracts/smart-form-builder-lite/4.0.0/fixtures/package.positive.json")));
    ((com.fasterxml.jackson.databind.node.ArrayNode)
            canonicalNode.at("/flow/phases/0/pages/0/sections/0/nodes"))
        .add(JSON.readTree("{\"id\":\"review1\",\"kind\":\"review\",\"labelKey\":\"title\"}"));
    String canonical = JSON.writeValueAsString(canonicalNode);
    String runtimeState = "{\"hidden\":{\"retained\":true},\"retiredItemIds\":[\"item-01\"]}";

    db.update(
        "insert into accounts(id,email,password_hash) values(?,?,?)",
        account,
        account + "@example.test",
        "hash");
    db.update("insert into organizations(id,name) values(?,?)", organization, "Canonical restart");
    db.update(
        "insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?)",
        workspace,
        organization,
        "canonical-" + workspace,
        "Canonical restart");
    db.update(
        "insert into forms(id,workspace_id,form_key,title,definition,compatibility_profile_key)"
            + " values(?,?,?,?,cast(? as jsonb),?)",
        form,
        workspace,
        "canonical-" + form,
        "Canonical",
        canonical,
        "m1-current-prototype");
    db.update(
        "insert into form_releases(id,form_id,version,package,compatibility_profile_key)"
            + " values(?,?,1,cast(? as jsonb),?)",
        release,
        form,
        canonical,
        "m1-current-prototype");
    db.update(
        "insert into sessions(id,form_id,release_id,respondent_token,answers,runtime_state,"
            + " compatibility_profile_key) values(?,?,?,?,cast(? as jsonb),cast(? as jsonb),?)",
        session,
        form,
        release,
        token,
        "{\"name\":{\"status\":\"answered\",\"value\":\"Ada\"}}",
        runtimeState,
        "m1-current-prototype");
    db.update(
        "insert into session_mutations(session_id,client_mutation_id,accepted_revision,response)"
            + " values(?,?,1,cast(? as jsonb))",
        mutationSession,
        mutation,
        "{\"acceptedRevision\":1}");
    db.update(
        "insert into submissions(id,form_id,session_id,envelope) values(?,?,?,cast(? as jsonb))",
        submission,
        form,
        session,
        "{\"kept\":true}");

    try (ConfigurableApplicationContext first = restartableContext()) {
      JdbcTemplate restarted = first.getBean(JdbcTemplate.class);
      for (String table : List.of("forms", "form_releases", "sessions")) {
        UUID id = "forms".equals(table) ? form : "form_releases".equals(table) ? release : session;
        assertEquals(
            "canonical-4.0.0",
            restarted.queryForObject(
                "select compatibility_profile_key from " + table + " where id=?", String.class, id));
      }
      for (String recordType : List.of("FORM", "RELEASE", "SESSION", "SESSION_MUTATION", "SUBMISSION")) {
        String key = switch (recordType) {
          case "FORM" -> form.toString();
          case "RELEASE" -> release.toString();
          case "SESSION" -> session.toString();
          case "SESSION_MUTATION" -> session + ":" + mutation;
          default -> submission.toString();
        };
        assertEquals(
            "LEGACY_READABLE",
            restarted.queryForObject(
                "select state from record_migration_state where record_type=? and record_key=?",
                String.class,
                recordType,
                key));
      }
    }
    try (ConfigurableApplicationContext second = restartableContext()) {
      JdbcTemplate restarted = second.getBean(JdbcTemplate.class);
      assertStoredJson(
          canonical,
          restarted.queryForObject("select definition::text from forms where id=?", String.class, form));
      assertStoredJson(
          canonical,
          restarted.queryForObject(
              "select package::text from form_releases where id=?", String.class, release));
      assertStoredJson(
          runtimeState,
          restarted.queryForObject(
              "select runtime_state::text from sessions where id=?", String.class, session));
      assertEquals(
          mutation,
          restarted.queryForObject(
              "select client_mutation_id from session_mutations where session_id=?", String.class, session));
      assertStoredJson(
          "{\"acceptedRevision\":1}",
          restarted.queryForObject(
              "select response::text from session_mutations where session_id=?", String.class, session));
      assertStoredJson(
          "{\"kept\":true}",
          restarted.queryForObject(
              "select envelope::text from submissions where id=?", String.class, submission));
      assertEquals(
          "canonical-4.0.0",
          restarted.queryForObject(
              "select compatibility_profile_key from sessions where id=?", String.class, session));
    }
  }

  @Test
  void quarantines_invalid_current_profiles_and_cascades_to_sessions_and_children() {
    UUID account = UUID.randomUUID();
    UUID organization = UUID.randomUUID();
    UUID workspace = UUID.randomUUID();
    UUID staff = UUID.randomUUID();
    UUID form = UUID.randomUUID();
    UUID release = UUID.randomUUID();
    UUID session = UUID.randomUUID();
    UUID mutation = UUID.randomUUID();
    UUID submission = UUID.randomUUID();
    String workspaceKey = "invalid-" + workspace;
    String malformed =
        "{\"contractVersion\":\"4.0.0\",\"formKey\":\"invalid\",\"title\":\"Invalid\",\"pages\":[{\"id\":\"page\",\"title\":\"Page\",\"fields\":[{\"id\":\"choice\",\"type\":\"choice\",\"label\":\"Choice\",\"options\":[{\"id\":\"yes\"}]}]}]}";
    db.update(
        "insert into accounts(id,email,password_hash) values(?,?,?)",
        account,
        account + "@example.test",
        "hash");
    db.update(
        "insert into organizations(id,name) values(?,?)", organization, "Invalid organization");
    db.update(
        "insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?)",
        workspace,
        organization,
        workspaceKey,
        "Invalid workspace");
    db.update("insert into memberships(account_id,workspace_id,role) values(?,?,?)", account, workspace, "PUBLISHER");
    db.update("insert into organization_memberships(account_id,organization_id,roles,membership_status) values(?,?,array['member'],'active')", account, organization);
    db.update(
        "insert into staff_sessions(token,account_id,expires_at) values(?,?,now()+interval '1"
            + " hour')",
        staff,
        account);
    db.update(
        "insert into forms(id,workspace_id,form_key,title,definition,compatibility_profile_key)"
            + " values(?,?,?,?,cast(? as jsonb),?)",
        form,
        workspace,
        "invalid-" + form,
        "Invalid",
        malformed,
        "m1-current-prototype");
    db.update(
        "insert into form_releases(id,form_id,version,package,compatibility_profile_key)"
            + " values(?,?,1,cast(? as jsonb),?)",
        release,
        form,
        malformed,
        "m1-current-prototype");
    db.update(
        "insert into"
            + " sessions(id,form_id,release_id,respondent_token,compatibility_profile_key,answers)"
            + " values(?,?,?,?,?,cast('{}' as jsonb))",
        session,
        form,
        release,
        UUID.randomUUID(),
        "m1-current-prototype");
    db.update(
        "insert into session_mutations(session_id,client_mutation_id,accepted_revision,response)"
            + " values(?,?,1,cast('{}' as jsonb))",
        session,
        mutation);
    db.update(
        "insert into submissions(id,form_id,session_id,envelope) values(?,?,?,cast('{}' as jsonb))",
        submission,
        form,
        session);

    reconciliation.reconcile();

    for (Map.Entry<String, String> record :
        Map.of(
                "FORM", form.toString(),
                "RELEASE", release.toString(),
                "SESSION", session.toString(),
                "SESSION_MUTATION", session + ":" + mutation,
                "SUBMISSION", submission.toString())
            .entrySet()) {
      assertEquals(
          "QUARANTINED",
          db.queryForObject(
              "select state from record_migration_state where record_type=? and record_key=?",
              String.class,
              record.getKey(),
              record.getValue()));
    }
    assertNull(
        db.queryForObject(
            "select compatibility_profile_key from forms where id=?", String.class, form));
    assertEquals(
        "UNSUPPORTED_DEFINITION_SHAPE",
        db.queryForObject(
            "select reason_code from record_migration_state where record_type='FORM' and"
                + " record_key=?",
            String.class,
            form.toString()));
    assertEquals(
        422,
        assertThrows(
                ResponseStatusException.class,
                () -> intake.publish(workspaceKey, form, staff.toString()))
            .getStatusCode()
            .value());
    assertEquals(
        404,
        assertThrows(
                ResponseStatusException.class,
                () -> intake.start(form, new IntakeApplicationService.StartSession("en", "UTC")))
            .getStatusCode()
            .value());
  }

  @Test
  void quarantines_cross_workspace_session_release_and_submission_form_mismatches() {
    UUID account = UUID.randomUUID();
    UUID organization = UUID.randomUUID();
    UUID workspaceA = UUID.randomUUID();
    UUID workspaceB = UUID.randomUUID();
    UUID formA = UUID.randomUUID();
    UUID formB = UUID.randomUUID();
    UUID releaseA = UUID.randomUUID();
    UUID releaseB = UUID.randomUUID();
    UUID session = UUID.randomUUID();
    UUID mutation = UUID.randomUUID();
    UUID submission = UUID.randomUUID();
    UUID submissionOnlySession = UUID.randomUUID();
    UUID submissionOnly = UUID.randomUUID();
    UUID visibleSession = UUID.randomUUID();
    UUID visibleSubmission = UUID.randomUUID();
    UUID staff = UUID.randomUUID();
    String definition = validDefinition();
    db.update(
        "insert into accounts(id,email,password_hash) values(?,?,?)",
        account,
        account + "@example.test",
        "hash");
    db.update(
        "insert into organizations(id,name) values(?,?)", organization, "Mismatch organization");
    db.update(
        "insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?)",
        workspaceA,
        organization,
        "mismatch-a-" + workspaceA,
        "A");
    db.update(
        "insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?)",
        workspaceB,
        organization,
        "mismatch-b-" + workspaceB,
        "B");
    for (UUID memberWorkspace : List.of(workspaceA, workspaceB))
      db.update("insert into memberships(account_id,workspace_id,role) values(?,?,?)", account, memberWorkspace, "RESPONSE_EXPORTER");
    db.update("insert into organization_memberships(account_id,organization_id,roles,membership_status) values(?,?,array['member'],'active')", account, organization);
    db.update(
        "insert into staff_sessions(token,account_id,expires_at) values(?,?,now()+interval '1"
            + " hour')",
        staff,
        account);
    db.update(
        "insert into forms(id,workspace_id,form_key,title,definition,compatibility_profile_key)"
            + " values(?,?,?,?,cast(? as jsonb),?)",
        formA,
        workspaceA,
        "mismatch-a-" + formA,
        "A",
        definition,
        "m1-current-prototype");
    db.update(
        "insert into forms(id,workspace_id,form_key,title,definition,compatibility_profile_key)"
            + " values(?,?,?,?,cast(? as jsonb),?)",
        formB,
        workspaceB,
        "mismatch-b-" + formB,
        "B",
        definition,
        "m1-current-prototype");
    db.update(
        "insert into form_releases(id,form_id,version,package,compatibility_profile_key)"
            + " values(?,?,1,cast(? as jsonb),?)",
        releaseA,
        formA,
        definition,
        "m1-current-prototype");
    db.update(
        "insert into form_releases(id,form_id,version,package,compatibility_profile_key)"
            + " values(?,?,1,cast(? as jsonb),?)",
        releaseB,
        formB,
        definition,
        "m1-current-prototype");
    db.update(
        "insert into"
            + " sessions(id,form_id,release_id,respondent_token,compatibility_profile_key,answers)"
            + " values(?,?,?,?,?,cast('{}' as jsonb))",
        session,
        formA,
        releaseB,
        UUID.randomUUID(),
        "m1-current-prototype");
    db.update(
        "insert into session_mutations(session_id,client_mutation_id,accepted_revision,response)"
            + " values(?,?,1,cast('{}' as jsonb))",
        session,
        mutation);
    db.update(
        "insert into submissions(id,form_id,session_id,envelope) values(?,?,?,cast('{}' as jsonb))",
        submission,
        formB,
        session);
    db.update(
        "insert into"
            + " sessions(id,form_id,release_id,respondent_token,compatibility_profile_key,answers)"
            + " values(?,?,?,?,?,cast('{}' as jsonb))",
        submissionOnlySession,
        formA,
        releaseA,
        UUID.randomUUID(),
        "m1-current-prototype");
    db.update(
        "insert into submissions(id,form_id,session_id,envelope) values(?,?,?,cast('{}' as jsonb))",
        submissionOnly,
        formB,
        submissionOnlySession);
    db.update(
        "insert into"
            + " sessions(id,form_id,release_id,respondent_token,compatibility_profile_key,answers)"
            + " values(?,?,?,?,?,cast('{}' as jsonb))",
        visibleSession,
        formA,
        releaseA,
        UUID.randomUUID(),
        "m1-current-prototype");
    db.update(
        "insert into submissions(id,form_id,session_id,envelope) values(?,?,?,cast(? as jsonb))",
        visibleSubmission,
        formA,
        visibleSession,
        "{\"visible\":true}");

    reconciliation.reconcile();

    assertEquals(
        "SESSION_FORM_RELEASE_FORM_MISMATCH",
        db.queryForObject(
            "select reason_code from record_migration_state where record_type='SESSION' and"
                + " record_key=?",
            String.class,
            session.toString()));
    for (Map.Entry<String, String> child :
        Map.of("SESSION_MUTATION", session + ":" + mutation, "SUBMISSION", submission.toString())
            .entrySet()) {
      assertEquals(
          "QUARANTINED",
          db.queryForObject(
              "select state from record_migration_state where record_type=? and record_key=?",
              String.class,
              child.getKey(),
              child.getValue()));
    }
    assertEquals(
        workspaceA.toString(),
        db.queryForObject(
            "select evidence->>'sessionWorkspaceId' from compatibility_quarantine_evidence where"
                + " record_type='SESSION' and record_key=?",
            String.class,
            session.toString()));
    assertEquals(
        workspaceB.toString(),
        db.queryForObject(
            "select evidence->>'releaseWorkspaceId' from compatibility_quarantine_evidence where"
                + " record_type='SESSION' and record_key=?",
            String.class,
            session.toString()));
    assertEquals(
        "SUBMISSION_FORM_SESSION_FORM_MISMATCH",
        db.queryForObject(
            "select reason_code from record_migration_state where record_type='SUBMISSION' and"
                + " record_key=?",
            String.class,
            submissionOnly.toString()));
    String workspaceKeyA = "mismatch-a-" + workspaceA;
    String workspaceKeyB = "mismatch-b-" + workspaceB;
    assertEquals(
        List.of(visibleSubmission.toString()),
        intake.submissions(workspaceKeyA, staff.toString()).stream()
            .map(row -> row.get("id"))
            .toList());
    assertEquals(
        Map.of("visible", true),
        intake.submission(workspaceKeyA, visibleSubmission, staff.toString()));
    assertEquals(
        List.of(Map.of("visible", true)), intake.jsonExport(workspaceKeyA, staff.toString()));
    String visibleCsv = intake.csv(workspaceKeyA, staff.toString());
    assertTrue(visibleCsv.contains(visibleSubmission.toString()), visibleCsv);
    assertFalse(visibleCsv.contains(submission.toString()), visibleCsv);
    assertFalse(visibleCsv.contains(submissionOnly.toString()), visibleCsv);
    for (UUID hidden : List.of(submission, submissionOnly)) {
      assertEquals(
          404,
          assertThrows(
                  ResponseStatusException.class,
                  () -> intake.submission(workspaceKeyB, hidden, staff.toString()))
              .getStatusCode()
              .value());
    }
    assertTrue(intake.submissions(workspaceKeyB, staff.toString()).isEmpty());
    assertTrue(intake.jsonExport(workspaceKeyB, staff.toString()).isEmpty());
    assertEquals(
        "submission_id,form_id,submitted_at,answers\n",
        intake.csv(workspaceKeyB, staff.toString()));
    String mutationDigest =
        db.queryForObject(
            "select source_digest from record_migration_state where record_type='SESSION_MUTATION'"
                + " and record_key=?",
            String.class,
            session + ":" + mutation);
    int attempts =
        db.queryForObject(
            "select attempt_count from record_migration_state where record_type='SESSION_MUTATION'"
                + " and record_key=?",
            Integer.class,
            session + ":" + mutation);
    db.update(
        "update session_mutations set accepted_revision=2 where session_id=? and"
            + " client_mutation_id=?",
        session,
        mutation.toString());
    reconciliation.reconcile();
    assertNotEquals(
        mutationDigest,
        db.queryForObject(
            "select source_digest from record_migration_state where record_type='SESSION_MUTATION'"
                + " and record_key=?",
            String.class,
            session + ":" + mutation));
    assertEquals(
        attempts + 1,
        db.queryForObject(
            "select attempt_count from record_migration_state where record_type='SESSION_MUTATION'"
                + " and record_key=?",
            Integer.class,
            session + ":" + mutation));

    String sessionDigest =
        db.queryForObject(
            "select source_digest from record_migration_state where record_type='SESSION' and"
                + " record_key=?",
            String.class,
            session.toString());
    String releaseDigest =
        db.queryForObject(
            "select source_digest from record_migration_state where record_type='RELEASE' and"
                + " record_key=?",
            String.class,
            releaseB.toString());
    int sessionAttempts =
        db.queryForObject(
            "select attempt_count from record_migration_state where record_type='SESSION' and"
                + " record_key=?",
            Integer.class,
            session.toString());
    int releaseAttempts =
        db.queryForObject(
            "select attempt_count from record_migration_state where record_type='RELEASE' and"
                + " record_key=?",
            Integer.class,
            releaseB.toString());
    db.update("update sessions set revision=revision+1 where id=?", session);
    db.update("update form_releases set version=version+1 where id=?", releaseB);
    reconciliation.reconcile();
    assertNotEquals(
        sessionDigest,
        db.queryForObject(
            "select source_digest from record_migration_state where record_type='SESSION' and"
                + " record_key=?",
            String.class,
            session.toString()));
    assertNotEquals(
        releaseDigest,
        db.queryForObject(
            "select source_digest from record_migration_state where record_type='RELEASE' and"
                + " record_key=?",
            String.class,
            releaseB.toString()));
    assertEquals(
        sessionAttempts + 1,
        db.queryForObject(
            "select attempt_count from record_migration_state where record_type='SESSION' and"
                + " record_key=?",
            Integer.class,
            session.toString()));
    assertEquals(
        releaseAttempts + 1,
        db.queryForObject(
            "select attempt_count from record_migration_state where record_type='RELEASE' and"
                + " record_key=?",
            Integer.class,
            releaseB.toString()));
  }

  private ConfigurableApplicationContext restartableContext() {
    return new SpringApplicationBuilder(SmartIntakeApplication.class)
        .web(WebApplicationType.NONE)
        .properties("spring.main.web-application-type=none")
        .run();
  }

  @Test
  void v14_adds_only_staff_identity_security_state() {
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from information_schema.tables where table_schema='public'"
                + " and table_name='identity_bootstrap_state'",
            Integer.class));
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from information_schema.tables where table_schema='public'"
                + " and table_name='login_csrf_challenges'",
            Integer.class));
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from information_schema.columns where table_name='staff_sessions'"
                + " and column_name='absolute_expires_at'",
            Integer.class));
  }

  @Test
  void v15_adds_tenant_identity_lifecycle_state() {
    for (String table : List.of("platform_roles", "organization_memberships", "identity_invitations", "identity_secret_actions",
        "administration_mutation_replays", "workspace_role_revisions")) {
      assertEquals(1, db.queryForObject("select count(*) from information_schema.tables where table_schema='public' and table_name=?", Integer.class, table));
    }
    for (String column : List.of("account_status", "activation_state", "temporary_password_expires_at", "revision")) {
      assertEquals(1, db.queryForObject("select count(*) from information_schema.columns where table_name='accounts' and column_name=?", Integer.class, column));
    }
    for (String table : List.of("organizations", "organization_memberships", "memberships")) {
      assertEquals(1, db.queryForObject("select count(*) from information_schema.columns where table_name=? and column_name='revision'", Integer.class, table));
    }
    assertEquals(1, db.queryForObject("select count(*) from information_schema.columns where table_name='staff_sessions' and column_name='setup_only'", Integer.class));
  }

  private static void assertStoredJson(String expected, String persisted) throws Exception {
    JsonNode expectedTree = JSON.readTree(expected);
    JsonNode persistedTree = JSON.readTree(persisted);
    assertEquals(expectedTree, persistedTree);
  }

  private static String validDefinition() {
    return "{\"contractVersion\":\"4.0.0\",\"formKey\":\"legacy\",\"title\":\"Legacy\",\"pages\":[{\"id\":\"page\",\"title\":\"Page\",\"fields\":[]}]}";
  }

  private record FlywayHistory(String version, String type, String script, int checksum) {}
}
