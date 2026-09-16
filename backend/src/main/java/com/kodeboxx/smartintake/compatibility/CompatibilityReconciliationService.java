package com.kodeboxx.smartintake.compatibility;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Records additive, digest-bound compatibility facts. Source rows are never rewritten: a missing
 * tenant or inconsistent relationship is evidence to quarantine, not a link the reconciler may
 * infer.
 */
@Component
public class CompatibilityReconciliationService implements ApplicationRunner {
  static final String LEGACY_READABLE = "LEGACY_READABLE";
  static final String QUARANTINED = "QUARANTINED";

  private final JdbcTemplate db;
  private final ObjectMapper json;
  private final LegacyDefinitionAdapter legacyDefinitions;
  private final TransactionTemplate transactions;

  public CompatibilityReconciliationService(
      JdbcTemplate db,
      ObjectMapper json,
      LegacyDefinitionAdapter legacyDefinitions,
      TransactionTemplate transactions) {
    this.db = db;
    this.json = json;
    this.legacyDefinitions = legacyDefinitions;
    this.transactions = transactions;
  }

  @Override
  public void run(ApplicationArguments arguments) {
    reconcile();
  }

  /** Executes in a real transaction even when invoked directly by ApplicationRunner. */
  public void reconcile() {
    transactions.executeWithoutResult(status -> reconcileInTransaction());
  }

  private void reconcileInTransaction() {
    reconcileForms();
    reconcileReleases();
    reconcileSessions();
    reconcileMutations();
    reconcileSubmissions();
  }

  private void reconcileForms() {
    db.query(
        "select id,workspace_id,definition::text source,compatibility_profile_key from forms",
        rs -> {
          UUID id = rs.getObject("id", UUID.class);
          UUID workspace = rs.getObject("workspace_id", UUID.class);
          Reconciliation result =
              classifyDefinition(
                  rs.getString("source"),
                  rs.getString("compatibility_profile_key"),
                  workspace == null ? "TENANT_MISSING" : null);
          applyProfile("forms", id, result.profileKey());
          persist(
              "FORM",
              id.toString(),
              result,
              digest(
                  rs.getString("source"),
                  "workspace=" + workspace,
                  "ownProfile=" + rs.getString("compatibility_profile_key")),
              Map.of("formId", id.toString(), "workspaceId", String.valueOf(workspace)));
        });
  }

  private void reconcileReleases() {
    db.query(
        "select r.id,r.form_id,r.version,r.package::text source,r.compatibility_profile_key"
            + " own_profile,f.workspace_id,f.compatibility_profile_key form_profile from"
            + " form_releases r join forms f on f.id=r.form_id",
        rs -> {
          UUID id = rs.getObject("id", UUID.class);
          UUID form = rs.getObject("form_id", UUID.class);
          UUID workspace = rs.getObject("workspace_id", UUID.class);
          String formProfile = rs.getString("form_profile");
          String reason =
              workspace == null ? "TENANT_MISSING" : quarantinedReason("FORM", form.toString());
          Reconciliation result =
              classifyDefinition(rs.getString("source"), rs.getString("own_profile"), reason);
          applyProfile("form_releases", id, result.profileKey());
          persist(
              "RELEASE",
              id.toString(),
              result,
              digest(
                  rs.getString("source"),
                  "form=" + form,
                  "workspace=" + workspace,
                  "version=" + rs.getInt("version"),
                  "ownProfile=" + rs.getString("own_profile"),
                  "formProfile=" + formProfile),
              Map.of(
                  "releaseId", id.toString(),
                  "formId", form.toString(),
                  "workspaceId", String.valueOf(workspace)));
        });
  }

  private void reconcileSessions() {
    db.query(
        "select s.id,s.form_id session_form_id,s.release_id,s.answers::text"
            + " source,s.respondent_token,s.respondent_secret_sha256,s.compatibility_profile_key"
            + " session_profile,s.revision,s.status,s.locale,s.expires_at::text"
            + " expires_at,r.form_id release_form_id,r.compatibility_profile_key"
            + " release_profile,sf.workspace_id session_workspace,rf.workspace_id release_workspace"
            + " from sessions s left join forms sf on sf.id=s.form_id left join form_releases r on"
            + " r.id=s.release_id left join forms rf on rf.id=r.form_id",
        rs -> {
          UUID id = rs.getObject("id", UUID.class);
          UUID sessionForm = rs.getObject("session_form_id", UUID.class);
          UUID release = rs.getObject("release_id", UUID.class);
          UUID releaseForm = rs.getObject("release_form_id", UUID.class);
          UUID sessionWorkspace = rs.getObject("session_workspace", UUID.class);
          UUID releaseWorkspace = rs.getObject("release_workspace", UUID.class);
          String reason =
              sessionRelationshipReason(
                  release, sessionForm, releaseForm, sessionWorkspace, releaseWorkspace);
          if (reason == null) {
            reason = quarantinedReason("RELEASE", release.toString());
          }
          Reconciliation result = stateForRelationship(rs.getString("release_profile"), reason);
          applyProfile("sessions", id, result.profileKey());
          persist(
              "SESSION",
              id.toString(),
              result,
              digest(
                  rs.getString("source"),
                  "sessionForm=" + sessionForm,
                  "release=" + release,
                  "releaseForm=" + releaseForm,
                  "sessionWorkspace=" + sessionWorkspace,
                  "releaseWorkspace=" + releaseWorkspace,
                  "ownProfile=" + rs.getString("session_profile"),
                  "releaseProfile=" + rs.getString("release_profile"),
                  "revision=" + rs.getLong("revision"),
                  "status=" + rs.getString("status"),
                  "locale=" + rs.getString("locale"),
                  "expiresAt=" + rs.getString("expires_at"),
                  "token=" + rs.getObject("respondent_token"),
                  "secretDigest=" + rs.getString("respondent_secret_sha256")),
              Map.of(
                  "sessionId", id.toString(),
                  "sessionFormId", String.valueOf(sessionForm),
                  "releaseId", String.valueOf(release),
                  "releaseFormId", String.valueOf(releaseForm),
                  "sessionWorkspaceId", String.valueOf(sessionWorkspace),
                  "releaseWorkspaceId", String.valueOf(releaseWorkspace)));
        });
  }

  private void reconcileMutations() {
    db.query(
        "select m.session_id,m.client_mutation_id,m.accepted_revision,m.response::text"
            + " source,s.form_id session_form_id,s.release_id,s.compatibility_profile_key"
            + " session_profile,r.form_id release_form_id,sf.workspace_id"
            + " session_workspace,rf.workspace_id release_workspace from session_mutations m join"
            + " sessions s on s.id=m.session_id left join form_releases r on r.id=s.release_id left"
            + " join forms sf on sf.id=s.form_id left join forms rf on rf.id=r.form_id",
        rs -> {
          UUID session = rs.getObject("session_id", UUID.class);
          UUID mutation = rs.getObject("client_mutation_id", UUID.class);
          String key = session + ":" + mutation;
          String reason = quarantinedReason("SESSION", session.toString());
          if (reason == null && rs.getObject("release_id") == null) {
            reason = "RELEASE_MISSING";
          }
          Reconciliation result = stateForRelationship(rs.getString("session_profile"), reason);
          persist(
              "SESSION_MUTATION",
              key,
              result,
              digest(
                  rs.getString("source"),
                  "session=" + session,
                  "mutation=" + mutation,
                  "sessionForm=" + rs.getObject("session_form_id"),
                  "release=" + rs.getObject("release_id"),
                  "releaseForm=" + rs.getObject("release_form_id"),
                  "sessionWorkspace=" + rs.getObject("session_workspace"),
                  "releaseWorkspace=" + rs.getObject("release_workspace"),
                  "sessionProfile=" + rs.getString("session_profile"),
                  "acceptedRevision=" + rs.getLong("accepted_revision")),
              Map.of(
                  "mutationKey", key,
                  "sessionId", session.toString(),
                  "sessionFormId", String.valueOf(rs.getObject("session_form_id")),
                  "releaseId", String.valueOf(rs.getObject("release_id")),
                  "releaseFormId", String.valueOf(rs.getObject("release_form_id")),
                  "sessionWorkspaceId", String.valueOf(rs.getObject("session_workspace")),
                  "releaseWorkspaceId", String.valueOf(rs.getObject("release_workspace"))));
        });
  }

  private void reconcileSubmissions() {
    db.query(
        "select sub.id,sub.form_id submission_form_id,sub.session_id,sub.envelope::text"
            + " source,se.form_id session_form_id,se.release_id,se.compatibility_profile_key"
            + " session_profile,submission_form.workspace_id"
            + " submission_workspace,session_form.workspace_id session_workspace,rel.form_id"
            + " release_form_id,release_form.workspace_id release_workspace from submissions sub"
            + " join sessions se on se.id=sub.session_id join forms submission_form on"
            + " submission_form.id=sub.form_id join forms session_form on"
            + " session_form.id=se.form_id left join form_releases rel on rel.id=se.release_id left"
            + " join forms release_form on release_form.id=rel.form_id",
        rs -> {
          UUID id = rs.getObject("id", UUID.class);
          UUID session = rs.getObject("session_id", UUID.class);
          UUID submissionForm = rs.getObject("submission_form_id", UUID.class);
          UUID sessionForm = rs.getObject("session_form_id", UUID.class);
          String reason = quarantinedReason("SESSION", session.toString());
          if (reason == null && !submissionForm.equals(sessionForm)) {
            reason = "SUBMISSION_FORM_SESSION_FORM_MISMATCH";
          }
          if (reason == null && rs.getObject("release_id") == null) {
            reason = "RELEASE_MISSING";
          }
          Reconciliation result = stateForRelationship(rs.getString("session_profile"), reason);
          persist(
              "SUBMISSION",
              id.toString(),
              result,
              digest(
                  rs.getString("source"),
                  "session=" + session,
                  "submissionForm=" + submissionForm,
                  "sessionForm=" + sessionForm,
                  "release=" + rs.getObject("release_id"),
                  "releaseForm=" + rs.getObject("release_form_id"),
                  "submissionWorkspace=" + rs.getObject("submission_workspace"),
                  "sessionWorkspace=" + rs.getObject("session_workspace"),
                  "releaseWorkspace=" + rs.getObject("release_workspace"),
                  "sessionProfile=" + rs.getString("session_profile")),
              Map.of(
                  "submissionId", id.toString(),
                  "sessionId", session.toString(),
                  "submissionFormId", submissionForm.toString(),
                  "sessionFormId", sessionForm.toString(),
                  "releaseId", String.valueOf(rs.getObject("release_id")),
                  "releaseFormId", String.valueOf(rs.getObject("release_form_id")),
                  "submissionWorkspaceId", String.valueOf(rs.getObject("submission_workspace")),
                  "sessionWorkspaceId", String.valueOf(rs.getObject("session_workspace")),
                  "releaseWorkspaceId", String.valueOf(rs.getObject("release_workspace"))));
        });
  }

  private Reconciliation classifyDefinition(
      String source, String profileKey, String relationshipReason) {
    try {
      JsonNode parsed = json.readTree(source);
      legacyDefinitions.validateCurrentLite(parsed);
      if (relationshipReason != null) {
        return new Reconciliation(QUARANTINED, null, relationshipReason);
      }
      String resolvedProfile =
          CompatibilityProfile.M1_CURRENT_PROTOTYPE.key().equals(profileKey)
              ? CompatibilityProfile.M1_CURRENT_PROTOTYPE.key()
              : CompatibilityProfile.LEGACY_PROTOTYPE.key();
      return new Reconciliation(LEGACY_READABLE, resolvedProfile, null);
    } catch (Exception ignored) {
      return new Reconciliation(QUARANTINED, null, "UNSUPPORTED_DEFINITION_SHAPE");
    }
  }

  private Reconciliation stateForRelationship(String profileKey, String reason) {
    if (reason != null) {
      return new Reconciliation(QUARANTINED, null, reason);
    }
    if (profileKey == null) {
      return new Reconciliation(QUARANTINED, null, "UNSUPPORTED_DEFINITION_SHAPE");
    }
    return new Reconciliation(LEGACY_READABLE, profileKey, null);
  }

  private String sessionRelationshipReason(
      UUID release,
      UUID sessionForm,
      UUID releaseForm,
      UUID sessionWorkspace,
      UUID releaseWorkspace) {
    if (release == null) {
      return "RELEASE_MISSING";
    }
    if (!sessionForm.equals(releaseForm)) {
      return "SESSION_FORM_RELEASE_FORM_MISMATCH";
    }
    if (sessionWorkspace == null || releaseWorkspace == null) {
      return "TENANT_MISSING";
    }
    if (!sessionWorkspace.equals(releaseWorkspace)) {
      return "SESSION_RELEASE_WORKSPACE_MISMATCH";
    }
    return null;
  }

  private String quarantinedReason(String type, String key) {
    List<String> reasons =
        db.query(
            "select reason_code from record_migration_state where record_type=? and record_key=?"
                + " and state=?",
            (rs, row) -> rs.getString(1),
            type,
            key,
            QUARANTINED);
    return reasons.isEmpty() ? null : reasons.get(0);
  }

  private void persist(
      String type,
      String key,
      Reconciliation result,
      String sourceDigest,
      Map<String, String> evidence) {
    String targetDigest = digest(result.state(), result.profileKey(), result.reason());
    db.update(
        "insert into"
            + " record_migration_state(record_type,record_key,profile_key,source_digest,target_digest,state,reason_code)"
            + " values(?,?,?,?,?,?,?) on conflict(record_type,record_key) do update set"
            + " profile_key=excluded.profile_key,"
            + " source_digest=excluded.source_digest,target_digest=excluded.target_digest,state=excluded.state,reason_code=excluded.reason_code,"
            + " attempt_count=record_migration_state.attempt_count+1,reconciled_at=now() where"
            + " record_migration_state.profile_key is distinct from excluded.profile_key or"
            + " record_migration_state.source_digest is distinct from excluded.source_digest or"
            + " record_migration_state.target_digest is distinct from excluded.target_digest or"
            + " record_migration_state.state is distinct from excluded.state or"
            + " record_migration_state.reason_code is distinct from excluded.reason_code",
        type,
        key,
        result.profileKey(),
        sourceDigest,
        targetDigest,
        result.state(),
        result.reason());
    if (QUARANTINED.equals(result.state())) {
      String payload;
      try {
        payload = json.writeValueAsString(evidence);
      } catch (Exception exception) {
        throw new IllegalStateException("Cannot serialize quarantine evidence", exception);
      }
      db.update(
          "insert into"
              + " compatibility_quarantine_evidence(record_type,record_key,source_digest,reason_code,evidence)"
              + " values(?,?,?,?,cast(? as jsonb)) on conflict(record_type,record_key) do update"
              + " set source_digest=excluded.source_digest,reason_code=excluded.reason_code,evidence=excluded.evidence,last_observed_at=now()"
              + " where compatibility_quarantine_evidence.source_digest is distinct from"
              + " excluded.source_digest or compatibility_quarantine_evidence.reason_code is"
              + " distinct from excluded.reason_code or compatibility_quarantine_evidence.evidence"
              + " is distinct from excluded.evidence",
          type,
          key,
          sourceDigest,
          result.reason(),
          payload);
    }
  }

  private String digest(String... values) {
    StringBuilder source = new StringBuilder();
    for (String value : values) {
      if (!source.isEmpty()) {
        source.append('\u001f');
      }
      source.append(String.valueOf(value));
    }
    return RespondentSecretVerifier.sha256(source.toString());
  }

  private void applyProfile(String table, UUID id, String profileKey) {
    db.update(
        "update "
            + table
            + " set compatibility_profile_key=? where id=? and compatibility_profile_key is"
            + " distinct from ?",
        profileKey,
        id,
        profileKey);
  }

  private record Reconciliation(String state, String profileKey, String reason) {}
}
