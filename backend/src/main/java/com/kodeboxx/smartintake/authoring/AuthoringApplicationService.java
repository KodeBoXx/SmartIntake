package com.kodeboxx.smartintake.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.kodeboxx.smartintake.contract.CanonicalJson;
import com.kodeboxx.smartintake.application.IntakeApplicationService;
import com.kodeboxx.smartintake.contract.compiler.CompilationDiagnostic;
import com.kodeboxx.smartintake.contract.compiler.FormCompiler;
import com.kodeboxx.smartintake.contract.runtime.TypedSessionRuntimeService;
import com.kodeboxx.smartintake.security.AdministrationMutationExecutor;
import com.kodeboxx.smartintake.security.IdentitySessionResolver;
import com.kodeboxx.smartintake.security.StaffAuthorization;
import com.kodeboxx.smartintake.speech.SpeechPort;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;

/**
 * M7 authoring metadata and commands. The only editable package is forms.definition; this class
 * intentionally has no session, submission, outbox, email, webhook, or speech-provider dependency.
 */
@Service
public class AuthoringApplicationService {
  private static final int MAX_COMMANDS = 1_000;
  private static final int MAX_POINTER = 1000;
  private static final int MAX_JSON_NODES = 100_000;
  private static final int MAX_JSON_DEPTH = 64;
  private static final int MAX_STRING_LENGTH = 32_768;
  private final JdbcTemplate db;
  private final ObjectMapper json;
  private final StaffAuthorization authorization;
  private final IdentitySessionResolver sessions;
  private final FormCompiler compiler;
  private final SpeechPort speech;
  private final TypedSessionRuntimeService runtime;
  private final AdministrationMutationExecutor replays;
  private final IntakeApplicationService intake;
  private final Clock clock;
  @Value("${smartintake.speech.user-daily-quota:100}") private int speechUserDailyQuota;
  @Value("${smartintake.speech.tenant-daily-quota:1000}") private int speechTenantDailyQuota;

  public AuthoringApplicationService(JdbcTemplate db, ObjectMapper json, StaffAuthorization authorization,
      IdentitySessionResolver sessions, FormCompiler compiler, SpeechPort speech) {
    this(db, json, authorization, sessions, compiler, speech, null, null, null, Clock.systemUTC());
  }

  @Autowired
  public AuthoringApplicationService(JdbcTemplate db, ObjectMapper json, StaffAuthorization authorization,
      IdentitySessionResolver sessions, FormCompiler compiler, SpeechPort speech,
      TypedSessionRuntimeService runtime, AdministrationMutationExecutor replays, IntakeApplicationService intake) {
    this(db, json, authorization, sessions, compiler, speech, runtime, replays, intake, Clock.systemUTC());
  }
  AuthoringApplicationService(JdbcTemplate db, ObjectMapper json, StaffAuthorization authorization,
      IdentitySessionResolver sessions, FormCompiler compiler, SpeechPort speech,
      TypedSessionRuntimeService runtime, AdministrationMutationExecutor replays, IntakeApplicationService intake, Clock clock) {
    this.db = db;
    this.json = json;
    this.authorization = authorization;
    this.sessions = sessions;
    this.compiler = compiler;
    this.speech = speech;
    this.runtime = runtime;
    this.replays = replays;
    this.intake = intake;
    this.clock = clock;
    // Spring MVC uses this shared mapper before binding authoring Maps; reject ambiguous imports.
    this.json.enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
  }

  public ResponseEntity<?> document(String workspace, UUID form, String draft, String token) {
    authorizeRead(workspace, form, draft, token);
    Row row = row(form);
    JsonNode definition = parse(row.definition());
    return ResponseEntity.ok().eTag(etag(row.revision())).body(Map.of(
        "formId", form, "draftId", draft, "revision", row.revision(), "etag", etag(row.revision()),
        "definition", definition, "packageHash", CanonicalJson.sha256(definition),
        "diagnostics", diagnostics(definition), "history", historySummary(form, draft)));
  }

  @Transactional
  public ResponseEntity<?> commands(String workspace, UUID form, String draft, String token, String match,
      String idempotencyKey, Map<String, Object> request) {
    authorizeWrite(workspace, form, draft, token);
    UUID author = actor(token);
    if (replays == null) return commandsInternal(form, draft, match, request, author);
    return replays.execute(author, "authoring:" + form + ":" + draft, "authoring-command-batch",
        idempotencyKey, map("ifMatch", match, "request", request),
        () -> commandsInternal(form, draft, match, request, author));
  }

  private ResponseEntity<?> commandsInternal(UUID form, String draft, String match,
      Map<String, Object> request, UUID author) {
    Row current = row(form);
    JsonNode client = request.containsKey("definition") ? json.valueToTree(request.get("definition")) : parse(current.definition());
    if (!matches(match, current.revision())) return stale(form, draft, current, clientFor(request, current), match);
    List<Map<String, Object>> commands = maps(request.get("commands"));
    if (commands.isEmpty() || commands.size() > MAX_COMMANDS) throw bad("COMMAND_LIMIT", "A batch must contain 1-1000 commands.");
    List<Map<String,Object>> previousProblems=diagnostics(parse(current.definition()));
    JsonNode next = parse(current.definition());
    List<Map<String, Object>> inverses = new ArrayList<>();
    LinkedHashSet<String> removedFieldIds = new LinkedHashSet<>();
    for (Map<String, Object> command : commands) {
      checkCommand(command);
      if ("remove".equals(String.valueOf(command.get("op"))) && String.valueOf(command.get("path")).startsWith("/data/fields/"))
        collectFieldIds(at(next, String.valueOf(command.get("path"))), removedFieldIds);
      Applied applied = apply(next, command);
      next = applied.document();
      inverses.add(0, applied.inverse());
    }
    requireBounded(next);
    if (request.containsKey("expectedHash") && !CanonicalJson.sha256(parse(current.definition())).equals(request.get("expectedHash")))
      return stale(form, draft, current, clientFor(request, current), match);
    // The repair escape hatch is deliberately narrower than a compiler bypass: only a
    // clean draft whose exact batch removed declared fields may retain the newly broken
    // expression references to those fields. Schema, route, locale, duplicate-ID and
    // pre-existing failures all remain hard errors.
    List<Map<String,Object>> nextProblems=diagnostics(next);
    JsonNode candidate=next;
    boolean acceptedBrokenReferenceDraft = Boolean.TRUE.equals(request.get("acceptInvalidDraft"))
        && previousProblems.isEmpty() && acceptsOnlyRemovedFieldReferences(candidate, nextProblems, removedFieldIds);
    if (!nextProblems.isEmpty() && !acceptedBrokenReferenceDraft) requireCompilable(next);
    return persist(form, draft, current, next, author, "COMMAND_BATCH",
        Map.of("commands", commands), Map.of("commands", inverses),
        acceptanceForTransition(form, draft, current, acceptedBrokenReferenceDraft ? removedFieldIds : Set.of()));
  }

  public List<Map<String, Object>> history(String workspace, UUID form, String draft, String token) {
    authorizeRead(workspace, form, draft, token);
    return db.query("select id,revision,command_id,operation,before_hash,after_hash,undone_at,created_at from form_authoring_history where form_id=? and draft_id=? order by created_at desc limit 200",
        (rs, n) -> map("id", rs.getObject("id").toString(), "revision", rs.getLong("revision"),
            "commandId", rs.getString("command_id"), "operation", rs.getString("operation"),
            "beforeHash", rs.getString("before_hash"), "afterHash", rs.getString("after_hash"),
            "undone", rs.getObject("undone_at") != null, "createdAt", rs.getObject("created_at").toString()), form, UUID.fromString(draft));
  }

  @Transactional
  public ResponseEntity<?> undo(String workspace, UUID form, String draft, String token, String match, String idempotencyKey) {
    authorizeWrite(workspace, form, draft, token); UUID author=actor(token);
    if(replays==null)return undoInternal(form,draft,match,author);
    return replays.execute(author,"authoring:"+form+":"+draft,"authoring-undo",idempotencyKey,map("ifMatch",match),()->undoInternal(form,draft,match,author));
  }
  private ResponseEntity<?> undoInternal(UUID form, String draft, String match, UUID author) {
    Row current = row(form);
    if (!matches(match, current.revision())) return stale(form, draft, current, parse(current.definition()), match);
    History history = db.query("select id,inverse_command::text,command::text,invalid_draft_acceptance::text from form_authoring_history where form_id=? and draft_id=? and undone_at is null and operation not in ('UNDO','REDO') order by created_at desc limit 1",
        rs -> rs.next() ? new History((UUID) rs.getObject(1), rs.getString(2), rs.getString(3), rs.getString(4)) : null, form, UUID.fromString(draft));
    if (history == null) throw bad("UNDO_EMPTY", "Nothing to undo.");
    JsonNode next = applyBatch(parse(current.definition()), parse(history.inverse()));
    ResponseEntity<?> result = persist(form, draft, current, next, author, "UNDO", parse(history.inverse()), parse(history.command()), historyAcceptance(history.metadata()).swapped());
    if (result.getStatusCode().is2xxSuccessful()) db.update("update form_authoring_history set undone_at=now() where id=?", history.id());
    return result;
  }

  @Transactional
  public ResponseEntity<?> redo(String workspace, UUID form, String draft, String token, String match, String idempotencyKey) {
    authorizeWrite(workspace, form, draft, token); UUID author=actor(token);
    if(replays==null)return redoInternal(form,draft,match,author);
    return replays.execute(author,"authoring:"+form+":"+draft,"authoring-redo",idempotencyKey,map("ifMatch",match),()->redoInternal(form,draft,match,author));
  }
  private ResponseEntity<?> redoInternal(UUID form, String draft, String match, UUID author) {
    Row current = row(form);
    if (!matches(match, current.revision())) return stale(form, draft, current, parse(current.definition()), match);
    History history = db.query("select id,inverse_command::text,command::text,invalid_draft_acceptance::text from form_authoring_history where form_id=? and draft_id=? and undone_at is not null and operation not in ('UNDO','REDO') order by undone_at desc limit 1",
        rs -> rs.next() ? new History((UUID) rs.getObject(1), rs.getString(2), rs.getString(3), rs.getString(4)) : null, form, UUID.fromString(draft));
    if (history == null) throw bad("REDO_EMPTY", "Nothing to redo.");
    JsonNode next = applyBatch(parse(current.definition()), parse(history.command()));
    ResponseEntity<?> result = persist(form, draft, current, next, author, "REDO", parse(history.command()), parse(history.inverse()), historyAcceptance(history.metadata()));
    if (result.getStatusCode().is2xxSuccessful()) db.update("update form_authoring_history set undone_at=null where id=?", history.id());
    return result;
  }

  @Transactional
  public ResponseEntity<?> resolve(String workspace, UUID form, String draft, String token, String match,
      String idempotencyKey, Map<String, Object> request) {
    authorizeWrite(workspace, form, draft, token); Row current = row(form);
    UUID author = actor(token);
    if (replays != null) return replays.execute(author, "authoring:" + form + ":" + draft,
        "authoring-conflict-resolve", idempotencyKey, map("ifMatch", match, "request", request),
        () -> resolveInternal(form, draft, match, request, author));
    return resolveInternal(form, draft, match, request, author);
  }

  private ResponseEntity<?> resolveInternal(UUID form, String draft, String match, Map<String, Object> request,
      UUID author) {
    Row current = row(form);
    UUID conflictId = UUID.fromString(required(request, "conflictId"));
    JsonNode chosen = json.valueToTree(request.get("definition")); requireBounded(chosen);
    if (!matches(match, current.revision())) return stale(form, draft, current, chosen, match);
    Integer found = db.queryForObject("select count(*) from form_authoring_conflicts where id=? and form_id=? and resolved_at is null", Integer.class, conflictId, form);
    if (found == null || found != 1) throw bad("CONFLICT_NOT_FOUND", "Conflict is unavailable.");
    ResponseEntity<?> result = persist(form, draft, current, chosen, author, "CONFLICT_RESOLVE", Map.of("definition", stringify(chosen)), Map.of("definition", current.definition()), acceptanceForTransition(form, draft, current, Set.of()));
    if (result.getStatusCode().is2xxSuccessful()) db.update("update form_authoring_conflicts set resolved_at=now() where id=?", conflictId);
    return result;
  }

  @Transactional
  public Map<String, Object> validateImport(String workspace, UUID form, String draft, String token, Map<String, Object> request) {
    authorizeWrite(workspace, form, draft, token); Row current = row(form);
    JsonNode candidate = json.valueToTree(request.get("candidate")); requireBounded(candidate);
    String digest = CanonicalJson.sha256(candidate); List<Map<String, Object>> results = diagnostics(candidate);
    String state = results.isEmpty() ? "VALID" : "INVALID"; UUID id = UUID.randomUUID();
    db.update("insert into form_import_candidates(id,form_id,draft_id,base_revision,candidate_digest,candidate,diagnostics,state,created_by,policy_hash,expires_at) values(?,?,?,?,?,cast(? as jsonb),cast(? as jsonb),?,?,?,now()+interval '30 minutes')",
        id, form, UUID.fromString(draft), current.revision(), digest, stringify(candidate), stringify(json.valueToTree(results)), state, actor(token), effectivePolicyHash(form));
    return map("candidateId", id.toString(), "digest", digest, "baseRevision", current.revision(), "state", state, "diagnostics", results);
  }

  @Transactional
  public ResponseEntity<?> commitImport(String workspace, UUID form, String draft, String token, String match, String idempotencyKey, Map<String, Object> request) {
    authorizeWrite(workspace, form, draft, token); Row current = row(form);
    UUID author=actor(token);
    if(replays!=null) return replays.execute(author,"authoring:"+form+":"+draft,"authoring-import-commit",idempotencyKey,map("ifMatch",match,"request",request),()->commitImportInternal(form,draft,match,request,author));
    return commitImportInternal(form,draft,match,request,author);
  }
  private ResponseEntity<?> commitImportInternal(UUID form,String draft,String match,Map<String,Object> request,UUID author) {
    Row current=row(form); Candidate candidate = db.query("select base_revision,candidate_digest,candidate::text,state,policy_hash from form_import_candidates where id=? and form_id=? and draft_id=? and created_by=? and expires_at>now()",
        rs -> rs.next() ? new Candidate(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4),rs.getString(5)) : null,
        UUID.fromString(required(request, "candidateId")), form, UUID.fromString(draft),author);
    if (candidate == null || !"VALID".equals(candidate.state())) throw bad("IMPORT_CANDIDATE_INVALID", "Validate a current valid candidate first.");
    if (!matches(match, current.revision()) || candidate.baseRevision() != current.revision() || !candidate.digest().equals(request.get("digest")) || !candidate.policyHash().equals(effectivePolicyHash(form)))
      return stale(form, draft, current, parse(candidate.json()), match);
    JsonNode next = parse(candidate.json());
    String mode = String.valueOf(request.getOrDefault("mode", "UPDATE"));
    if ("COPY".equals(mode)) next = remapIds(next); else if (!"UPDATE".equals(mode)) throw bad("IMPORT_MODE_INVALID", "Mode must be UPDATE or COPY.");
    ResponseEntity<?> result = persist(form, draft, current, next, author, "IMPORT_" + mode,
        Map.of("definition", stringify(next), "candidateDigest", candidate.digest(), "mode", mode), Map.of("definition", current.definition()), acceptanceForTransition(form, draft, current, Set.of()));
    if (result.getStatusCode().is2xxSuccessful()) db.update("delete from form_import_candidates where id=? and created_by=?", UUID.fromString(required(request,"candidateId")),author);
    return result;
  }

  public ResponseEntity<?> theme(String workspace, UUID form, String draft, String token) {
    authorizeRead(workspace, form, draft, token); Row row = row(form); JsonNode root = parse(row.definition());
    return ResponseEntity.ok().eTag(etag(row.revision())).body(map("revision", row.revision(), "theme", at(root, "/theme"),
        "locks", themeLocks(form, draft), "preflight", themePreflight(root)));
  }
  public ResponseEntity<?> content(String workspace, UUID form, String draft, String token) {
    Map<String,Object> content = documentBody(workspace, form, draft, token, "/guidance", "/translations");
    content.put("localeCompleteness", localeCompleteness((JsonNode) content.get("translations")));
    content.put("localeReviews", db.query("select locale,source_revision,status,reviewed_at from form_authoring_locale_reviews where form_id=? and draft_id=? order by locale",(rs,n)->map("locale",rs.getString(1),"sourceRevision",rs.getLong(2),"status",rs.getString(3),"reviewedAt",rs.getObject(4).toString()),form,UUID.fromString(draft)));
    return ResponseEntity.ok(content);
  }
  @Transactional public ResponseEntity<?> updateTheme(String w, UUID f, String d, String t, String m,
      String idempotencyKey, Map<String, Object> body) {
    boolean administratorLocks = body.containsKey("locks");
    if (administratorLocks) {
      UUID workspaceId=authorization.authorizeWorkspaceAdministration(w,t);
      draft(f,d); requireFormInWorkspace(workspaceId,f); requireAuthoringWritable(f);
    } else authorizeWrite(w,f,d,t);
    UUID author = actor(t);
    if (replays != null) return replays.execute(author, "authoring:" + f + ":" + d,
        "authoring-theme-update", idempotencyKey, map("ifMatch", m, "request", body),
        () -> updateThemeInternal(w, f, d, t, m, body, administratorLocks, author));
    return updateThemeInternal(w, f, d, t, m, body, administratorLocks, author);
  }

  private ResponseEntity<?> updateThemeInternal(String w, UUID f, String d, String t, String m,
      Map<String, Object> body, boolean administratorLocks, UUID author) {
    JsonNode before = at(parse(row(f).definition()), "/theme"); JsonNode next = json.valueToTree(body.get("theme"));
    for (String lock : themeLocks(f, d)) if (!at(before, lock).equals(at(next, lock)))
      throw bad("THEME_LOCKED", "Theme token is locked: " + lock);
    ResponseEntity<?> saved;
    if (administratorLocks) {
      Row current = row(f);
      if (!matches(m, current.revision())) return stale(f, d, current, parse(current.definition()), m);
      saved = persist(f, d, current, apply(parse(current.definition()), map("op", "set", "path", "/theme", "value", next)).document(), author, "THEME_UPDATE", Map.of("theme", next), Map.of("theme", before));
    } else saved = updateSubdocument(w, f, d, t, m, "/theme", next);
    if (saved.getStatusCode().is2xxSuccessful() && administratorLocks) replaceThemeLocks(f, d, t, body.get("locks"));
    return saved;
  }
  @Transactional public ResponseEntity<?> updateContent(String w, UUID f, String d, String t, String m,
      String idempotencyKey, Map<String, Object> body) {
    draft(f,d);
    boolean approval = body.containsKey("approveLocales");
    if (approval) authorization.requireReviewForm(w, t, f); else if (body.containsKey("guidance")) authorization.requireGuidanceForm(w,t,f); else authorization.requireTranslationForm(w,t,f);
    requireAuthoringWritable(f);
    UUID author = actor(t);
    if (replays != null) return replays.execute(author, "authoring:" + f + ":" + d,
        "authoring-content-update", idempotencyKey, map("ifMatch", m, "request", body),
        () -> updateContentInternal(w, f, d, t, m, body, author));
    return updateContentInternal(w, f, d, t, m, body, author);
  }

  private ResponseEntity<?> updateContentInternal(String w, UUID f, String d, String t, String m,
      Map<String, Object> body, UUID author) {
    boolean guidance = body.containsKey("guidance"); boolean translations = body.containsKey("translations"); boolean approval = body.containsKey("approveLocales");
    if (approval) {
      Row current=row(f); if(!matches(m,current.revision()))return stale(f,d,current,parse(current.definition()),m);
      JsonNode locales=json.valueToTree(body.get("approveLocales")); if(!locales.isArray())throw bad("LOCALE_APPROVAL_INVALID","approveLocales must be an array.");
      String packageHash=CanonicalJson.sha256(parse(current.definition()));
      for(JsonNode locale:locales){if(!locale.isTextual())throw bad("LOCALE_APPROVAL_INVALID","Locale must be textual.");int changed=db.update("update form_authoring_locale_reviews set status='APPROVED',reviewed_by=?,reviewed_at=now(),source_package_hash=? where form_id=? and draft_id=? and locale=? and source_revision=? and source_package_hash=? and status='DRAFT'",author,packageHash,f,UUID.fromString(d),locale.asText(),current.revision(),packageHash);if(changed!=1)throw bad("LOCALE_APPROVAL_STALE","Locale is not an unreviewed current translation.");}
      return ResponseEntity.ok().eTag(etag(current.revision())).body(map("revision",current.revision(),"approved",locales));
    }
    if (guidance == translations || !guidance && !translations) throw bad("CONTENT_SCOPE_INVALID","Update guidance or translations in separate requests.");
    if (guidance) validateGuidanceReferences(json.valueToTree(body.get("guidance")));
    Map<String,Object> patch = new LinkedHashMap<>(); patch.put("commands", List.of(
        map("op", "set", "path", guidance?"/guidance":"/translations", "value", guidance?body.get("guidance"):body.get("translations"))));
    ResponseEntity<?> result=commandsInternal(f, d, m, patch, author);
    return result;
  }

  public List<Map<String, Object>> comments(String w, UUID f, String d, String t) {
    authorizeRead(w, f, d, t); return db.query("select id,pointer,body,author_account_id,created_at from form_authoring_comments where form_id=? and draft_id=? order by created_at", (rs,n) -> map("id",rs.getObject(1).toString(),"pointer",rs.getString(2),"body",rs.getString(3),"authorId",rs.getObject(4).toString(),"createdAt",rs.getObject(5).toString()), f, UUID.fromString(d));
  }
  @Transactional public ResponseEntity<?> comment(String w, UUID f, String d, String t, String idempotencyKey,
      Map<String,Object> body) {
    authorizeRead(w,f,d,t); UUID author=actor(t);
    if(replays != null) return replays.execute(author,"authoring:"+f+":"+d,"authoring-comment-create",idempotencyKey,
        body,()->commentInternal(f,d,body,author));
    return commentInternal(f,d,body,author);
  }
  private ResponseEntity<?> commentInternal(UUID f, String d, Map<String,Object> body, UUID author) {
    String pointer=required(body,"pointer"); String text=required(body,"body"); if(pointer.length()>MAX_POINTER || text.length()>4000) throw bad("COMMENT_LIMIT","Comment exceeds a limit."); UUID id=UUID.randomUUID(); db.update("insert into form_authoring_comments(id,form_id,draft_id,pointer,body,author_account_id) values(?,?,?,?,?,?)",id,f,UUID.fromString(d),pointer,text,author); return ResponseEntity.status(HttpStatus.CREATED).body(map("id",id.toString(),"pointer",pointer,"body",text));
  }
  public List<Map<String,Object>> presence(String w, UUID f, String d, String t) {
    authorizeRead(w,f,d,t); db.update("delete from form_authoring_presence where expires_at<=now()"); return db.query("select p.account_id,p.cursor_pointer,coalesce(a.display_name,a.email),p.expires_at from form_authoring_presence p join accounts a on a.id=p.account_id where p.form_id=? and p.draft_id=? order by p.updated_at",(rs,n)->map("accountId",rs.getObject(1).toString(),"cursor",rs.getString(2),"displayName",rs.getString(3),"expiresAt",rs.getObject(4).toString()),f,UUID.fromString(d));
  }
  public ResponseEntity<?> presence(String w, UUID f, String d, String t, Map<String,Object> body) {
    authorizeRead(w,f,d,t); String cursor=String.valueOf(body.getOrDefault("cursor", "")); if(cursor.length()>MAX_POINTER) throw bad("PRESENCE_LIMIT","Cursor pointer is too long."); UUID account=actor(t); String displayName=db.queryForObject("select coalesce(display_name,email) from accounts where id=?",String.class,account); db.update("insert into form_authoring_presence(form_id,draft_id,account_id,cursor_pointer,display_name,expires_at) values(?,?,?,?,?,now()+interval '90 seconds') on conflict(form_id,draft_id,account_id) do update set cursor_pointer=excluded.cursor_pointer,display_name=excluded.display_name,expires_at=excluded.expires_at,updated_at=now()",f,UUID.fromString(d),account,cursor,displayName); return ResponseEntity.noContent().build();
  }

  /** Synthetic state is projected through the same canonical runtime without durable respondent effects. */
  public Map<String,Object> preview(String w, UUID f, String d, String t, Map<String,Object> request) {
    authorizeRead(w,f,d,t); JsonNode definition=parse(row(f).definition()); JsonNode answers=json.valueToTree(request.getOrDefault("answers",Map.of()));
    List<Map<String,Object>> errors=diagnostics(definition); Map<String,Object> projection=Map.of();
    if (errors.isEmpty() && runtime != null) {
      String locale = boundedChoice(request.get("locale"), List.of("en", "hi", "ar"), "en");
      String timezone = boundedTimezone(request.get("timezone"));
      String sessionDate = boundedDate(request.get("sessionDate"), timezone);
      String device = boundedDevice(request.get("device"));
      var outcome=runtime.mutate(definition, json.createObjectNode(), null, previewOperations(answers), null,
          sessionDate, timezone, locale, clock.instant());
      errors=outcome.validation(); projection=map("answers",outcome.answers(),"review",outcome.reviewProjection(),
          "reachablePageIds",outcome.reachablePageIds(),"requiredCount",outcome.requiredCount(),
          "completedRequiredCount",outcome.completedRequiredCount(),"accepted",outcome.accepted(),
          "locale", locale, "timezone", timezone, "device", device, "sessionDate", sessionDate);
    }
    return map("mode","synthetic", "packageHash",CanonicalJson.sha256(definition), "diagnostics",errors,
        "projection",projection, "effects",Map.of("sessions",0,"submissions",0,"email",0,"webhooks",0,"providers",0));
  }

  /** The authoring UI supplies plain field/value JSON, which follows the respondent set-operation path. */
  private List<Map<String,Object>> previewOperations(JsonNode answers) {
    if (!answers.isObject()) throw bad("PREVIEW_ANSWERS_INVALID", "Synthetic answers must be a JSON object.");
    List<Map<String,Object>> operations=new ArrayList<>();
    answers.fields().forEachRemaining(entry -> {
      if (operations.size() >= TypedSessionRuntimeService.MAX_OPERATIONS_PER_BATCH)
        throw bad("PREVIEW_ANSWERS_LIMIT", "Synthetic answers exceed the operation limit.");
      operations.add(map("op","set","fieldId",entry.getKey(),"value",entry.getValue()));
    });
    return operations;
  }

  @Transactional
  public Map<String,Object> speech(String w, UUID f, String d, String t, Map<String,Object> request) {
    authorizeRead(w, f, d, t);
    String locale = required(request, "locale");
    Row current=row(f);
    JsonNode definition=parse(current.definition());
    boolean questionRequest = request.containsKey("question");
    Object scope = request.get("scope");
    if (scope == null) throw bad("SPEECH_SCOPE_REQUIRED", "Speech requires the visible canonical scope.");
    String text = questionRequest
        ? governedAnswer(definition, locale, required(request, "question"), scope)
        : governedNarration(definition, locale, scope);
    if (text == null) return unavailable(locale, questionRequest ? "SPEECH_QUESTION_NOT_FOUND" : "SPEECH_NARRATION_NOT_FOUND");
    String voice = request.containsKey("voice") ? required(request, "voice") : speech.defaultVoice(locale);
    if(!List.of("en","hi","ar").contains(locale)||text.length()>4_000||!supportsLocale(definition, locale))
      throw bad("SPEECH_GOVERNANCE", "Speech locale or voice is not governed by the package.");
    if (!speech.configured()) return unavailable(locale, "SPEECH_UNAVAILABLE");
    if (voice == null || !speech.approvedVoice(locale, voice)) return unavailable(locale, "SPEECH_VOICE_UNAVAILABLE");
    // Speech is a governed rendering of the exact approved package revision, never a draft preview.
    if (!trustedLocaleApproved(f, d, locale, current, definition)) return unavailable(locale, "SPEECH_LOCALE_UNAPPROVED");
    UUID author = actor(t);
    if (!reserveSpeechQuota(f, author)) return unavailable(locale, "SPEECH_QUOTA_EXHAUSTED");
    SpeechPort.SpeechResult result = speech.synthesize(text, locale, voice);
    if (!result.available()) return unavailable(locale, result.code());
    return map("available",true,"locale",locale,"contentType",result.contentType(),"audioBase64",Base64.getEncoder().encodeToString(result.audio()),"latencyMillis",result.latencyMillis());
  }

  public List<Map<String,Object>> components(String w,String token) { UUID ws=authorization.authorizeAuthoring(w,token); return db.query("select id,component_key,name,version,status,fragment_hash,updated_at from reusable_components where workspace_id=? order by component_key,version desc",(rs,n)->map("id",rs.getObject(1).toString(),"key",rs.getString(2),"name",rs.getString(3),"version",rs.getInt(4),"status",rs.getString(5),"hash",rs.getString(6),"updatedAt",rs.getObject(7).toString()),ws); }
  @Transactional public ResponseEntity<?> component(String w,String token,Map<String,Object> body) {
    UUID ws=authorization.authorizeAuthoring(w,token); String key=required(body,"key"); String name=required(body,"name"); JsonNode fragment=json.valueToTree(body.get("fragment")); requireBounded(fragment);
    db.queryForObject("select pg_advisory_xact_lock(hashtext(?))", (rs, row) -> 0, ws+":"+key);
    String hash=CanonicalJson.sha256(fragment); Component existing=db.query("select version,fragment::text,fragment_hash from reusable_components where workspace_id=? and component_key=? and fragment_hash=? order by version desc limit 1",rs->rs.next()?new Component(rs.getInt(1),rs.getString(2),rs.getString(3)):null,ws,key,hash);
    if(existing!=null)return ResponseEntity.ok().body(map("key",key,"version",existing.version(),"hash",existing.hash(),"fragment",parse(existing.fragment())));
    int version=db.queryForObject("select coalesce(max(version),0)+1 from reusable_components where workspace_id=? and component_key=?",Integer.class,ws,key); UUID id=UUID.randomUUID(); db.update("insert into reusable_components(id,workspace_id,component_key,name,version,fragment,fragment_hash,created_by) values(?,?,?,?,?,cast(? as jsonb),?,?)",id,ws,key,name,version,stringify(fragment),hash,actor(token)); return ResponseEntity.status(201).body(map("id",id.toString(),"key",key,"version",version,"hash",hash,"fragment",fragment)); }

  /** Copies one pinned component version into the canonical package; later catalog edits cannot alter it. */
  @Transactional public ResponseEntity<?> insertComponent(String w, UUID f, String d, String token, String match,
      String idempotencyKey, String componentKey, Map<String,Object> body) {
    authorizeWrite(w, f, d, token); UUID workspace = authorization.authorizeAuthoring(w, token); Row current = row(f);
    UUID author = actor(token);
    if (replays == null) return insertComponentInternal(f, d, match, componentKey, body, workspace, author);
    return replays.execute(author, "authoring:" + f + ":" + d, "authoring-component-insert", idempotencyKey,
        map("ifMatch", match, "componentKey", componentKey, "request", body),
        () -> insertComponentInternal(f, d, match, componentKey, body, workspace, author));
  }

  private ResponseEntity<?> insertComponentInternal(UUID f, String d, String match, String componentKey,
      Map<String,Object> body, UUID workspace, UUID author) {
    Row current = row(f);
    if (!matches(match, current.revision())) return stale(f, d, current, parse(current.definition()), match);
    Integer requested = body.get("version") instanceof Number number ? number.intValue() : null;
    Component component = db.query("select version,fragment::text,fragment_hash from reusable_components where workspace_id=? and component_key=? and status='ACTIVE' "
            + (requested == null ? "order by version desc limit 1" : "and version=?"), rs -> rs.next() ? new Component(rs.getInt(1),rs.getString(2),rs.getString(3)) : null,
        requested == null ? new Object[]{workspace,componentKey} : new Object[]{workspace,componentKey,requested});
    if (component == null) throw bad("COMPONENT_NOT_FOUND", "Reusable component version is unavailable.");
    String path = required(body, "path"); String operation = String.valueOf(body.getOrDefault("operation", "add"));
    if (!List.of("add", "replace").contains(operation)) throw bad("COMPONENT_OPERATION_INVALID", "Component operation must be add or replace.");
    Remapped copied = remapIds(parse(component.fragment()), f, current.revision(), component.hash()); requireBounded(copied.document());
    Applied applied = apply(parse(current.definition()), map("op",operation,"path",path,"value",copied.document()));
    JsonNode pinned=pinComponent(applied.document(),componentKey,component);
    ResponseEntity<?> result=persist(f, d, current, pinned, author, "COMPONENT_INSERT",
        map("componentKey",componentKey,"version",component.version(),"hash",component.hash(),"path",path,"operation",operation), applied.inverse());
    if(result.getStatusCode().is2xxSuccessful() && result.getBody() instanceof Map<?,?> bodyResult) {
      Map<String,Object> response=new LinkedHashMap<>((Map<String,Object>) bodyResult); response.put("idMap",copied.ids());
      return ResponseEntity.ok().eTag(result.getHeaders().getETag()).body(response);
    }
    return result;
  }

  private ResponseEntity<?> subdocument(String w,UUID f,String d,String t,String pointer) { return ResponseEntity.ok(documentBody(w,f,d,t,pointer)); }
  private Map<String,Object> documentBody(String w,UUID f,String d,String t,String... pointers) { authorizeRead(w,f,d,t); Row row=row(f); JsonNode root=parse(row.definition()); Map<String,Object> out=new LinkedHashMap<>(); out.put("revision",row.revision()); for(String pointer:pointers) out.put(pointer.substring(1),at(root,pointer)); return out; }
  private ResponseEntity<?> updateSubdocument(String w,UUID f,String d,String t,String match,String pointer,Object value) { authorizeWrite(w,f,d,t); return commandsInternal(f,d,match,map("commands",List.of(map("op","set","path",pointer,"value",value))),actor(t)); }

  private ResponseEntity<?> persist(UUID form,String draft,Row current,JsonNode next,UUID actor,String operation,Object command,Object inverse) {
    return persist(form, draft, current, next, actor, operation, command, inverse, acceptanceForTransition(form, draft, current, Set.of()));
  }
  /** Validates the next state only against the forward command acceptance. */
  private ResponseEntity<?> persist(UUID form,String draft,Row current,JsonNode next,UUID actor,String operation,Object command,Object inverse,HistoryAcceptance acceptance) {
    requireBounded(next); List<Map<String,Object>> problems=diagnostics(next);
    if (!problems.isEmpty() && !acceptsOnlyRemovedFieldReferences(next, problems, acceptance.commandRemovedFieldIds())) requireCompilable(next);
    long revision=current.revision()+1; String before=CanonicalJson.sha256(parse(current.definition())); String after=CanonicalJson.sha256(next);
    int updated=db.update("update forms set definition=cast(? as jsonb),revision=?,updated_at=now() where id=? and revision=?",stringify(next),revision,form,current.revision());
    if(updated!=1) return stale(form,draft,row(form),next,etag(current.revision()));
    // Reviews attest exact revision/hash/manifest bytes; every successful authoring mutation
    // invalidates prior attestations in this same transaction.
    db.update("update form_review_requests set state='INVALIDATED',invalidated_at=now() where form_id=? and state in ('OPEN','APPROVED')", form);
    if (!"UNDO".equals(operation) && !"REDO".equals(operation))
      db.update("delete from form_authoring_history where form_id=? and draft_id=? and undone_at is not null",form,UUID.fromString(draft));
    String acceptanceJson=acceptance.isEmpty() ? null : stringify(json.valueToTree(map(
        "command", map("removedFieldIds", acceptance.commandRemovedFieldIds().stream().sorted().toList()),
        "inverse", map("removedFieldIds", acceptance.inverseRemovedFieldIds().stream().sorted().toList()))));
    db.update("insert into form_authoring_history(id,form_id,draft_id,revision,command_id,actor_account_id,operation,command,inverse_command,before_hash,after_hash,invalid_draft_acceptance) values(?,?,?,?,?,?,?,cast(? as jsonb),cast(? as jsonb),?,?,cast(? as jsonb))",UUID.randomUUID(),form,UUID.fromString(draft),revision,UUID.randomUUID().toString(),actor,operation,stringify(json.valueToTree(command)),stringify(json.valueToTree(inverse)),before,after,acceptanceJson);
    persistLocaleReview(form, draft, next, actor, revision);
    return ResponseEntity.ok().eTag(etag(revision)).body(map("revision",revision,"etag",etag(revision),"definition",next,"packageHash",after,"diagnostics",problems,"draftState",problems.isEmpty()?"VALID":"INVALID","impact",impact(parse(current.definition()),next)));
  }

  private ResponseEntity<?> stale(UUID form,String draft,Row server,JsonNode client,String match) {
    UUID id=UUID.randomUUID(); JsonNode packageNode=parse(server.definition()); db.update("insert into form_authoring_conflicts(id,form_id,draft_id,expected_revision,actual_revision,client_hash,server_hash,client_package,server_package) values(?,?,?,?,?,?,?,cast(? as jsonb),cast(? as jsonb))",id,form,UUID.fromString(draft),expectedRevision(match),server.revision(),CanonicalJson.sha256(client),CanonicalJson.sha256(packageNode),stringify(client),stringify(packageNode));
    return ResponseEntity.status(HttpStatus.PRECONDITION_FAILED).eTag(etag(server.revision())).body(map("code","AUTHORING_CONFLICT","conflictId",id.toString(),"revision",server.revision(),"server",packageNode,"client",client,"impact",impact(client,packageNode)));
  }

  private JsonNode applyBatch(JsonNode root,JsonNode batch) { if (batch.isTextual()) return parse(batch.asText()); if (batch.path("definition").isTextual()) return parse(batch.path("definition").asText()); JsonNode current=root; JsonNode commands=batch.path("commands"); if(!commands.isArray()||commands.size()>MAX_COMMANDS) throw bad("COMMAND_LIMIT","Invalid history command."); for(JsonNode command:commands){ Map<String,Object> map=json.convertValue(command,Map.class); checkCommand(map); current=apply(current,map).document(); } return current; }
  private Applied apply(JsonNode root,Map<String,Object> command) {
    String op=String.valueOf(command.getOrDefault("op",command.get("operation"))).toLowerCase(); String path=required(command,"path"); JsonNode copy=root.deepCopy();
    if("remove".equals(op)){ JsonNode old=at(copy,path); if(old.isMissingNode()) throw bad("COMMAND_PATH_INVALID","Path does not exist."); remove(copy,path); return new Applied(copy,map("op","add","path",path,"value",old)); }
    if("move".equals(op)){ String from=required(command,"from"); JsonNode moved=at(copy,from); if(moved.isMissingNode()) throw bad("COMMAND_PATH_INVALID","Move source does not exist."); JsonNode overwritten="-".equals(lastToken(path))?json.getNodeFactory().missingNode():at(copy,path); boolean objectTarget=parent(copy,path).node() instanceof ObjectNode; remove(copy,from); String destination=effectiveAddPath(copy,path); put(copy,path,moved,true); Map<String,Object> moveBack=map("op","move","from",destination,"path",from); return new Applied(copy, objectTarget&&!overwritten.isMissingNode()?map("commands",List.of(moveBack,map("op","set","path",path,"value",overwritten))):moveBack); }
    if(!"add".equals(op)&&!"replace".equals(op)&&!"set".equals(op)) throw bad("COMMAND_OPERATION_INVALID","Unsupported command operation.");
    JsonNode value=json.valueToTree(command.get("value")); if(value.isMissingNode()||value.isNull()) throw bad("COMMAND_VALUE_REQUIRED","A value is required.");
    String effective="add".equals(op)?effectiveAddPath(copy,path):path; JsonNode old="add".equals(op)&&parent(copy,path).node() instanceof ArrayNode?json.getNodeFactory().missingNode():at(copy,path); put(copy,path,value,"add".equals(op)); Map<String,Object> inverse="add".equals(op)&&parent(root,path).node() instanceof ArrayNode?map("op","remove","path",effective):(old.isMissingNode()?map("op","remove","path",effective):map("op","set","path",path,"value",old)); return new Applied(copy,inverse);
  }
  private void put(JsonNode root,String pointer,JsonNode value,boolean add) { Parent parent=parent(root,pointer); if(parent.node() instanceof ObjectNode object){object.set(parent.token(),value);return;} if(parent.node() instanceof ArrayNode array){if("-".equals(parent.token())&&!add)throw bad("COMMAND_PATH_INVALID","- is valid only for array add.");int i="-".equals(parent.token())?array.size():index(parent.token(),add?array.size():array.size()-1);if(add) array.insert(i,value); else array.set(i,value);return;} throw bad("COMMAND_PATH_INVALID","Parent is not a container."); }
  private void remove(JsonNode root,String pointer) { Parent parent=parent(root,pointer); if(parent.node() instanceof ObjectNode object){object.remove(parent.token());return;} if(parent.node() instanceof ArrayNode array){array.remove(index(parent.token(),array.size()));return;} throw bad("COMMAND_PATH_INVALID","Parent is not a container."); }
  private Parent parent(JsonNode root,String pointer) { if(pointer==null||!pointer.startsWith("/")||pointer.equals("/")||pointer.length()>MAX_POINTER) throw bad("COMMAND_PATH_INVALID","Path must be a bounded JSON pointer."); String[] parts=pointer.substring(1).split("/",-1); JsonNode node=root; for(int i=0;i<parts.length-1;i++){String token=unescape(parts[i]); node=node.isArray()?node.path(index(token,node.size())):node.path(token); if(node.isMissingNode()) throw bad("COMMAND_PATH_INVALID","Parent does not exist.");} return new Parent(node,unescape(parts[parts.length-1])); }
  private JsonNode at(JsonNode root,String pointer) { if(pointer==null||pointer.isEmpty()) return root; if(!pointer.startsWith("/")) return json.getNodeFactory().missingNode(); JsonNode node=root; for(String part:pointer.substring(1).split("/",-1)){String token=unescape(part); node=node.isArray()?node.path(index(token,node.size())):node.path(token);} return node; }
  private String effectiveAddPath(JsonNode root,String pointer){Parent p=parent(root,pointer);return p.node() instanceof ArrayNode array&&"-".equals(p.token())?pointer.substring(0,pointer.length()-1)+array.size():pointer;}
  private int index(String value,int max){try{if(value.startsWith("+")||value.length()>1&&value.startsWith("0"))throw new NumberFormatException();int i=Integer.parseInt(value);if(i<0||i>max)throw new NumberFormatException();return i;}catch(Exception e){throw bad("COMMAND_PATH_INVALID","Array index is invalid.");}}
  private String unescape(String value){return value.replace("~1","/").replace("~0","~");}
  private String lastToken(String pointer){return unescape(pointer.substring(pointer.lastIndexOf('/')+1));}

  private JsonNode remapIds(JsonNode source) { return remapIds(source, UUID.randomUUID(), 0, CanonicalJson.sha256(source)).document(); }
  private Remapped remapIds(JsonNode source,UUID form,long revision,String digest) { JsonNode copy=source.deepCopy(); Map<String,String> ids=new LinkedHashMap<>(); collectIds(copy,ids,form,revision,digest); replaceIds(copy,ids); return new Remapped(copy,Map.copyOf(ids)); }
  private void collectIds(JsonNode node,Map<String,String> ids,UUID form,long revision,String digest){if(node.isObject()){node.fields().forEachRemaining(e->{if("id".equals(e.getKey())&&e.getValue().isTextual())ids.putIfAbsent(e.getValue().asText(),"copy_"+UUID.nameUUIDFromBytes((form+":"+revision+":"+digest+":"+e.getValue().asText()).getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString().replace("-",""));collectIds(e.getValue(),ids,form,revision,digest);});}else if(node.isArray())node.forEach(n->collectIds(n,ids,form,revision,digest));}
  private void replaceIds(JsonNode node,Map<String,String> ids){if(node.isObject()){Iterator<Map.Entry<String,JsonNode>> it=node.fields();while(it.hasNext()){var e=it.next();if(e.getValue().isTextual()&&ids.containsKey(e.getValue().asText()))((ObjectNode)node).put(e.getKey(),ids.get(e.getValue().asText()));else replaceIds(e.getValue(),ids);}}else if(node.isArray())for(int i=0;i<node.size();i++){JsonNode child=node.get(i);if(child.isTextual()&&ids.containsKey(child.asText()))((ArrayNode)node).set(i,json.getNodeFactory().textNode(ids.get(child.asText())));else replaceIds(child,ids);}}
  private JsonNode pinComponent(JsonNode root,String key,Component component){ObjectNode copy=(ObjectNode)root.deepCopy();ArrayNode dependencies=copy.withArray("dependencies");String id=key.replace('-','_');for(int index=dependencies.size()-1;index>=0;index--){JsonNode dependency=dependencies.get(index);if("component".equals(dependency.path("kind").asText())&&id.equals(dependency.path("id").asText())){if(String.valueOf(component.version()).equals(dependency.path("version").asText())&&component.hash().equals(dependency.path("digest").asText()))return copy;dependencies.remove(index);}}dependencies.add(json.valueToTree(map("kind","component","id",id,"version",String.valueOf(component.version()),"digest",component.hash())));return copy;}

  private List<Map<String,Object>> diagnostics(JsonNode candidate){ return compiler.compile(candidate).diagnostics().stream().map(d->map("code",d.code(),"pointer",d.pointer(),"message",d.message())).toList(); }
  private void collectFieldIds(JsonNode node, Set<String> ids) {
    if (node.isArray()) { node.forEach(field -> collectFieldIds(field, ids)); return; }
    if (!node.isObject()) return;
    if (node.path("id").isTextual() && node.path("type").isTextual() && node.path("key").isTextual()) ids.add(node.path("id").asText());
    JsonNode children=node.path("itemSchema").path("fields");
    if (children.isArray()) children.forEach(child -> collectFieldIds(child, ids));
  }
  private boolean repairableRemovedFieldReference(JsonNode candidate, Map<String,Object> problem, LinkedHashSet<String> removedIds) {
    if (!"EXPRESSION_UNKNOWN_FIELD".equals(String.valueOf(problem.get("code")))) return false;
    String pointer=String.valueOf(problem.get("pointer"));
    if (!pointer.startsWith("/expressions/")) return false;
    String expressionId=unescape(pointer.substring("/expressions/".length()));
    if (routeUsesExpression(candidate.path("flow").path("phases"), expressionId)) return false;
    LinkedHashSet<String> references=new LinkedHashSet<>(); collectReferences(at(candidate,pointer),references);
    LinkedHashSet<String> remainingFieldIds=new LinkedHashSet<>(); collectFieldIds(candidate.path("data").path("fields"),remainingFieldIds);
    LinkedHashSet<String> unknownReferences=new LinkedHashSet<>(references); unknownReferences.removeAll(remainingFieldIds);
    // A surviving reference is valid context, not a reason to reject repair. Only
    // the non-empty unknown subset must have been removed by this exact batch.
    return !unknownReferences.isEmpty() && removedIds.containsAll(unknownReferences);
  }
  private boolean acceptsOnlyRemovedFieldReferences(JsonNode candidate, List<Map<String,Object>> problems, Set<String> removedFieldIds) {
    return !removedFieldIds.isEmpty() && !problems.isEmpty()
        && problems.stream().allMatch(problem -> repairableRemovedFieldReference(candidate, problem, new LinkedHashSet<>(removedFieldIds)));
  }
  /** Captures a narrow acceptance for each replay direction; never carries it into a new command. */
  private HistoryAcceptance acceptanceForTransition(UUID form, String draft, Row current, Set<String> commandRemovedFieldIds) {
    return new HistoryAcceptance(commandRemovedFieldIds, inverseAcceptanceForCurrentState(form, draft, current.definition()));
  }
  private Set<String> inverseAcceptanceForCurrentState(UUID form, String draft, String currentDefinition) {
    String metadata=db.query("select invalid_draft_acceptance::text from form_authoring_history where form_id=? and draft_id=? and undone_at is null and operation not in ('UNDO','REDO') and invalid_draft_acceptance is not null order by created_at desc limit 1",
        rs -> rs.next() ? rs.getString(1) : null, form, UUID.fromString(draft));
    HistoryAcceptance prior=historyAcceptance(metadata); JsonNode current=parse(currentDefinition);
    List<Map<String,Object>> currentProblems=diagnostics(current);
    return !currentProblems.isEmpty() && acceptsOnlyRemovedFieldReferences(current, currentProblems, prior.commandRemovedFieldIds())
        ? prior.commandRemovedFieldIds() : Set.of();
  }
  private HistoryAcceptance historyAcceptance(String metadata) {
    if (metadata == null) return HistoryAcceptance.EMPTY;
    JsonNode root=parse(metadata);
    // V26 has not shipped, but accept its earliest single-direction shape safely.
    if (root.has("removedFieldIds")) return new HistoryAcceptance(acceptedRemovedFieldIds(root.path("removedFieldIds")), Set.of());
    return new HistoryAcceptance(acceptedRemovedFieldIds(root.path("command").path("removedFieldIds")), acceptedRemovedFieldIds(root.path("inverse").path("removedFieldIds")));
  }
  private Set<String> acceptedRemovedFieldIds(JsonNode ids) {
    if (!ids.isArray() || ids.isEmpty()) return Set.of();
    LinkedHashSet<String> result=new LinkedHashSet<>();
    for (JsonNode id:ids) {
      if (!id.isTextual() || id.asText().isBlank() || id.asText().length()>MAX_STRING_LENGTH) return Set.of();
      result.add(id.asText());
    }
    return Set.copyOf(result);
  }
  private void collectReferences(JsonNode node, LinkedHashSet<String> references) {
    if (node.isObject()) {
      JsonNode reference=node.path("ref"); if (reference.path("fieldId").isTextual()) references.add(reference.path("fieldId").asText());
      node.elements().forEachRemaining(child -> collectReferences(child,references));
    } else if (node.isArray()) node.forEach(child -> collectReferences(child,references));
  }
  private boolean routeUsesExpression(JsonNode phases,String expressionId) {
    for (JsonNode phase:phases) for (JsonNode page:phase.path("pages")) for (JsonNode route:page.path("routes"))
      if (expressionId.equals(route.path("whenExpressionId").asText())) return true;
    return false;
  }
  private Map<String,Object> impact(JsonNode before,JsonNode after){LinkedHashSet<String> changed=new LinkedHashSet<>(); compare(before,after,"",changed); return map("changedPointers",changed.stream().limit(200).toList(),"changedCount",changed.size(),"semantic",changed.isEmpty()?"NONE":"PACKAGE_CHANGED"); }
  private void compare(JsonNode a,JsonNode b,String pointer,LinkedHashSet<String> out){if(out.size()>=200)return;if(a.equals(b))return;if(a.isObject()&&b.isObject()){LinkedHashSet<String> names=new LinkedHashSet<>();a.fieldNames().forEachRemaining(names::add);b.fieldNames().forEachRemaining(names::add);for(String n:names)compare(a.path(n),b.path(n),pointer+"/"+n.replace("~","~0").replace("/","~1"),out);return;}out.add(pointer);}
  private List<Map<String,Object>> historySummary(UUID form,String draft){return db.query("select operation,revision from form_authoring_history where form_id=? and draft_id=? order by created_at desc limit 100",(rs,n)->map("operation",rs.getString(1),"revision",rs.getLong(2)),form,UUID.fromString(draft));}
  private void requireBounded(JsonNode node){if(node==null||node.isMissingNode()||node.isNull())throw bad("PACKAGE_REQUIRED","A package is required.");count(node,0,0);}
  private int count(JsonNode node,int total,int depth){if(depth>MAX_JSON_DEPTH)throw bad("AUTHORING_DEPTH_LIMIT","JSON nesting exceeds 64 levels.");if(++total>MAX_JSON_NODES)throw bad("AUTHORING_LIMIT","Package exceeds 100000 JSON nodes.");if(node.isTextual()&&node.textValue().length()>MAX_STRING_LENGTH)throw bad("AUTHORING_STRING_LIMIT","JSON strings exceed 32768 characters.");if(node.isObject()){Iterator<Map.Entry<String,JsonNode>> fields=node.fields();while(fields.hasNext()){var field=fields.next();if(field.getKey().length()>MAX_STRING_LENGTH)throw bad("AUTHORING_STRING_LIMIT","JSON keys exceed 32768 characters.");total=count(field.getValue(),total,depth+1);}}else if(node.isArray())for(JsonNode child:node)total=count(child,total,depth+1);return total;}
  private void requireCompilable(JsonNode node){List<Map<String,Object>> problems=diagnostics(node);if(!problems.isEmpty())throw bad("PACKAGE_INVALID","Compiler rejected package: "+problems.get(0).get("code"));}
  private List<String> themeLocks(UUID form,String draft){return db.query("select token_path from form_authoring_theme_locks where form_id=? and draft_id=? order by token_path",(rs,n)->rs.getString(1),form,UUID.fromString(draft));}
  private void replaceThemeLocks(UUID form,String draft,String token,Object raw){JsonNode locks=json.valueToTree(raw);if(!locks.isArray())throw bad("THEME_LOCKS_INVALID","locks must be an array of /tokens JSON pointers.");List<String> paths=new ArrayList<>();locks.forEach(lock->{if(!lock.isTextual()||!lock.asText().matches("/tokens/[A-Za-z0-9_~/-]{1,480}"))throw bad("THEME_LOCKS_INVALID","Theme lock must be a bounded /tokens pointer.");paths.add(lock.asText());});db.update("delete from form_authoring_theme_locks where form_id=? and draft_id=?",form,UUID.fromString(draft));for(String path:paths)db.update("insert into form_authoring_theme_locks(form_id,draft_id,token_path,locked_by) values(?,?,?,?)",form,UUID.fromString(draft),path,actor(token));}
  private List<Map<String,Object>> themePreflight(JsonNode root){return diagnostics(root).stream().filter(d->String.valueOf(d.get("pointer")).startsWith("/theme")).toList();}
  private Map<String,Object> localeCompleteness(JsonNode translations){Map<String,Object> out=new LinkedHashMap<>();JsonNode english=translations.path("en");for(String locale:List.of("en","hi","ar")){JsonNode value=translations.path(locale);out.put(locale,map("present",value.isObject(),"complete",value.isObject()&&structurallyMatches(english,value)));}return out;}
  private boolean structurallyMatches(JsonNode expected,JsonNode actual){if(expected.isValueNode())return actual.isValueNode();if(expected.isArray()){if(!actual.isArray()||expected.size()!=actual.size())return false;for(int i=0;i<expected.size();i++)if(!structurallyMatches(expected.get(i),actual.get(i)))return false;return true;}if(expected.isObject()){if(!actual.isObject()||expected.size()!=actual.size())return false;Iterator<String> names=expected.fieldNames();while(names.hasNext()){String name=names.next();if(!actual.has(name)||!structurallyMatches(expected.get(name),actual.get(name)))return false;}return true;}return expected.equals(actual);}
  private void checkCommand(Map<String,Object> command){if(command==null||command.size()>8)throw bad("COMMAND_INVALID","Command is invalid.");required(command,"path");if(String.valueOf(command.get("path")).length()>MAX_POINTER)throw bad("COMMAND_PATH_INVALID","Path is too long.");}
  private void authorizeRead(String w,UUID f,String d,String t){draft(f,d);authorization.requireReadableForm(w,t,f);}
  private void authorizeContentWrite(String w,UUID f,String d,String t){draft(f,d);authorization.requireContentForm(w,t,f);requireAuthoringWritable(f);}
  private void authorizeWrite(String w,UUID f,String d,String t){draft(f,d);authorization.requireOwnedForm(w,t,f);requireAuthoringWritable(f);}
  private void requireFormInWorkspace(UUID workspaceId,UUID form){Integer found=db.queryForObject("select count(*) from forms where id=? and workspace_id=?",Integer.class,form,workspaceId);if(found==null||found!=1)throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Resource not found");}
  private void requireAuthoringWritable(UUID form){Integer archived=db.queryForObject("select count(*) from form_catalog_metadata where form_id=? and archived_at is not null",Integer.class,form);if(archived!=null&&archived>0)throw new ResponseStatusException(HttpStatus.CONFLICT,"FORM_ARCHIVED");String profile=db.queryForObject("select compatibility_profile_key from forms where id=?",String.class,form);if(!"canonical-4.0.0".equals(profile))throw new ResponseStatusException(HttpStatus.CONFLICT,"CANONICAL_MIGRATION_REQUIRED");Boolean quarantined=db.queryForObject("select exists(select 1 from record_migration_state where record_type='FORM' and record_key=? and state='QUARANTINED')",Boolean.class,form.toString());if(Boolean.TRUE.equals(quarantined))throw new ResponseStatusException(HttpStatus.CONFLICT,"FORM_QUARANTINED");}
  private void draft(UUID form,String draft){if(!form.toString().equals(draft))throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Resource not found");}
  private Row row(UUID form){ Row result=db.query("select revision,definition::text from forms where id=?",rs->rs.next()?new Row(rs.getLong(1),rs.getString(2)):null,form); if(result==null)throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Resource not found"); return result; }
  private UUID actor(String header){try{HttpServletRequest request=((ServletRequestAttributes)RequestContextHolder.currentRequestAttributes()).getRequest();String session=sessions.session(request,header).orElseThrow();return db.queryForObject("select account_id from staff_sessions where token::text=?",UUID.class,session);}catch(Exception e){throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Valid staff workspace session required");}}
  private JsonNode parse(String value){try{return json.readTree(value);}catch(Exception e){throw new IllegalStateException("Stored package is not JSON",e);}}
  private String stringify(JsonNode node){try{return json.writeValueAsString(node);}catch(Exception e){throw new IllegalArgumentException("Cannot serialize JSON",e);}}
  @SuppressWarnings("unchecked") private List<Map<String,Object>> maps(Object value){if(!(value instanceof List<?> list))return List.of();return list.stream().filter(Map.class::isInstance).map(v->(Map<String,Object>)v).toList();}
  private String required(Map<String,Object> body,String key){Object value=body.get(key);if(value==null||String.valueOf(value).isBlank())throw bad("AUTHORING_REQUEST_INVALID",key+" is required.");return String.valueOf(value);}
  private boolean matches(String value,long revision){if(value==null||value.isBlank())throw new ResponseStatusException(HttpStatus.PRECONDITION_REQUIRED,"If-Match required");return etag(revision).equals(value);}
  private JsonNode clientFor(Map<String,Object> request,Row current){if(request.containsKey("definition"))return json.valueToTree(request.get("definition"));try{JsonNode attempted=parse(current.definition());for(Map<String,Object> command:maps(request.get("commands")))attempted=apply(attempted,command).document();return attempted;}catch(RuntimeException ignored){return parse(current.definition());}}
  /** Import validity is bound to the administrator-controlled effective workspace policy, not the candidate. */
  private String effectivePolicyHash(UUID form){
    Map<String,Object> row=db.query("select coalesce(os.policy_settings,'{}'::jsonb)::text organization_policy,coalesce(ws.policy_settings,'{}'::jsonb)::text workspace_policy from forms f join workspaces w on w.id=f.workspace_id left join catalog_organization_settings os on os.organization_id=w.organization_id left join catalog_workspace_settings ws on ws.workspace_id=w.id where f.id=?",rs->rs.next()?map("organization",rs.getString(1),"workspace",rs.getString(2)):null,form);
    if(row==null)throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Resource not found");
    ObjectNode effective=json.createObjectNode(); effective.setAll((ObjectNode)parse(String.valueOf(row.get("organization")))); effective.setAll((ObjectNode)parse(String.valueOf(row.get("workspace"))));
    return CanonicalJson.sha256(effective);
  }
  /** Resolves only a Q&A answer bound to the visible canonical page/section/question guidance ID. */
  private String governedAnswer(JsonNode definition, String locale, String question, Object requestedScope) {
    String key=definition.path("guidance").path("questionsAndAnswers").path("messageKey").asText();
    JsonNode source=definition.path("translations").path(locale).path("messages").path(key);
    JsonNode scope=json.valueToTree(requestedScope);
    String guidanceId=visibleGuidanceId(definition, scope);
    if (key.isBlank() || !source.isTextual() || guidanceId == null) return null;
    try {
      JsonNode questions=json.readTree(source.asText());
      if (!questions.isArray()) return null;
      for (JsonNode entry:questions) if (approvedQuestionMatches(entry, question) && guidanceId.equals(entry.path("guidanceId").asText()) && scopedQuestion(entry.path("scope"), scope) && entry.path("answer").isTextual()) return entry.path("answer").asText();
      return null;
    } catch (Exception ignored) { return null; }
  }
  /** Narration is selected by the authoritative hierarchy binding, never client-provided text. */
  private String governedNarration(JsonNode definition, String locale, Object requestedScope) {
    String guidanceId=visibleGuidanceId(definition, json.valueToTree(requestedScope));
    JsonNode narration=definition.path("guidance").path("narration");
    if (guidanceId == null || !guidanceId.equals(narration.path("id").asText())) return null;
    String key=narration.path("messageKey").asText();
    JsonNode value=definition.path("translations").path(locale).path("messages").path(key);
    return key.isBlank() || !value.isTextual() ? null : value.asText();
  }
  /** Q&A aliases are package text reviewed alongside the answer; client input only selects one. */
  private boolean approvedQuestionMatches(JsonNode entry, String question) {
    String normalized=question.trim().replaceAll("\\s+"," ").toLowerCase(java.util.Locale.ROOT);
    if (normalized.equals(normalizeQuestion(entry.path("question").asText()))) return true;
    JsonNode aliases=entry.path("aliases");
    if (!aliases.isArray()) return false;
    for (JsonNode alias:aliases) if (alias.isTextual() && normalized.equals(normalizeQuestion(alias.asText()))) return true;
    return false;
  }
  private String normalizeQuestion(String value) { return value.trim().replaceAll("\\s+"," ").toLowerCase(java.util.Locale.ROOT); }
  private boolean scopedQuestion(JsonNode questionScope, JsonNode visibleScope) {
    if (!questionScope.isObject() || questionScope.isEmpty()) return false;
    Iterator<Map.Entry<String,JsonNode>> fields=questionScope.fields();
    while(fields.hasNext()) { Map.Entry<String,JsonNode> field=fields.next(); if (!List.of("pageId","sectionId","fieldId").contains(field.getKey()) || !field.getValue().isTextual() || !field.getValue().asText().equals(visibleScope.path(field.getKey()).asText())) return false; }
    return true;
  }
  /** Finds the binding from the visible hierarchy rather than trusting a client-supplied guidance ID. */
  private String visibleGuidanceId(JsonNode definition, JsonNode scope) {
    if (!scope.isObject() || !scope.path("pageId").isTextual()) return null;
    String pageId=scope.path("pageId").asText(); String sectionId=scope.path("sectionId").asText(null); String fieldId=scope.path("fieldId").asText(null); String placementId=scope.path("placementId").asText(null);
    for (JsonNode phase:definition.path("flow").path("phases")) for (JsonNode page:phase.path("pages")) if (pageId.equals(page.path("id").asText())) {
      if (sectionId==null) return page.path("guidanceId").asText(null);
      for (JsonNode section:page.path("sections")) if (sectionId.equals(section.path("id").asText())) {
        if (fieldId==null) return section.path("guidanceId").asText(page.path("guidanceId").asText(null));
        // A shared nested field can have several visible placements.  Resolve the
        // requested canonical placement inside this exact section before falling
        // back to a field-level binding; never let a first recursive match win.
        JsonNode node=placementId == null ? findQuestionNode(section.path("nodes"), fieldId)
            : findQuestionNodeById(section.path("nodes"), placementId, fieldId);
        if (node!=null) {
          String nodeBinding=node.path("guidanceId").asText(null);
          if (nodeBinding!=null) return nodeBinding;
          JsonNode field=findCanonicalField(definition.path("data").path("fields"), fieldId);
          if (field!=null && field.path("guidanceId").isTextual()) return field.path("guidanceId").asText();
          return section.path("guidanceId").asText(page.path("guidanceId").asText(null));
        }
      }
    }
    return null;
  }
  private JsonNode findQuestionNode(JsonNode nodes, String fieldId) {
    if (!nodes.isArray()) return null;
    for (JsonNode node:nodes) {
      if (fieldId.equals(node.path("fieldId").asText())) return node;
      JsonNode nested=findQuestionNode(node.path("children"),fieldId);
      if (nested!=null) return nested;
      nested=findQuestionNode(node.path("nodes"),fieldId);
      if (nested!=null) return nested;
    }
    return null;
  }
  private JsonNode findQuestionNodeById(JsonNode nodes, String placementId, String fieldId) {
    if (!nodes.isArray()) return null;
    for (JsonNode node:nodes) {
      if (placementId.equals(node.path("id").asText()) && (fieldId == null || fieldId.equals(node.path("fieldId").asText()))) return node;
      JsonNode nested=findQuestionNodeById(node.path("children"), placementId, fieldId);
      if (nested!=null) return nested;
      nested=findQuestionNodeById(node.path("nodes"), placementId, fieldId);
      if (nested!=null) return nested;
    }
    return null;
  }
  private JsonNode findCanonicalField(JsonNode fields, String fieldId) {
    if (!fields.isArray()) return null;
    for (JsonNode field:fields) {
      if (fieldId.equals(field.path("id").asText())) return field;
      JsonNode nested=findCanonicalField(field.path("itemSchema").path("fields"),fieldId);
      if (nested!=null) return nested;
    }
    return null;
  }
  private boolean trustedLocaleApproved(UUID form, String draft, String locale, Row current, JsonNode definition) {
    if (!supportsLocale(definition, locale)) return false;
    String hash=CanonicalJson.sha256(definition);
    Integer count=db.queryForObject("select count(*) from form_authoring_locale_reviews where form_id=? and draft_id=? and locale=? and source_revision=? and source_package_hash=? and status='APPROVED' and reviewed_by is not null",Integer.class,form,UUID.fromString(draft),locale,current.revision(),hash);
    return count != null && count == 1;
  }
  private void validateGuidanceReferences(JsonNode guidance) {
    if (!guidance.isObject()) throw bad("GUIDANCE_REFERENCE_INVALID", "Guidance references must be an object.");
    Iterator<Map.Entry<String,JsonNode>> fields=guidance.fields();
    while(fields.hasNext()) { Map.Entry<String,JsonNode> field=fields.next(); JsonNode reference=field.getValue();
      if (!field.getKey().matches("[A-Za-z][A-Za-z0-9_-]{0,127}") || !reference.isObject()
          || !reference.path("id").isTextual() || !reference.path("id").asText().matches("[A-Za-z][A-Za-z0-9_.-]{0,127}")
          || !reference.path("messageKey").isTextual() || !reference.path("messageKey").asText().matches("[a-z][a-z0-9_.-]{0,127}"))
        throw bad("GUIDANCE_REFERENCE_INVALID", "Every guidance entry must preserve a valid stable id and messageKey.");
    }
  }
  private boolean supportsLocale(JsonNode definition, String locale) { for (JsonNode supported : definition.path("supportedLocales")) if (locale.equals(supported.asText())) return true; return false; }
  private Map<String,Object> unavailable(String locale, String code) { return map("available",false,"code",code,"locale",locale); }
  private boolean reserveSpeechQuota(UUID form, UUID account) {
    if (speechUserDailyQuota < 1 || speechTenantDailyQuota < 1) return false;
    UUID organization = db.queryForObject("select w.organization_id from forms f join workspaces w on w.id=f.workspace_id where f.id=?", UUID.class, form);
    if (!reserveSpeechQuota(organization, "USER", account, speechUserDailyQuota)) return false;
    if (reserveSpeechQuota(organization, "TENANT", organization, speechTenantDailyQuota)) return true;
    db.update("update form_authoring_speech_usage set request_count=request_count-1 where organization_id=? and scope=? and subject_id=? and usage_day=current_date and request_count>0", organization, "USER", account);
    return false;
  }
  private boolean reserveSpeechQuota(UUID organization, String scope, UUID subject, int limit) {
    Boolean reserved = db.query("insert into form_authoring_speech_usage(organization_id,scope,subject_id,usage_day,request_count) values(?,?,?,current_date,1) on conflict(organization_id,scope,subject_id,usage_day) do update set request_count=form_authoring_speech_usage.request_count+1 where form_authoring_speech_usage.request_count < ? returning true", rs -> rs.next() ? rs.getBoolean(1) : false, organization, scope, subject, limit);
    return Boolean.TRUE.equals(reserved);
  }
  private String boundedChoice(Object value,List<String> allowed,String fallback){String candidate=value==null?fallback:String.valueOf(value);if(!allowed.contains(candidate))throw bad("PREVIEW_CONTEXT_INVALID","Unsupported locale.");return candidate;}
  private String boundedTimezone(Object value){String timezone=value==null?"UTC":String.valueOf(value);try{ZoneId.of(timezone);}catch(Exception e){throw bad("PREVIEW_CONTEXT_INVALID","Invalid timezone.");}if(timezone.length()>64)throw bad("PREVIEW_CONTEXT_INVALID","Timezone is too long.");return timezone;}
  private String boundedDate(Object value,String timezone){String date=value==null?LocalDate.now(clock.withZone(ZoneId.of(timezone))).toString():String.valueOf(value);try{LocalDate.parse(date);}catch(Exception e){throw bad("PREVIEW_CONTEXT_INVALID","Invalid session date.");}return date;}
  private String boundedDevice(Object value){String device=value==null?"author-preview":String.valueOf(value);if(!device.matches("[A-Za-z0-9 _.-]{1,80}"))throw bad("PREVIEW_CONTEXT_INVALID","Invalid device.");return device;}
  private void persistLocaleReview(UUID form,String draft,JsonNode definition,UUID actor,long revision){String packageHash=CanonicalJson.sha256(definition);LinkedHashSet<String> locales=new LinkedHashSet<>();definition.path("supportedLocales").forEach(locale->{if(locale.isTextual()&&!locale.asText().isBlank())locales.add(locale.asText());});for(String locale:locales)db.update("insert into form_authoring_locale_reviews(form_id,draft_id,locale,source_revision,source_package_hash,status,reviewed_by,reviewed_at) values(?,?,?,?,?,?,?,now()) on conflict(form_id,draft_id,locale) do update set source_revision=excluded.source_revision,source_package_hash=excluded.source_package_hash,status='DRAFT',reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at",form,UUID.fromString(draft),locale,revision,packageHash,"DRAFT",actor);}
  private long expectedRevision(String match){try{if(match!=null&&match.matches("\"[0-9]+\""))return Long.parseLong(match.substring(1,match.length()-1));}catch(RuntimeException ignored){}return -1;}
  private String etag(long revision){return "\""+revision+"\"";}
  private ResponseStatusException bad(String code,String message){return new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,code+": "+message);}
  private Map<String,Object> map(Object... entries){Map<String,Object> out=new LinkedHashMap<>();for(int i=0;i<entries.length;i+=2)out.put(String.valueOf(entries[i]),entries[i+1]);return out;}
  private record Row(long revision,String definition){} private record Parent(JsonNode node,String token){} private record Applied(JsonNode document,Map<String,Object> inverse){} private record History(UUID id,String inverse,String command,String metadata){} private record HistoryAcceptance(Set<String> commandRemovedFieldIds,Set<String> inverseRemovedFieldIds){ static final HistoryAcceptance EMPTY=new HistoryAcceptance(Set.of(),Set.of()); boolean isEmpty(){return commandRemovedFieldIds.isEmpty()&&inverseRemovedFieldIds.isEmpty();} HistoryAcceptance swapped(){return new HistoryAcceptance(inverseRemovedFieldIds,commandRemovedFieldIds);} } private record Candidate(long baseRevision,String digest,String json,String state,String policyHash){} private record Component(int version,String fragment,String hash){} private record Remapped(JsonNode document,Map<String,String> ids){}
}
