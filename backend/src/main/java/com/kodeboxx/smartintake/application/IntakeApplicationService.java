package com.kodeboxx.smartintake.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kodeboxx.smartintake.compatibility.CompatibilityProfile;
import com.kodeboxx.smartintake.compatibility.CompatibilityProfileRegistry;
import com.kodeboxx.smartintake.compatibility.LegacyDefinitionAdapter;
import com.kodeboxx.smartintake.compatibility.RespondentSecretVerifier;
import com.kodeboxx.smartintake.contract.CsvSafety;
import com.kodeboxx.smartintake.contract.CanonicalJson;
import com.kodeboxx.smartintake.contract.ContractRegistry;
import com.kodeboxx.smartintake.contract.FormRuntime;
import com.kodeboxx.smartintake.contract.PackageStamp;
import com.kodeboxx.smartintake.contract.TimeZoneRegistry;
import com.kodeboxx.smartintake.contract.compiler.FormCompiler;
import com.kodeboxx.smartintake.contract.runtime.TypedSessionRuntimeService;
import com.kodeboxx.smartintake.persistence.AuditEventRepository;
import com.kodeboxx.smartintake.security.StaffAuthorization;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class IntakeApplicationService {
  private final JdbcTemplate db;
  private final ObjectMapper json;
  private final StaffAuthorization authorization;
  private final AuditEventRepository audits;
  private final RespondentSecretVerifier respondentSecrets;
  private final CompatibilityProfileRegistry profiles;
  private final LegacyDefinitionAdapter definitions;
  private final FormCompiler compiler;
  private final TypedSessionRuntimeService typedRuntime;
  private final SubmissionAttemptLedger submissionAttempts;
  private final ContractRegistry contracts;

  public IntakeApplicationService(
      JdbcTemplate db,
      ObjectMapper json,
      StaffAuthorization authorization,
      AuditEventRepository audits,
      RespondentSecretVerifier respondentSecrets,
      CompatibilityProfileRegistry profiles,
      LegacyDefinitionAdapter definitions,
      FormCompiler compiler,
      TypedSessionRuntimeService typedRuntime,
      SubmissionAttemptLedger submissionAttempts,
      ContractRegistry contracts) {
    this.db = db;
    this.json = json;
    this.authorization = authorization;
    this.audits = audits;
    this.respondentSecrets = respondentSecrets;
    this.profiles = profiles;
    this.definitions = definitions;
    this.compiler = compiler;
    this.typedRuntime = typedRuntime;
    this.submissionAttempts = submissionAttempts;
    this.contracts = contracts;
  }

  public record Bootstrap(
      String email, String password, String organizationName, String workspaceName) {}

  public record CreateForm(String formKey, String title) {}

  public record Draft(Map<String, Object> definition) {}

  public record StartSession(String locale, String timeZone) {}

  public record PatchSession(
      Long baseRevision,
      String clientMutationId,
      Map<String, Object> answers,
      List<Map<String, Object>> operations,
      String currentPageId) {
    public PatchSession(Long baseRevision, UUID clientMutationId, Map<String, Object> answers) {
      this(baseRevision, clientMutationId == null ? null : clientMutationId.toString(), answers, null, null);
    }

    public PatchSession(
        Long baseRevision,
        UUID clientMutationId,
        Map<String, Object> answers,
        List<Map<String, Object>> operations,
        String currentPageId) {
      this(baseRevision, clientMutationId == null ? null : clientMutationId.toString(), answers,
          operations, currentPageId);
    }
  }

  public record Submit(
      Long sessionRevision,
      String reviewDigest,
      List<Map<String, Object>> acknowledgments,
      String attemptId) {
    public Submit(Long sessionRevision) { this(sessionRevision, null, List.of(), null); }
  }

  // Staff authentication and service metadata

  public ResponseEntity<?> bootstrap(Bootstrap in) {
    if (in.email() == null
        || !in.email().contains("@")
        || in.password() == null
        || in.password().length() < 12)
      throw bad("BOOTSTRAP_INVALID", "Email and 12+ character password required");
    if (db.queryForObject("select count(*) from accounts", Integer.class) != 0)
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Bootstrap closed");
    UUID a = UUID.randomUUID(), o = UUID.randomUUID(), w = UUID.randomUUID(), t = UUID.randomUUID();
    db.update(
        "insert into accounts(id,email,password_hash) values(?,?,?)",
        a,
        in.email().toLowerCase(),
        new BCryptPasswordEncoder().encode(in.password()));
    db.update(
        "insert into organizations(id,name) values(?,?)",
        o,
        Optional.ofNullable(in.organizationName()).orElse("Local organization"));
    db.update(
        "insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?)",
        w,
        o,
        "local",
        Optional.ofNullable(in.workspaceName()).orElse("Local workspace"));
    db.update("insert into memberships(account_id,workspace_id,role) values(?,?,?)", a, w, "WORKSPACE_ADMINISTRATOR");
    db.update(
        "insert into staff_sessions(token,account_id,expires_at) values(?,?,?)",
        t,
        a,
        java.sql.Timestamp.from(Instant.now().plus(Duration.ofHours(8))));
    audit("BOOTSTRAP_COMPLETED", a);
    return ResponseEntity.status(201)
        .body(
            Map.of(
                "staffSession", t.toString(), "workspaceKey", "local", "roles", List.of("workspace-administrator")));
  }

  public ResponseEntity<?> signIn(Bootstrap in) {
    try {
      var a =
          db.queryForMap(
              "select id,password_hash from accounts where email=?",
              in.email().toLowerCase(Locale.ROOT));
      if (!new BCryptPasswordEncoder().matches(in.password(), (String) a.get("password_hash")))
        throw new IllegalArgumentException();
      UUID t = UUID.randomUUID();
      db.update(
          "insert into staff_sessions(token,account_id,expires_at) values(?,?,?)",
          t,
          a.get("id"),
          java.sql.Timestamp.from(Instant.now().plus(Duration.ofHours(8))));
      return ResponseEntity.ok(Map.of("staffSession", t.toString(), "workspaceKey", "local"));
    } catch (Exception e) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
    }
  }

  public ResponseEntity<?> logout(String token) {
    try {
      if (token != null)
        db.update("delete from staff_sessions where token=?", UUID.fromString(token));
    } catch (Exception ignored) {
    }
    return ResponseEntity.noContent().build();
  }

  public Map<String, Object> health() {
    return Map.of("status", "UP", "service", "smart-intake-api", "contractVersion", "4.0.0");
  }

  public Map<String, Object> capabilities() {
    return Map.of(
        "contractVersion",
        "4.0.0",
        "fieldTypes",
        List.of(
            "text",
            "integer",
            "decimal",
            "boolean",
            "choice",
            "multiChoice",
            "date",
            "object",
            "list",
            "attachments",
            "drawing"),
        "operators",
        List.of("equals", "notEquals", "isAnswered", "greaterThan", "contains"));
  }

  // Staff form authoring and publishing

  public List<Map<String, Object>> forms(String workspace, String token) {
    UUID ws = authorization.authorizeAuthoring(workspace, token);
    return db.query(
        "select f.id,f.form_key,f.title,f.status,f.revision,f.updated_at from forms f left join form_catalog_metadata cm on cm.form_id=f.id where f.workspace_id=? and cm.archived_at is null order"
            + " by updated_at desc",
        (rs, n) ->
            Map.of(
                "id",
                rs.getObject("id").toString(),
                "formKey",
                rs.getString("form_key"),
                "title",
                rs.getString("title"),
                "status",
                rs.getString("status"),
                "revision",
                rs.getLong("revision"),
                "updatedAt",
                rs.getObject("updated_at").toString()),
        ws);
  }

  public ResponseEntity<?> create(String workspace, String token, CreateForm in) {
    UUID ws = authorization.authorizeAuthoring(workspace, token);
    if (in.formKey() == null || !in.formKey().matches("[a-z][a-z0-9-]{2,99}"))
      throw bad("FORM_KEY_INVALID", "Use a lowercase stable key of at least three characters.");
    UUID id = UUID.randomUUID();
    Map<String, Object> def = canonicalAuthoringTemplate(in.formKey(), in.title());
    db.update(
        "insert into forms(id,workspace_id,form_key,title,definition,compatibility_profile_key)"
            + " values(?,?,?,?,cast(? as jsonb),?)",
        id,
        ws,
        in.formKey(),
        in.title(),
        stringify(def),
        CompatibilityProfile.CANONICAL_4_0_0.key());
    audit("FORM_CREATED", id);
    return ResponseEntity.status(201)
        .eTag(etag(1))
        .body(Map.of("id", id, "draftId", id, "revision", 1, "definition", def));
  }

  public ResponseEntity<?> draft(String workspace, UUID form, String draft, String token) {
    requireCanonicalDraftId(form, draft);
    authorization.requireReadableForm(workspace, token, form);
    requireCatalogActive(form);
    var row = formRow(form);
    return ResponseEntity.ok()
        .eTag(etag(row.revision()))
        .body(
            Map.of(
                "id",
                form,
                "revision",
                row.revision(),
                "definition",
                parse(row.definition()),
                "diagnostics",
                List.of()));
  }

  public ResponseEntity<?> save(String workspace, UUID form, String draft, String token, String match, Draft in) {
    requireCanonicalDraftId(form, draft);
    authorization.requireOwnedForm(workspace, token, form);
    requireCatalogActive(form);
    requireNewWriteAllowed("FORM", form);
    var row = formRow(form);
    if (match == null)
      throw new ResponseStatusException(HttpStatus.PRECONDITION_REQUIRED, "If-Match required");
    if (!match.equals(etag(row.revision())))
      throw new ResponseStatusException(
          HttpStatus.PRECONDITION_FAILED, "Draft changed; reload to resolve conflict");
    validateDefinition(in.definition());
    String profile = profileForDefinition(in.definition());
    long next = row.revision() + 1;
    db.update(
        "update forms set definition=cast(? as jsonb),compatibility_profile_key=?,revision=?,updated_at=now() where id=?",
        stringify(in.definition()),
        profile,
        next,
        form);
    audit("DRAFT_SAVED", form);
    return ResponseEntity.ok()
        .eTag(etag(next))
        .body(Map.of("revision", next, "definition", in.definition(), "diagnostics", List.of()));
  }

  private void requireCanonicalDraftId(UUID form, String draft) {
    if (!form.toString().equals(draft))
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Resource not found");
  }

  public Map<String, Object> definitionExport(String workspace, UUID form, String token) {
    authorization.requireOwnedForm(workspace, token, form);
    return json.convertValue(
        PackageStamp.attach(
            json.valueToTree(parse(formRow(form).definition())),
            "lite-expression-1",
            TimeZoneRegistry.VERSION),
        Map.class);
  }

  public ResponseEntity<?> definitionImport(
      String workspace, UUID form, String token, String match, Map<String, Object> candidate) {
    authorization.requireOwnedForm(workspace, token, form);
    requireCatalogActive(form);
    requireNewWriteAllowed("FORM", form);
    var row = formRow(form);
    if (match == null || !match.equals(etag(row.revision())))
      throw new ResponseStatusException(
          HttpStatus.PRECONDITION_FAILED, "Draft changed; reload before import");
    try {
      PackageStamp.verify(json.valueToTree(candidate));
      candidate.remove("packageStamp");
      validateDefinition(candidate);
    } catch (Exception e) {
      return ResponseEntity.unprocessableEntity()
          .body(
              Map.of(
                  "code",
                  "IMPORT_INVALID",
                  "diagnostics",
                  List.of(Map.of("message", e.getMessage()))));
    }
    long revision = row.revision() + 1;
    db.update(
        "update forms set definition=cast(? as jsonb),compatibility_profile_key=?,revision=?,updated_at=now() where id=?",
        stringify(candidate),
        profileForDefinition(candidate),
        revision,
        form);
    audit("DEFINITION_IMPORTED", form);
    return ResponseEntity.ok()
        .eTag(etag(revision))
        .body(Map.of("revision", revision, "diagnostics", List.of()));
  }

  public ResponseEntity<?> publish(String workspace, UUID form, String token) {
    authorization.requirePublishForm(workspace, token, form);
    requireCatalogActive(form);
    requireNewWriteAllowed("FORM", form);
    var row = formRow(form);
    validateDefinition(parse(row.definition()));
    int version =
        db.queryForObject(
            "select coalesce(max(version),0)+1 from form_releases where form_id=?",
            Integer.class,
            form);
    UUID release = UUID.randomUUID();
    JsonNode definition = json.valueToTree(parse(row.definition()));
    String pinnedManifest = typedRuntime.canonical(definition) ? stringify(runtimeManifest(definition)) : null;
    db.update(
        "insert into form_releases(id,form_id,version,package,compatibility_profile_key,runtime_manifest)"
            + " values(?,?,?,cast(? as jsonb),?,cast(? as jsonb))",
        release,
        form,
        version,
        row.definition(),
        profileForDefinition(parse(row.definition())),
        pinnedManifest);
    db.update("update forms set status='PUBLISHED',updated_at=now() where id=?", form);
    audit("FORM_PUBLISHED", form);
    return ResponseEntity.status(201)
        .body(
            Map.of(
                "releaseId",
                release,
                "version",
                version,
                "shareId",
                form.toString(),
                "status",
                "PUBLISHED"));
  }

  // Respondent session lifecycle

  public ResponseEntity<?> start(UUID share, StartSession in) {
    R release = latestRelease(share);
    requireNewWriteAllowed("RELEASE", release.id());
    UUID id = UUID.randomUUID(), bearer = UUID.randomUUID(), legacyPlaceholder = UUID.randomUUID();
    JsonNode releaseNode = json.valueToTree(parse(release.pkg()));
    if (typedRuntime.canonical(releaseNode))
      db.update("update form_releases set runtime_manifest=cast(? as jsonb) where id=? and runtime_manifest is null",
          stringify(runtimeManifest(releaseNode)), release.id());
    String locale = in == null || in.locale() == null
        ? releaseNode.path("defaultLocale").asText("en") : in.locale();
    if (typedRuntime.canonical(releaseNode)) {
      boolean supportedLocale = false;
      for (JsonNode supported : releaseNode.path("supportedLocales"))
        if (locale.equals(supported.asText())) supportedLocale = true;
      if (!supportedLocale) throw bad("UNSUPPORTED_LOCALE", "Locale is not supported by this release");
    }
    String timeZone = in == null || in.timeZone() == null ? "UTC" : in.timeZone();
    if (!TimeZoneRegistry.contains(timeZone)) throw bad("INVALID_TIMEZONE", "Unsupported timezone");
    Instant sessionInstant = Instant.now();
    java.time.LocalDate sessionDate = sessionInstant.atZone(java.time.ZoneId.of(timeZone)).toLocalDate();
    Map<String, Object> initialAnswers = Map.of();
    Map<String, Object> initialRuntimeState = null;
    if (typedRuntime.canonical(releaseNode)) {
      var initial = typedRuntime.mutate(releaseNode, json.createObjectNode(), null, List.of(),
          null, sessionDate.toString(), timeZone, locale, sessionInstant);
      if (!initial.accepted()) throw bad("RUNTIME_INITIALIZATION_FAILED", "Canonical runtime rejected");
      initialAnswers = initial.answers();
      initialRuntimeState = initial.runtimeState();
    }
    db.update(
        "insert into"
            + " sessions(id,form_id,release_id,respondent_token,respondent_secret_sha256,compatibility_profile_key,locale,answers,runtime_state,session_date,time_zone,tzdb_version)"
            + " values(?,?,?,?,?,?,?,cast(? as jsonb),cast(? as jsonb),?,?,?)",
        id,
        share,
        release.id(),
        legacyPlaceholder,
        respondentSecrets.digest(bearer),
        release.profileKey(),
        locale,
        stringify(initialAnswers),
        initialRuntimeState == null ? null : stringify(initialRuntimeState),
        sessionDate,
        timeZone,
        TimeZoneRegistry.VERSION);
    return ResponseEntity.status(201)
        .body(
            Map.of(
                "sessionId",
                id,
                "respondentSession",
                bearer,
                "revision",
                0,
                "locale",
                locale,
                "runtimeManifest",
                Map.of("sessionDate", sessionDate.toString(), "timeZone", timeZone,
                    "timeZoneDatabaseVersion", TimeZoneRegistry.VERSION),
                "release",
                parse(release.pkg()),
                "expiresAt",
                Instant.now().plus(Duration.ofDays(7)).toString()));
  }

  public Map<String, Object> session(UUID id, String token) {
    return sessionView(respondent(id, token));
  }

  @Transactional
  public Map<String, Object> patch(UUID id, String token, PatchSession in) {
    if (in.operations() != null && in.operations().size() > TypedSessionRuntimeService.MAX_OPERATIONS_PER_BATCH)
      throw bad("OPERATION_LIMIT", "Mutation batch exceeds the operation limit");
    var s = respondent(id, token, true);
    if (in.clientMutationId() == null
        || !in.clientMutationId().matches("^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$"))
      throw bad("MUTATION_ID_REQUIRED", "clientMutationId required");
    String requestDigest = CanonicalJson.sha256(json.valueToTree(in));
    try {
      Replay replay = db.queryForObject(
          "select response::text,request_digest from session_mutations where session_id=? and"
              + " client_mutation_id=?",
          (rs, row) -> new Replay(rs.getString(1), rs.getString(2)),
          id,
          in.clientMutationId());
      if (replay.requestDigest() == null) {
        throw new ResponseStatusException(HttpStatus.CONFLICT, "MUTATION_ID_UNBOUND");
      }
      if (!replay.requestDigest().equals(requestDigest)) {
        throw new ResponseStatusException(HttpStatus.CONFLICT, "MUTATION_ID_REUSED");
      }
      return parse(replay.response());
    } catch (EmptyResultDataAccessException ignored) {
      // The mutation ID is new for this session.
    }
    if (!s.status().equals("DRAFT")) throw bad("SESSION_CLOSED", "Submitted");
    if (!Objects.equals(in.baseRevision(), s.revision()))
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SESSION_REVISION_CONFLICT");
    R release = release(s.releaseId());
    JsonNode releaseNode = json.valueToTree(parse(release.pkg()));
    requireCanonicalRuntimeState(s, releaseNode);
    Map<String, Object> answers;
    Map<String, Object> persistedRuntimeState = null;
    List<Map<String, Object>> validation;
    Map<String, Object> runtimeProjection = new LinkedHashMap<>();
    long next = s.revision() + 1;
    if (typedRuntime.canonical(releaseNode)) {
      if (in.operations() == null || in.operations().isEmpty() || in.answers() != null) {
        throw bad("OPERATIONS_REQUIRED", "Canonical sessions require one non-empty typed operation batch");
      }
      var outcome = typedRuntime.mutate(releaseNode, json.valueToTree(parse(s.answers())),
          parseNode(s.runtimeState()), in.operations(), in.currentPageId(),
          s.sessionDate().toString(), s.timeZone(), s.locale(), Instant.now());
      if (!outcome.accepted()) {
        String code = outcome.validation().isEmpty()
            ? "MUTATION_INVALID" : Objects.toString(outcome.validation().get(0).get("code"));
        throw bad(code, "Typed mutation batch rejected");
      }
      answers = outcome.answers();
      persistedRuntimeState = new LinkedHashMap<>(outcome.runtimeState());
      validation = bindInvalidMarkerRevisions(
          persistedRuntimeState, parseNode(s.runtimeState()), outcome.validation(), next);
      runtimeProjection.put("reachablePageIds", outcome.reachablePageIds());
      runtimeProjection.put("requiredCount", outcome.requiredCount());
      runtimeProjection.put("completedRequiredCount", outcome.completedRequiredCount());
      runtimeProjection.put("invalidInputs", validation.stream()
          .filter(item -> "UNPARSEABLE_INPUT".equals(item.get("code"))).toList());
    } else {
      if (in.answers() == null) throw bad("ANSWERS_REQUIRED", "Legacy answer map required");
      answers = new FormRuntime(json).respondentAnswers(parse(release.pkg()), in.answers());
      validation = validateAnswers(release.pkg(), answers, s);
    }
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("acceptedRevision", next);
    out.put("answers", answers);
    out.put("validation", validation);
    out.putAll(runtimeProjection);
    if (persistedRuntimeState == null) {
      db.update("update sessions set answers=cast(? as jsonb),revision=? where id=?",
          stringify(answers), next, id);
    } else {
      db.update(
          "update sessions set answers=cast(? as jsonb),runtime_state=cast(? as jsonb),revision=? where id=?",
          stringify(answers), stringify(persistedRuntimeState), next, id);
    }
    db.update(
        "insert into session_mutations(session_id,client_mutation_id,accepted_revision,response,request_digest)"
            + " values(?,?,?,cast(? as jsonb),?)",
        id,
        in.clientMutationId(),
        next,
        stringify(out),
        requestDigest);
    return out;
  }

  public Map<String, Object> validate(UUID id, String token) {
    var s = respondent(id, token);
    R release = release(s.releaseId());
    JsonNode definition = json.valueToTree(parse(release.pkg()));
    requireCanonicalRuntimeState(s, definition);
    if (typedRuntime.canonical(definition)) {
      var outcome = typedRuntime.mutate(definition, json.valueToTree(parse(s.answers())),
          parseNode(s.runtimeState()), List.of(), null, s.sessionDate().toString(), s.timeZone(), s.locale(), Instant.now());
      if (outcome.validation().stream().anyMatch(error -> "UNPARSEABLE_INPUT".equals(error.get("code"))))
        throw bad("INVALID_INPUT_PENDING", "Applicable input must be entered again");
      Map<String, Object> response = new LinkedHashMap<>();
      response.put("errors", outcome.validation());
      if (outcome.validation().isEmpty()) {
        response.put("review", outcome.reviewProjection());
        response.put("reviewDigest", outcome.reviewDigest());
      }
      return response;
    }
    return Map.of(
        "errors",
        validateAnswers(release.pkg(), parse(s.answers()), s),
        "reviewDigest",
        UUID.nameUUIDFromBytes(s.answers().getBytes()).toString());
  }

  @Transactional
  public ResponseEntity<?> submit(UUID id, String token, Submit in) {
    var s = respondent(id, token, true);
    R release = release(s.releaseId());
    JsonNode definition = json.valueToTree(parse(release.pkg()));
    boolean canonical = typedRuntime.canonical(definition);
    if (!s.status().equals("DRAFT")) {
      Map<String, Object> sealed = db.queryForMap(
          "select id,attempt_id from submissions where session_id=?", id);
      UUID existing = (UUID) sealed.get("id");
      if (canonical) {
        if (in.attemptId() == null) throw new ResponseStatusException(HttpStatus.CONFLICT, "SESSION_SUBMITTED");
        try {
          Map<String, Object> attempt = submissionAttempts.status(id, in.attemptId());
          String requestDigest = CanonicalJson.sha256(json.valueToTree(in));
          if (!requestDigest.equals(attempt.get("requestDigest"))
              || !"succeeded".equals(attempt.get("state"))
              || !existing.equals(attempt.get("submissionId"))
              || !Objects.equals(in.attemptId(), sealed.get("attempt_id")))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "SUBMISSION_ATTEMPT_REUSED");
        } catch (EmptyResultDataAccessException missing) {
          throw new ResponseStatusException(HttpStatus.CONFLICT, "SESSION_SUBMITTED");
        }
      }
      return receipt(existing);
    }
    if (!Objects.equals(in.sessionRevision(), s.revision()))
      throw new ResponseStatusException(HttpStatus.CONFLICT, "REVIEW_STALE");
    requireCanonicalRuntimeState(s, definition);
    Map<String, Object> acceptedAnswers = parse(s.answers());
    Map<String, Object> acceptedRuntimeState = null;
    Map<String, Object> acceptedReviewProjection = null;
    String acceptedReviewDigest = null;
    List<Map<String, Object>> errors;
    if (canonical) {
      var outcome = typedRuntime.mutate(definition, json.valueToTree(acceptedAnswers),
          parseNode(s.runtimeState()), List.of(), null, s.sessionDate().toString(), s.timeZone(), s.locale(), Instant.now());
      if (!outcome.accepted()) throw bad("RUNTIME_STATE_INVALID", "Canonical runtime state rejected");
      acceptedAnswers = outcome.answers();
      acceptedRuntimeState = outcome.runtimeState();
      acceptedReviewProjection = outcome.reviewProjection();
      acceptedReviewDigest = outcome.reviewDigest();
      errors = outcome.validation();
    } else {
      errors = validateAnswers(release.pkg(), acceptedAnswers, s);
    }
    if (!errors.isEmpty()) {
      String code = errors.stream().anyMatch(error -> "UNPARSEABLE_INPUT".equals(error.get("code")))
          ? "INVALID_INPUT_PENDING" : "VALIDATION_FAILED";
      return ResponseEntity.unprocessableEntity()
          .body(Map.of("code", code, "errors", errors));
    }
    List<Map<String, Object>> acceptedAcknowledgments = List.of();
    if (canonical) {
      if (in.reviewDigest() == null || !in.reviewDigest().equals(acceptedReviewDigest))
        throw new ResponseStatusException(HttpStatus.CONFLICT, "REVIEW_STALE");
      if (in.attemptId() == null || !in.attemptId().matches("^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$"))
        throw bad("ATTEMPT_ID_REQUIRED", "A valid submission attemptId is required");
      submissionAttempts.begin(id, in.attemptId(), CanonicalJson.sha256(json.valueToTree(in)));
      try {
        acceptedAcknowledgments = authoritativeAcknowledgments(
            acceptedReviewProjection, in.acknowledgments(), Instant.now());
      } catch (RuntimeException failure) {
        submissionAttempts.failed(id, in.attemptId(), failure instanceof ResponseStatusException status
            && status.getReason() != null ? status.getReason() : "SUBMISSION_FAILED");
        throw failure;
      }
    }
    UUID sub = UUID.randomUUID();
    Instant submittedAt = Instant.now();
    Map<String, Object> pinnedManifest = canonical ? pinnedRuntimeManifest(s.releaseId()) : null;
    Map<String, Object> envelope = canonical
        ? canonicalEnvelope(sub, s, definition, acceptedAnswers, acceptedRuntimeState,
            acceptedAcknowledgments, acceptedReviewDigest, pinnedManifest, submittedAt)
        : Map.of("contractVersion", "4.0.0", "submissionId", sub, "formId", s.formId(),
            "answers", acceptedAnswers, "submittedAt", submittedAt.toString());
    if (canonical) contracts.requireValid("submission-envelope", "4.0.0", json.valueToTree(envelope));
    db.update(
        """
        insert into submissions(id,form_id,session_id,envelope,review_projection,review_digest,attempt_id,runtime_manifest)
        values(?,?,?,cast(? as jsonb),cast(? as jsonb),?,?,cast(? as jsonb))
        """,
        sub,
        s.formId(),
        id,
        stringify(envelope),
        acceptedReviewProjection == null ? null : stringify(acceptedReviewProjection),
        acceptedReviewDigest,
        canonical ? in.attemptId() : null,
        canonical ? stringify(pinnedManifest) : null);
    if (acceptedRuntimeState == null) {
      db.update("update sessions set status='SUBMITTED',answers=cast(? as jsonb) where id=?",
          stringify(acceptedAnswers), id);
    } else {
      db.update(
          "update sessions set status='SUBMITTED',answers=cast(? as jsonb),runtime_state=cast(? as jsonb) where id=?",
          stringify(acceptedAnswers), stringify(acceptedRuntimeState), id);
    }
    if (canonical)
      db.update("""
          update submission_attempts set state='SUCCEEDED',submission_id=?,updated_at=now()
          where session_id=? and attempt_id=?
          """, sub, id, in.attemptId());
    audit("SUBMISSION_ACCEPTED", sub);
    return receipt(sub);
  }

  public void submissionFailed(UUID sessionId, String attemptId, String errorCode) {
    if (attemptId != null && attemptId.matches("^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$"))
      submissionAttempts.failed(sessionId, attemptId, errorCode);
  }

  public Map<String, Object> submissionOperation(UUID id, String token) {
    respondent(id, token);
    try {
      Map<String, Object> status = new LinkedHashMap<>(submissionAttempts.latest(id));
      status.remove("requestDigest");
      return status;
    } catch (EmptyResultDataAccessException none) {
      return Map.of("attemptId", "attempt-none", "state", "failed", "errorCode", "NOT_SUBMITTED");
    }
  }

  public Map<String, Object> submissionOperation(UUID id, String token, String attemptId) {
    respondent(id, token);
    if (attemptId == null || !attemptId.matches("^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$"))
      throw bad("ATTEMPT_ID_REQUIRED", "A valid submission attemptId is required");
    try {
      Map<String, Object> status = new LinkedHashMap<>(submissionAttempts.status(id, attemptId));
      status.remove("requestDigest");
      return status;
    } catch (EmptyResultDataAccessException none) {
      return Map.of("attemptId", attemptId, "state", "notStarted");
    }
  }

  @SuppressWarnings("unchecked")
  private List<Map<String, Object>> authoritativeAcknowledgments(
      Map<String, Object> review, List<Map<String, Object>> supplied, Instant acceptedAt) {
    List<Map<String, Object>> gates = review == null || !(review.get("reviewGates") instanceof List<?> values)
        ? List.of() : (List<Map<String, Object>>) (List<?>) values;
    List<Map<String, Object>> requests = supplied == null ? List.of() : supplied;
    if (requests.size() > 1000) throw bad("ACKNOWLEDGMENT_LIMIT", "Too many acknowledgments supplied");
    List<Map<String, Object>> result = new ArrayList<>();
    for (Map<String, Object> gate : gates) {
      if (!Boolean.TRUE.equals(gate.get("value")))
        throw bad("ACKNOWLEDGMENT_REQUIRED", "The current acknowledgment answer must be true");
      String fieldId = Objects.toString(gate.get("fieldId"), "");
      Object rowPath = Optional.ofNullable(gate.get("rowPath")).orElse(List.of());
      String contentHash = Objects.toString(gate.get("contentHash"), "");
      Map<String, Object> request = requests.stream()
          .filter(candidate -> fieldId.equals(candidate.get("fieldId"))
              && Objects.equals(rowPath, Optional.ofNullable(candidate.get("rowPath")).orElse(List.of())))
          .findFirst().orElseThrow(() -> bad("ACKNOWLEDGMENT_REQUIRED", "A current acknowledgment is required"));
      if (!Boolean.TRUE.equals(request.get("accepted"))
          || !contentHash.equals(request.get("expectedContentHash")))
        throw new ResponseStatusException(HttpStatus.CONFLICT, "ACKNOWLEDGMENT_STALE");
      Map<String, Object> accepted = new LinkedHashMap<>();
      accepted.put("kind", "field");
      accepted.put("fieldId", fieldId);
      accepted.put("instanceId", Objects.toString(gate.get("instanceId"), fieldId));
      accepted.put("rowPath", rowPath);
      accepted.put("locale", gate.get("locale"));
      accepted.put("contentKey", gate.get("contentKey"));
      accepted.put("contentHash", contentHash);
      accepted.put("acceptedAt", acceptedAt.toString());
      result.add(Map.copyOf(accepted));
    }
    if (requests.size() != result.size()) throw bad("ACKNOWLEDGMENT_UNKNOWN", "Unknown acknowledgment supplied");
    return List.copyOf(result);
  }

  private Map<String, Object> canonicalEnvelope(
      UUID submissionId, S session, JsonNode definition, Map<String, Object> answers,
      Map<String, Object> runtimeState, List<Map<String, Object>> acknowledgments,
      String reviewDigest, Map<String, Object> manifest, Instant submittedAt) {
    Map<String, Object> lineage = db.queryForObject("""
        select w.id,o.id from forms f join workspaces w on w.id=f.workspace_id
        join organizations o on o.id=w.organization_id where f.id=?
        """, (rs, row) -> Map.of("workspace", (UUID) rs.getObject(1), "tenant", (UUID) rs.getObject(2)),
        session.formId());
    String packageHash = CanonicalJson.sha256(definition);
    String manifestHash = Objects.toString(manifest.get("runtimeManifestHash"));
    Map<String, Object> release = Map.of(
        "releaseId", canonicalId("release", session.releaseId()),
        "definitionVersion", definition.path("definitionVersion").asText("4.0.0"),
        "packageSchemaVersion", "4.0.0",
        "runtimeManifestVersion", Objects.toString(manifest.get("runtimeManifestVersion")),
        "runtimeManifestHash", manifestHash,
        "packageHash", packageHash,
        "engineContract", "4.0.0",
        "contractVersion", "4.0.0");
    Map<String, Object> reviewEvidence = Map.of(
        "dependencyId", "reviewEvidence",
        "version", ContractRegistry.API_VERSION,
        "digest", reviewDigest,
        "value", reviewDigest);
    Map<String, Object> envelope = new LinkedHashMap<>();
    envelope.put("schemaVersion", "4.0.0");
    envelope.put("submissionId", canonicalId("submission", submissionId));
    envelope.put("tenantId", canonicalId("tenant", (UUID) lineage.get("tenant")));
    envelope.put("workspaceId", canonicalId("workspace", (UUID) lineage.get("workspace")));
    envelope.put("formId", canonicalId("form", session.formId()));
    envelope.put("sessionId", canonicalId("session", session.id()));
    envelope.put("sessionRevision", session.revision());
    envelope.put("startedAt", session.createdAt().toString());
    envelope.put("receivedAt", submittedAt.toString());
    envelope.put("submittedAt", submittedAt.toString());
    envelope.put("status", "accepted");
    envelope.put("locale", session.locale());
    envelope.put("evaluationContext", Map.of(
        "sessionDate", session.sessionDate().toString(), "timeZone", session.timeZone()));
    envelope.put("release", release);
    envelope.put("answers", answers);
    envelope.put("attachments", List.of());
    envelope.put("acknowledgments", acknowledgments);
    envelope.put("extensions", Map.of("x-kodeboxx.review", reviewEvidence));
    return Map.copyOf(envelope);
  }

  private Map<String, Object> pinnedRuntimeManifest(UUID releaseId) {
    String manifestJson = db.queryForObject(
        "select runtime_manifest::text from form_releases where id=?", String.class, releaseId);
    if (manifestJson == null) throw bad("RUNTIME_MANIFEST_MISSING", "Release runtime manifest is not pinned");
    Map<String, Object> manifest = parse(manifestJson);
    contracts.requireValid("runtime-manifest", "4.0.0", json.valueToTree(manifest));
    return manifest;
  }

  private Map<String, Object> runtimeManifest(JsonNode definition) {
    Map<String, Object> manifest = new LinkedHashMap<>();
    manifest.put("schemaVersion", "4.0.0");
    manifest.put("contractVersion", "4.0.0");
    manifest.put("engineContract", "4.0.0");
    manifest.put("runtimeManifestVersion", "1");
    manifest.put("runtimeManifestHash", "sha256:" + "0".repeat(64));
    manifest.put("packageHash", CanonicalJson.sha256(definition));
    manifest.put("policyVersion", CanonicalJson.sha256(definition.path("policies")));
    manifest.put("timeZoneDatabaseVersion", TimeZoneRegistry.VERSION);
    List<Map<String, Object>> resolvedComponents = new ArrayList<>();
    for (JsonNode dependency : definition.path("dependencies")) {
      String sourceKind = dependency.path("kind").asText();
      if ("asset".equals(sourceKind)) continue;
      String manifestKind = switch (sourceKind) {
        case "theme" -> "theme";
        case "locale" -> "locale";
        case "extension" -> "extension";
        case "block", "component" -> "fieldControl";
        default -> throw bad("DEPENDENCY_KIND_INVALID", "Unsupported runtime dependency kind");
      };
      resolvedComponents.add(Map.of(
          "kind", manifestKind, "id", dependency.path("id").asText(),
          "version", dependency.path("version").asText(), "digest", dependency.path("digest").asText()));
    }
    manifest.put("resolvedComponents", resolvedComponents);
    manifest.put("resolvedAssets", json.convertValue(definition.path("assets"), List.class));
    manifest.put("extensions", Map.of());
    Map<String, Object> hashInput = new LinkedHashMap<>(manifest);
    hashInput.remove("runtimeManifestHash");
    manifest.put("runtimeManifestHash", CanonicalJson.sha256(json.valueToTree(hashInput)));
    contracts.requireValid("runtime-manifest", "4.0.0", json.valueToTree(manifest));
    return Map.copyOf(manifest);
  }

  private static String canonicalId(String kind, UUID id) {
    return kind + "_" + id.toString().replace("-", "");
  }

  // Staff submission administration and exports

  public List<Map<String, Object>> submissions(String workspace, String token) {
    UUID ws = authorization.authorizeResponseRead(workspace, token);
    return db.query(
        "select s.id,s.form_id,s.submitted_at"
            + visibleSubmissionScope()
            + " order by s.submitted_at desc",
        (rs, n) ->
            Map.of(
                "id",
                rs.getObject("id").toString(),
                "formId",
                rs.getObject("form_id").toString(),
                "submittedAt",
                rs.getObject("submitted_at").toString()),
        ws);
  }

  public Object submission(String workspace, UUID id, String token) {
    UUID ws = authorization.authorizeResponseRead(workspace, token);
    try {
      return parse(
          db.queryForObject(
              "select s.envelope::text" + visibleSubmissionScope() + " and s.id=?",
              String.class,
              ws,
              id));
    } catch (Exception e) {
      throw missing();
    }
  }

  public List<Map<String, Object>> jsonExport(String workspace, String token) {
    UUID ws = authorization.authorizeResponseExport(workspace, token);
    return db.query(
        "select s.envelope::text" + visibleSubmissionScope() + " order by s.submitted_at desc",
        (rs, n) -> parse(rs.getString(1)),
        ws);
  }

  public String csv(String workspace, String token) {
    UUID ws = authorization.authorizeResponseExport(workspace, token);
    StringBuilder b = new StringBuilder("submission_id,form_id,submitted_at,answers\n");
    db.query(
        "select s.id,s.form_id,s.submitted_at,s.envelope->'answers' answers"
            + visibleSubmissionScope()
            + " order by s.submitted_at desc",
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs ->
                b.append(CsvSafety.cell(rs.getObject("id")))
                    .append(',')
                    .append(CsvSafety.cell(rs.getObject("form_id")))
                    .append(',')
                    .append(CsvSafety.cell(rs.getObject("submitted_at")))
                    .append(',')
                    .append(CsvSafety.cell(rs.getString("answers")))
                    .append("\n"),
        ws);
    return b.toString();
  }

  // Persistence and serialization helpers

  private String visibleSubmissionScope() {
    return " from submissions s"
        + " join sessions ss on ss.id=s.session_id"
        + " join form_releases r on r.id=ss.release_id"
        + " join forms f on f.id=s.form_id"
        + " where f.workspace_id=?"
        + " and s.form_id=ss.form_id"
        + " and ss.form_id=r.form_id"
        + " and not exists(select 1 from record_migration_state rms where"
        + " rms.record_type='SUBMISSION' and rms.record_key=s.id::text and rms.state='QUARANTINED')"
        + " and not exists(select 1 from record_migration_state rms where"
        + " rms.record_type='SESSION' and rms.record_key=ss.id::text and rms.state='QUARANTINED')"
        + " and not exists(select 1 from record_migration_state rms where"
        + " rms.record_type='RELEASE' and rms.record_key=r.id::text and rms.state='QUARANTINED')"
        + " and not exists(select 1 from record_migration_state rms where"
        + " rms.record_type='FORM' and rms.record_key=f.id::text and rms.state='QUARANTINED')";
  }

  private record F(UUID id, long revision, String definition) {}

  private record R(UUID id, String pkg, String profileKey) {}

  private record S(
      UUID id, UUID formId, UUID releaseId, long revision, String answers, String status,
      java.time.LocalDate sessionDate, String timeZone, String tzdbVersion, String runtimeState,
      String locale, Instant createdAt) {}

  private record RespondentRow(S session, String secretDigest, UUID retainedLegacyToken) {}
  private record Replay(String response, String requestDigest) {}

  private R release(UUID id) {
    return db.queryForObject(
        "select id,package::text,compatibility_profile_key from form_releases where id=?",
        (rs, n) -> new R((UUID) rs.getObject(1), rs.getString(2), rs.getString(3)),
        id);
  }

  private S respondent(UUID id, String token) {
    return respondent(id, token, false);
  }

  private S respondent(UUID id, String token, boolean lock) {
    try {
      if (token == null) throw new Exception();
      UUID secret = UUID.fromString(token);
      RespondentRow row =
          db.queryForObject(
              "select"
                  + " id,form_id,release_id,revision,answers::text,status,session_date,time_zone,tzdb_version,runtime_state::text,locale,created_at,respondent_secret_sha256,respondent_token"
                  + " from sessions where id=? and expires_at>now()"
                  + (lock ? " for update" : ""),
              (rs, n) -> {
                S session =
                    new S(
                        (UUID) rs.getObject(1),
                        (UUID) rs.getObject(2),
                        (UUID) rs.getObject(3),
                        rs.getLong(4),
                        rs.getString(5),
                        rs.getString(6),
                        rs.getObject(7, java.time.LocalDate.class),
                        rs.getString(8),
                        rs.getString(9),
                        rs.getString(10),
                        rs.getString(11),
                        rs.getTimestamp(12).toInstant());
                return new RespondentRow(session, rs.getString(13), (UUID) rs.getObject(14));
              },
              id);
      String digest = row.secretDigest();
      if (digest == null) {
        if (!secret.equals(row.retainedLegacyToken())) throw new IllegalArgumentException();
        String computed = respondentSecrets.digest(secret);
        int updated =
            db.update(
                "update sessions set respondent_secret_sha256=? where id=? and"
                    + " respondent_secret_sha256 is null",
                computed,
                id);
        digest =
            updated == 1
                ? computed
                : db.queryForObject(
                    "select respondent_secret_sha256 from sessions where id=?", String.class, id);
      }
      if (!respondentSecrets.matches(secret, digest)) throw new IllegalArgumentException();
      return row.session();
    } catch (Exception e) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Respondent session required");
    }
  }

  private R latestRelease(UUID form) {
    Integer archived = db.queryForObject(
        "select count(*) from form_catalog_metadata where form_id=? and archived_at is not null",
        Integer.class,
        form);
    if (archived != null && archived > 0)
      throw new ResponseStatusException(HttpStatus.GONE, "This form is no longer accepting responses");
    try {
      return db.queryForObject(
          "select r.id,r.package::text,r.compatibility_profile_key from form_releases r join forms f on f.id=r.form_id left join form_catalog_metadata cm on cm.form_id=f.id where r.form_id=? and cm.archived_at is null order by r.version desc limit"
              + " 1",
          (rs, n) -> new R((UUID) rs.getObject(1), rs.getString(2), rs.getString(3)),
          form);
    } catch (EmptyResultDataAccessException e) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No published release");
    }
  }

  /** Archived forms remain readable for existing respondent sessions only. */
  private void requireCatalogActive(UUID form) {
    if (db.queryForObject("select count(*) from form_catalog_metadata where form_id=? and archived_at is not null", Integer.class, form) > 0)
      throw new ResponseStatusException(HttpStatus.CONFLICT, "FORM_ARCHIVED");
  }

  private void requireNewWriteAllowed(String recordType, UUID id) {
    String table = "FORM".equals(recordType) ? "forms" : "form_releases";
    String profileKey =
        db.queryForObject(
            "select compatibility_profile_key from " + table + " where id=?", String.class, id);
    boolean quarantined =
        Boolean.TRUE.equals(
            db.queryForObject(
                "select exists(select 1 from record_migration_state where record_type=? and"
                    + " record_key=? and state='QUARANTINED')",
                Boolean.class,
                recordType,
                id.toString()));
    if (quarantined
        || !profiles.find(profileKey).map(CompatibilityProfile::newWriteAllowed).orElse(false)) {
      if ("RELEASE".equals(recordType)) {
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No published release");
      }
      throw bad(
          "PROFILE_WRITE_FORBIDDEN", "This compatibility profile cannot create new releases.");
    }
  }

  private F formRow(UUID id) {
    try {
      return db.queryForObject(
          "select id,revision,definition::text from forms where id=?",
          (rs, n) -> new F((UUID) rs.getObject(1), rs.getLong(2), rs.getString(3)),
          id);
    } catch (Exception e) {
      throw missing();
    }
  }

  private Map<String, Object> sessionView(S s) {
    Map<String, Object> definition = parse(release(s.releaseId()).pkg());
    JsonNode definitionNode = json.valueToTree(definition);
    requireCanonicalRuntimeState(s, definitionNode);
    Object answers;
    List<Map<String, Object>> invalidInputs = List.of();
    if (typedRuntime.canonical(definitionNode)) {
      var outcome = typedRuntime.mutate(definitionNode, json.valueToTree(parse(s.answers())),
          parseNode(s.runtimeState()), List.of(), null, s.sessionDate().toString(), s.timeZone(), s.locale(), Instant.now());
      answers = outcome.answers();
      invalidInputs = bindInvalidMarkerRevisions(
          null, parseNode(s.runtimeState()), outcome.validation(), s.revision()).stream()
          .filter(item -> "UNPARSEABLE_INPUT".equals(item.get("code"))).toList();
    } else {
      answers = new FormRuntime(json, s.sessionDate().toString(), s.timeZone())
          .calculatedAnswers(definition, parse(s.answers()));
    }
    Map<String, Object> response = new LinkedHashMap<>(Map.of(
        "sessionId",
        s.id(),
        "revision",
        s.revision(),
        "answers",
        answers,
        "status",
        s.status(),
        "runtimeManifest",
        Map.of("sessionDate", s.sessionDate().toString(), "timeZone", s.timeZone(),
            "timeZoneDatabaseVersion", s.tzdbVersion()),
        "definition",
        definition));
    response.put("invalidInputs", invalidInputs);
    return response;
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> parse(String s) {
    try {
      return json.readValue(s, Map.class);
    } catch (Exception e) {
      throw new IllegalArgumentException(e);
    }
  }

  private String stringify(Object o) {
    try {
      return json.writeValueAsString(o);
    } catch (Exception e) {
      throw new IllegalArgumentException(e);
    }
  }

  private JsonNode parseNode(String value) {
    if (value == null) return null;
    try {
      return json.readTree(value);
    } catch (Exception e) {
      throw new IllegalArgumentException(e);
    }
  }

  @SuppressWarnings("unchecked")
  private List<Map<String, Object>> bindInvalidMarkerRevisions(
      Map<String, Object> runtimeState, JsonNode previousRuntimeState,
      List<Map<String, Object>> validation, long acceptedRevision) {
    Map<String, Object> previous = previousRuntimeState != null
        && previousRuntimeState.path("invalidInputRevisions").isObject()
            ? json.convertValue(previousRuntimeState.path("invalidInputRevisions"), Map.class) : Map.of();
    Map<String, Object> revisions = new LinkedHashMap<>();
    List<Map<String, Object>> result = new ArrayList<>();
    for (Map<String, Object> item : validation) {
      if (!"UNPARSEABLE_INPUT".equals(item.get("code"))) {
        result.add(item);
        continue;
      }
      String key = CanonicalJson.sha256(json.valueToTree(Map.of(
          "fieldId", item.get("fieldId"), "rowPath", item.getOrDefault("rowPath", List.of()))));
      long revision = previous.get(key) instanceof Number number ? number.longValue() : acceptedRevision;
      revisions.put(key, revision);
      Map<String, Object> authoritative = new LinkedHashMap<>(item);
      authoritative.put("markedAtRevision", revision);
      result.add(Map.copyOf(authoritative));
    }
    if (runtimeState != null) runtimeState.put("invalidInputRevisions", revisions);
    return List.copyOf(result);
  }

  private Map<String, Object> sampleDefinition(String key, String title) {
    Map<String, Object> name =
        Map.of("id", "full-name", "type", "text", "label", "Your full name", "required", true);
    Map<String, Object> contact =
        Map.of(
            "id",
            "contact-method",
            "type",
            "choice",
            "label",
            "Preferred contact method",
            "required",
            true,
            "options",
            List.of(
                Map.of("id", "email", "label", "Email"), Map.of("id", "phone", "label", "Phone")));
    Map<String, Object> email =
        Map.of(
            "id",
            "email-address",
            "type",
            "text",
            "label",
            "Email address",
            "required",
            true,
            "visibleWhen",
            Map.of("fieldId", "contact-method", "equals", "email"));
    return Map.of(
        "contractVersion",
        "4.0.0",
        "formKey",
        key,
        "title",
        title,
        "pages",
        List.of(
            Map.of(
                "id",
                "page-intake",
                "title",
                "Tell us about yourself",
                "fields",
                List.of(name, contact, email))));
  }

  /** New authoring forms start canonical; legacy definitions remain readable but are never silently rewritten. */
  private Map<String, Object> canonicalSampleDefinition(String key, String title) {
    Map<String,Object> root = new LinkedHashMap<>();
    root.put("schemaVersion", "4.0.0"); root.put("engineContract", "4.0.0"); root.put("contractVersion", "4.0.0");
    root.put("kind", "smart-form-package"); root.put("formKey", key); root.put("definitionVersion", "1.0.0");
    root.put("titleKey", "form.title"); root.put("descriptionKey", "form.description"); root.put("defaultLocale", "en"); root.put("supportedLocales", List.of("en"));
    root.put("data", Map.of("fields", List.of(Map.of("id","fld_name","key","name","type","text","labelKey","q.name","sensitivity","personal","mode","input","hiddenRetention","clear","normalizer","preserve","constraints",Map.of("required",true,"maxLength",120)))));
    root.put("flow", Map.of("startPageId","page_name","phases",List.of(Map.of("id","phase_request","titleKey","form.title","pages",List.of(
        Map.of("id","page_name","titleKey","q.name","sections",List.of(Map.of("id","section_name","titleKey","q.name","layout","stack","nodes",List.of(Map.of("id","node_name","kind","question","fieldId","fld_name","control","shortText")))),"routes",List.of(),"defaultNextPageId","page_review"),
        Map.of("id","page_review","titleKey","page.review","sections",List.of(Map.of("id","section_review","titleKey","page.review","layout","stack","nodes",List.of(Map.of("id","node_review","kind","review")))),"routes",List.of()))))));
    root.put("expressions",Map.of()); root.put("guidance",Map.of());
    root.put("translations",Map.of("en",Map.of("direction","ltr","reviewState","approved","messages",Map.of("form.title",title,"form.description","A guided intake.","q.name","Full name","page.review","Review and submit","confirmation","Your response has been received."),"pronunciations",List.of())));
    root.put("theme",Map.of("themeKey","accessible-default","version","1.0.0","tokens",Map.of("accent","#175CD3","background","#FFFFFF","text","#182230","fontFamily","system","density","comfortable","radius",8)));
    root.put("policies",Map.of("reviewBeforeSubmit",true,"draftExpiryDays",30,"showProgress",true,"presentation","grouped","guidanceMode","text","narrationAutoplay",false,"allowVoiceQuestions",false,"retentionPolicyKey","standard-intake","responseAccess","anonymous","confirmationKey","confirmation"));
    root.put("dependencies",List.of()); root.put("assets",List.of()); return root;
  }

  /** Canonical starter used by the isolated M7 migration path; legacy APIs retain their old shape. */
  public Map<String,Object> canonicalAuthoringTemplate(String key, String title) { return canonicalSampleDefinition(key,title); }

  private void validateDefinition(Map<String, Object> d) {
    try {
      var candidate = json.valueToTree(d);
      if (candidate.has("schemaVersion") || candidate.has("engineContract") || candidate.has("data")) {
        var result = compiler.compile(candidate);
        if (!result.valid()) {
          var diagnostic = result.diagnostics().get(0);
          throw new IllegalArgumentException(diagnostic.code() + " at " + diagnostic.pointer());
        }
      } else {
        definitions.validateCurrentLite(candidate);
      }
    } catch (IllegalArgumentException e) {
      throw bad(e.getMessage(), "Invalid field registry, page, or rule AST.");
    }
  }

  private String profileForDefinition(Map<String, Object> definition) {
    return typedRuntime.canonical(json.valueToTree(definition))
        ? CompatibilityProfile.CANONICAL_4_0_0.key()
        : CompatibilityProfile.M1_CURRENT_PROTOTYPE.key();
  }

  private void requireCanonicalRuntimeState(S session, JsonNode definition) {
    if (typedRuntime.canonical(definition)) {
      db.update("update form_releases set runtime_manifest=cast(? as jsonb) where id=? and runtime_manifest is null",
          stringify(runtimeManifest(definition)), session.releaseId());
      if (session.revision() > 0 && session.runtimeState() == null)
        throw new ResponseStatusException(HttpStatus.CONFLICT, "CANONICAL_RUNTIME_STATE_REQUIRED");
    }
  }

  private List<Map<String, Object>> validateAnswers(
      String definition, Map<String, Object> answers, S session) {
    if (!TimeZoneRegistry.VERSION.equals(session.tzdbVersion())) {
      throw bad("TIMEZONE_DATABASE_UNSUPPORTED", "Session runtime manifest is unsupported");
    }
    JsonNode definitionNode = json.valueToTree(parse(definition));
    if (typedRuntime.canonical(definitionNode)) {
      return typedRuntime.mutate(definitionNode, json.valueToTree(answers), List.of(),
          session.sessionDate().toString(), session.timeZone(), Instant.now()).validation();
    }
    return new FormRuntime(json, session.sessionDate().toString(), session.timeZone())
        .validate(parse(definition), answers);
  }

  private void audit(String a, UUID id) {
    audits.record(a, id);
  }

  private String etag(long rev) {
    return "\"" + rev + "\"";
  }

  private ResponseStatusException bad(String c, String d) {
    return new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, c + ": " + d);
  }

  private ResponseStatusException missing() {
    return new ResponseStatusException(HttpStatus.NOT_FOUND, "Resource not found");
  }

  private ResponseEntity<?> receipt(UUID submissionId) {
    return ResponseEntity.status(201)
        .body(
            Map.of(
                "receiptId",
                submissionId,
                "submissionId",
                submissionId,
                "message",
                "Your response has been received."));
  }
}
