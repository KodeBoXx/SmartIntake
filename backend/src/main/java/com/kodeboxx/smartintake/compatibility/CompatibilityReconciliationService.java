package com.kodeboxx.smartintake.compatibility;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.UUID;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Records additive, digest-bound compatibility facts. Source rows are never
 * rewritten: a missing tenant or release is evidence to quarantine, not a link
 * the reconciler may infer.
 */
@Component
public class CompatibilityReconciliationService implements ApplicationRunner {
  static final String LEGACY_READABLE = "LEGACY_READABLE";
  static final String QUARANTINED = "QUARANTINED";
  private final JdbcTemplate db;
  private final ObjectMapper json;
  private final LegacyDefinitionAdapter legacyDefinitions;
  private final RespondentSecretVerifier secretVerifier;

  public CompatibilityReconciliationService(JdbcTemplate db, ObjectMapper json,
      LegacyDefinitionAdapter legacyDefinitions, RespondentSecretVerifier secretVerifier) {
    this.db = db;
    this.json = json;
    this.legacyDefinitions = legacyDefinitions;
    this.secretVerifier = secretVerifier;
  }

  @Override
  public void run(ApplicationArguments arguments) {
    reconcile();
  }

  @Transactional
  public void reconcile() {
    reconcileForms();
    reconcileReleases();
    reconcileSessions();
    reconcileMutations();
    reconcileSubmissions();
  }

  private void reconcileForms() {
    db.query("select id,workspace_id,definition::text source from forms", rs -> {
      UUID id = rs.getObject("id", UUID.class);
      String source = rs.getString("source");
      Reconciliation result = classifyDefinition(source,
          rs.getObject("workspace_id") == null ? "TENANT_MISSING" : null);
      persist("FORM", id.toString(), result, source, Map.of("formId", id.toString()));
      applyProfile("forms", id, result.profileKey());
    });
  }

  private void reconcileReleases() {
    db.query("select r.id,r.package::text source,f.workspace_id from form_releases r join forms f on f.id=r.form_id", rs -> {
      UUID id = rs.getObject("id", UUID.class);
      String source = rs.getString("source");
      Reconciliation result = classifyDefinition(source,
          rs.getObject("workspace_id") == null ? "TENANT_MISSING" : null);
      persist("RELEASE", id.toString(), result, source, Map.of("releaseId", id.toString()));
      applyProfile("form_releases", id, result.profileKey());
    });
  }

  private void reconcileSessions() {
    db.query("select s.id,s.answers::text source,s.respondent_token,s.release_id,f.workspace_id "
        + "from sessions s left join form_releases r on r.id=s.release_id left join forms f on f.id=r.form_id", rs -> {
      UUID id = rs.getObject("id", UUID.class);
      UUID token = rs.getObject("respondent_token", UUID.class);
      String source = rs.getString("source");
      String reason = rs.getObject("release_id") == null ? "RELEASE_MISSING"
          : rs.getObject("workspace_id") == null ? "TENANT_MISSING" : null;
      Reconciliation result = new Reconciliation(
          reason == null ? LEGACY_READABLE : QUARANTINED,
          CompatibilityProfile.LEGACY_PROTOTYPE.key(), reason);
      persist("SESSION", id.toString(), result, source, Map.of("sessionId", id.toString()));
      applyProfile("sessions", id, result.profileKey());
      if (token != null) {
        db.update("update sessions set respondent_secret_sha256=? where id=? and respondent_secret_sha256 is distinct from ?",
            secretVerifier.digest(token), id, secretVerifier.digest(token));
      }
    });
  }

  private void reconcileMutations() {
    db.query("select m.session_id,m.client_mutation_id,m.response::text source,s.release_id,f.workspace_id "
        + "from session_mutations m join sessions s on s.id=m.session_id left join form_releases r on r.id=s.release_id left join forms f on f.id=r.form_id", rs -> {
      String key = rs.getObject("session_id", UUID.class) + ":" + rs.getObject("client_mutation_id", UUID.class);
      String reason = rs.getObject("release_id") == null ? "RELEASE_MISSING"
          : rs.getObject("workspace_id") == null ? "TENANT_MISSING" : null;
      persist("SESSION_MUTATION", key, stateForRelationship(reason), rs.getString("source"), Map.of("mutationKey", key));
    });
  }

  private void reconcileSubmissions() {
    db.query("select s.id,s.envelope::text source,se.release_id,f.workspace_id from submissions s "
        + "join sessions se on se.id=s.session_id left join form_releases r on r.id=se.release_id left join forms f on f.id=r.form_id", rs -> {
      UUID id = rs.getObject("id", UUID.class);
      String reason = rs.getObject("release_id") == null ? "RELEASE_MISSING"
          : rs.getObject("workspace_id") == null ? "TENANT_MISSING" : null;
      persist("SUBMISSION", id.toString(), stateForRelationship(reason), rs.getString("source"), Map.of("submissionId", id.toString()));
    });
  }

  private Reconciliation classifyDefinition(String source, String relationshipReason) {
    if (relationshipReason != null) {
      return new Reconciliation(QUARANTINED, CompatibilityProfile.LEGACY_PROTOTYPE.key(), relationshipReason);
    }
    try {
      JsonNode parsed = json.readTree(source);
      if (legacyDefinitions.adapt(parsed).isPresent()) {
        return new Reconciliation(LEGACY_READABLE, CompatibilityProfile.LEGACY_PROTOTYPE.key(), null);
      }
    } catch (Exception ignored) {
      // Stored jsonb should parse, but unsupported bytes remain quarantined if it does not.
    }
    return new Reconciliation(QUARANTINED, null, "UNSUPPORTED_DEFINITION_SHAPE");
  }

  private Reconciliation stateForRelationship(String reason) {
    return new Reconciliation(reason == null ? LEGACY_READABLE : QUARANTINED,
        CompatibilityProfile.LEGACY_PROTOTYPE.key(), reason);
  }

  private void persist(String type, String key, Reconciliation result, String source, Map<String, String> evidence) {
    String digest = RespondentSecretVerifier.sha256(source);
    db.update("insert into record_migration_state(record_type,record_key,profile_key,source_digest,state,reason_code) "
            + "values(?,?,?,?,?,?) on conflict(record_type,record_key) do update set profile_key=excluded.profile_key, "
            + "source_digest=excluded.source_digest,state=excluded.state,reason_code=excluded.reason_code, "
            + "attempt_count=record_migration_state.attempt_count+1,reconciled_at=now() "
            + "where record_migration_state.profile_key is distinct from excluded.profile_key "
            + "or record_migration_state.source_digest is distinct from excluded.source_digest "
            + "or record_migration_state.state is distinct from excluded.state "
            + "or record_migration_state.reason_code is distinct from excluded.reason_code",
        type, key, result.profileKey(), digest, result.state(), result.reason());
    if (QUARANTINED.equals(result.state())) {
      String payload;
      try {
        payload = json.writeValueAsString(evidence);
      } catch (Exception exception) {
        throw new IllegalStateException("Cannot serialize quarantine evidence", exception);
      }
      db.update("insert into compatibility_quarantine_evidence(record_type,record_key,source_digest,reason_code,evidence) "
              + "values(?,?,?,?,cast(? as jsonb)) on conflict(record_type,record_key) do update set "
              + "source_digest=excluded.source_digest,reason_code=excluded.reason_code,evidence=excluded.evidence,last_observed_at=now() "
              + "where compatibility_quarantine_evidence.source_digest is distinct from excluded.source_digest "
              + "or compatibility_quarantine_evidence.reason_code is distinct from excluded.reason_code "
              + "or compatibility_quarantine_evidence.evidence is distinct from excluded.evidence",
          type, key, digest, result.reason(), payload);
    }
  }

  private void applyProfile(String table, UUID id, String profileKey) {
    if (profileKey != null) {
      db.update("update " + table + " set compatibility_profile_key=? where id=? and compatibility_profile_key is distinct from ?",
          profileKey, id, profileKey);
    }
  }

  private record Reconciliation(String state, String profileKey, String reason) { }
}
