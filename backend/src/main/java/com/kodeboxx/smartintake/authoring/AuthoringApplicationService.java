package com.kodeboxx.smartintake.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.kodeboxx.smartintake.contract.CanonicalJson;
import com.kodeboxx.smartintake.contract.compiler.CompilationDiagnostic;
import com.kodeboxx.smartintake.contract.compiler.FormCompiler;
import com.kodeboxx.smartintake.contract.runtime.TypedSessionRuntimeService;
import com.kodeboxx.smartintake.security.AdministrationMutationExecutor;
import com.kodeboxx.smartintake.security.IdentitySessionResolver;
import com.kodeboxx.smartintake.security.StaffAuthorization;
import com.kodeboxx.smartintake.speech.SpeechPort;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.beans.factory.annotation.Autowired;
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
  private static final int MAX_COMMANDS = 100;
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

  public AuthoringApplicationService(JdbcTemplate db, ObjectMapper json, StaffAuthorization authorization,
      IdentitySessionResolver sessions, FormCompiler compiler, SpeechPort speech) {
    this(db, json, authorization, sessions, compiler, speech, null, null);
  }

  @Autowired
  public AuthoringApplicationService(JdbcTemplate db, ObjectMapper json, StaffAuthorization authorization,
      IdentitySessionResolver sessions, FormCompiler compiler, SpeechPort speech,
      TypedSessionRuntimeService runtime, AdministrationMutationExecutor replays) {
    this.db = db;
    this.json = json;
    this.authorization = authorization;
    this.sessions = sessions;
    this.compiler = compiler;
    this.speech = speech;
    this.runtime = runtime;
    this.replays = replays;
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
    if (!matches(match, current.revision())) return conflict(form, draft, current, client, match);
    List<Map<String, Object>> commands = maps(request.get("commands"));
    if (commands.isEmpty() || commands.size() > MAX_COMMANDS) throw bad("COMMAND_LIMIT", "A batch must contain 1-100 commands.");
    JsonNode next = parse(current.definition());
    List<Map<String, Object>> inverses = new ArrayList<>();
    for (Map<String, Object> command : commands) {
      checkCommand(command);
      Applied applied = apply(next, command);
      next = applied.document();
      inverses.add(0, applied.inverse());
    }
    requireBounded(next);
    if (request.containsKey("expectedHash") && !CanonicalJson.sha256(parse(current.definition())).equals(request.get("expectedHash")))
      return conflict(form, draft, current, client, match);
    return persist(form, draft, current, next, author, "COMMAND_BATCH",
        Map.of("commands", commands), Map.of("commands", inverses));
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
  public ResponseEntity<?> undo(String workspace, UUID form, String draft, String token, String match) {
    authorizeWrite(workspace, form, draft, token); Row current = row(form);
    if (!matches(match, current.revision())) return conflict(form, draft, current, parse(current.definition()), match);
    History history = db.query("select id,inverse_command::text,command::text from form_authoring_history where form_id=? and draft_id=? and undone_at is null and operation not in ('UNDO','REDO') order by created_at desc limit 1",
        rs -> rs.next() ? new History((UUID) rs.getObject(1), rs.getString(2), rs.getString(3)) : null, form, UUID.fromString(draft));
    if (history == null) throw bad("UNDO_EMPTY", "Nothing to undo.");
    JsonNode next = applyBatch(parse(current.definition()), parse(history.inverse()));
    ResponseEntity<?> result = persist(form, draft, current, next, actor(token), "UNDO", parse(history.inverse()), parse(history.command()));
    db.update("update form_authoring_history set undone_at=now() where id=?", history.id());
    return result;
  }

  @Transactional
  public ResponseEntity<?> redo(String workspace, UUID form, String draft, String token, String match) {
    authorizeWrite(workspace, form, draft, token); Row current = row(form);
    if (!matches(match, current.revision())) return conflict(form, draft, current, parse(current.definition()), match);
    History history = db.query("select id,inverse_command::text,command::text from form_authoring_history where form_id=? and draft_id=? and undone_at is not null and operation not in ('UNDO','REDO') order by undone_at desc limit 1",
        rs -> rs.next() ? new History((UUID) rs.getObject(1), rs.getString(2), rs.getString(3)) : null, form, UUID.fromString(draft));
    if (history == null) throw bad("REDO_EMPTY", "Nothing to redo.");
    JsonNode next = applyBatch(parse(current.definition()), parse(history.command()));
    ResponseEntity<?> result = persist(form, draft, current, next, actor(token), "REDO", parse(history.command()), parse(history.inverse()));
    db.update("update form_authoring_history set undone_at=null where id=?", history.id());
    return result;
  }

  @Transactional
  public ResponseEntity<?> resolve(String workspace, UUID form, String draft, String token, String match, Map<String, Object> request) {
    authorizeWrite(workspace, form, draft, token); Row current = row(form);
    UUID conflictId = UUID.fromString(required(request, "conflictId"));
    JsonNode chosen = json.valueToTree(request.get("definition")); requireBounded(chosen);
    if (!matches(match, current.revision())) return conflict(form, draft, current, chosen, match);
    int found = db.update("update form_authoring_conflicts set resolved_at=now() where id=? and form_id=? and resolved_at is null", conflictId, form);
    if (found != 1) throw bad("CONFLICT_NOT_FOUND", "Conflict is unavailable.");
    return persist(form, draft, current, chosen, actor(token), "CONFLICT_RESOLVE", Map.of("definition", stringify(chosen)), Map.of("definition", current.definition()));
  }

  @Transactional
  public Map<String, Object> validateImport(String workspace, UUID form, String draft, String token, Map<String, Object> request) {
    authorizeWrite(workspace, form, draft, token); Row current = row(form);
    JsonNode candidate = json.valueToTree(request.get("candidate")); requireBounded(candidate);
    String digest = CanonicalJson.sha256(candidate); List<Map<String, Object>> results = diagnostics(candidate);
    String state = results.isEmpty() ? "VALID" : "INVALID"; UUID id = UUID.randomUUID();
    db.update("insert into form_import_candidates(id,form_id,draft_id,base_revision,candidate_digest,candidate,diagnostics,state,created_by,expires_at) values(?,?,?,?,?,cast(? as jsonb),cast(? as jsonb),?,?,now()+interval '30 minutes')",
        id, form, UUID.fromString(draft), current.revision(), digest, stringify(candidate), stringify(json.valueToTree(results)), state, actor(token));
    return map("candidateId", id.toString(), "digest", digest, "baseRevision", current.revision(), "state", state, "diagnostics", results);
  }

  @Transactional
  public ResponseEntity<?> commitImport(String workspace, UUID form, String draft, String token, String match, Map<String, Object> request) {
    authorizeWrite(workspace, form, draft, token); Row current = row(form);
    Candidate candidate = db.query("select base_revision,candidate_digest,candidate::text,state from form_import_candidates where id=? and form_id=? and draft_id=? and expires_at>now()",
        rs -> rs.next() ? new Candidate(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4)) : null,
        UUID.fromString(required(request, "candidateId")), form, UUID.fromString(draft));
    if (candidate == null || !"VALID".equals(candidate.state())) throw bad("IMPORT_CANDIDATE_INVALID", "Validate a current valid candidate first.");
    if (!matches(match, current.revision()) || candidate.baseRevision() != current.revision() || !candidate.digest().equals(request.get("digest")))
      return conflict(form, draft, current, parse(candidate.json()), match);
    JsonNode next = parse(candidate.json());
    String mode = String.valueOf(request.getOrDefault("mode", "UPDATE"));
    if ("COPY".equals(mode)) next = remapIds(next); else if (!"UPDATE".equals(mode)) throw bad("IMPORT_MODE_INVALID", "Mode must be UPDATE or COPY.");
    ResponseEntity<?> result = persist(form, draft, current, next, actor(token), "IMPORT_" + mode,
        Map.of("definition", stringify(next), "candidateDigest", candidate.digest(), "mode", mode), Map.of("definition", current.definition()));
    db.update("delete from form_import_candidates where form_id=? and draft_id=?", form, UUID.fromString(draft));
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
    return ResponseEntity.ok(content);
  }
  @Transactional public ResponseEntity<?> updateTheme(String w, UUID f, String d, String t, String m, Map<String, Object> body) {
    JsonNode before = at(parse(row(f).definition()), "/theme"); JsonNode next = json.valueToTree(body.get("theme"));
    for (String lock : themeLocks(f, d)) if (!at(before, lock).equals(at(next, lock)))
      throw bad("THEME_LOCKED", "Theme token is locked: " + lock);
    ResponseEntity<?> saved = updateSubdocument(w, f, d, t, m, "/theme", next);
    if (saved.getStatusCode().is2xxSuccessful() && body.containsKey("locks")) replaceThemeLocks(f, d, t, body.get("locks"));
    return saved;
  }
  public ResponseEntity<?> updateContent(String w, UUID f, String d, String t, String m, Map<String, Object> body) {
    Map<String,Object> patch = new LinkedHashMap<>(); patch.put("commands", List.of(
        map("op", "set", "path", "/guidance", "value", body.getOrDefault("guidance", Map.of())),
        map("op", "set", "path", "/translations", "value", body.getOrDefault("translations", Map.of()))));
    authorizeWrite(w, f, d, t); return commandsInternal(f, d, m, patch, actor(t));
  }

  public List<Map<String, Object>> comments(String w, UUID f, String d, String t) {
    authorizeRead(w, f, d, t); return db.query("select id,pointer,body,author_account_id,created_at from form_authoring_comments where form_id=? and draft_id=? order by created_at", (rs,n) -> map("id",rs.getObject(1).toString(),"pointer",rs.getString(2),"body",rs.getString(3),"authorId",rs.getObject(4).toString(),"createdAt",rs.getObject(5).toString()), f, UUID.fromString(d));
  }
  public Map<String,Object> comment(String w, UUID f, String d, String t, Map<String,Object> body) {
    authorizeRead(w,f,d,t); String pointer=required(body,"pointer"); String text=required(body,"body"); if(pointer.length()>MAX_POINTER || text.length()>4000) throw bad("COMMENT_LIMIT","Comment exceeds a limit."); UUID id=UUID.randomUUID(); db.update("insert into form_authoring_comments(id,form_id,draft_id,pointer,body,author_account_id) values(?,?,?,?,?,?)",id,f,UUID.fromString(d),pointer,text,actor(t)); return map("id",id.toString(),"pointer",pointer,"body",text);
  }
  public List<Map<String,Object>> presence(String w, UUID f, String d, String t) {
    authorizeRead(w,f,d,t); db.update("delete from form_authoring_presence where expires_at<=now()"); return db.query("select account_id,cursor_pointer,display_name,expires_at from form_authoring_presence where form_id=? and draft_id=? order by updated_at",(rs,n)->map("accountId",rs.getObject(1).toString(),"cursor",rs.getString(2),"displayName",rs.getString(3),"expiresAt",rs.getObject(4).toString()),f,UUID.fromString(d));
  }
  public ResponseEntity<?> presence(String w, UUID f, String d, String t, Map<String,Object> body) {
    authorizeRead(w,f,d,t); String cursor=String.valueOf(body.getOrDefault("cursor", "")); if(cursor.length()>MAX_POINTER) throw bad("PRESENCE_LIMIT","Cursor pointer is too long."); UUID account=actor(t); db.update("insert into form_authoring_presence(form_id,draft_id,account_id,cursor_pointer,display_name,expires_at) values(?,?,?,?,?,now()+interval '90 seconds') on conflict(form_id,draft_id,account_id) do update set cursor_pointer=excluded.cursor_pointer,display_name=excluded.display_name,expires_at=excluded.expires_at,updated_at=now()",f,UUID.fromString(d),account,cursor,body.getOrDefault("displayName","")); return ResponseEntity.noContent().build();
  }

  /** Synthetic state is projected through the same canonical runtime without durable respondent effects. */
  public Map<String,Object> preview(String w, UUID f, String d, String t, Map<String,Object> request) {
    authorizeRead(w,f,d,t); JsonNode definition=parse(row(f).definition()); JsonNode answers=json.valueToTree(request.getOrDefault("answers",Map.of()));
    List<Map<String,Object>> errors=diagnostics(definition); Map<String,Object> projection=Map.of();
    if (errors.isEmpty() && runtime != null) {
      var outcome=runtime.mutate(definition, answers, List.of(), "2026-09-21", "UTC", Instant.now());
      errors=outcome.validation(); projection=map("answers",outcome.answers(),"review",outcome.reviewProjection(),
          "reachablePageIds",outcome.reachablePageIds(),"requiredCount",outcome.requiredCount(),
          "completedRequiredCount",outcome.completedRequiredCount(),"accepted",outcome.accepted());
    }
    return map("mode","synthetic", "packageHash",CanonicalJson.sha256(definition), "diagnostics",errors,
        "projection",projection, "effects",Map.of("sessions",0,"submissions",0,"email",0,"webhooks",0,"providers",0));
  }

  public Map<String,Object> speech(String w, UUID f, String d, String t, Map<String,Object> request) {
    authorizeRead(w, f, d, t);
    String locale = required(request, "locale"); String voice = required(request, "voice"); String text = required(request, "text");
    SpeechPort.SpeechResult result = speech.synthesize(text, locale, voice);
    if (!result.available()) return map("available",false,"code",result.code(),"locale",locale);
    return map("available",true,"locale",locale,"contentType",result.contentType(),"audioBase64",Base64.getEncoder().encodeToString(result.audio()),"latencyMillis",result.latencyMillis());
  }

  public List<Map<String,Object>> components(String w,String token) { UUID ws=authorization.authorizeAuthoring(w,token); return db.query("select id,component_key,name,version,status,fragment_hash,updated_at from reusable_components where workspace_id=? order by component_key,version desc",(rs,n)->map("id",rs.getObject(1).toString(),"key",rs.getString(2),"name",rs.getString(3),"version",rs.getInt(4),"status",rs.getString(5),"hash",rs.getString(6),"updatedAt",rs.getObject(7).toString()),ws); }
  @Transactional public ResponseEntity<?> component(String w,String token,Map<String,Object> body) {
    UUID ws=authorization.authorizeAuthoring(w,token); String key=required(body,"key"); String name=required(body,"name"); JsonNode fragment=json.valueToTree(body.get("fragment")); requireBounded(fragment); int version=db.queryForObject("select coalesce(max(version),0)+1 from reusable_components where workspace_id=? and component_key=?",Integer.class,ws,key); UUID id=UUID.randomUUID(); String hash=CanonicalJson.sha256(fragment); db.update("insert into reusable_components(id,workspace_id,component_key,name,version,fragment,fragment_hash,created_by) values(?,?,?,?,?,cast(? as jsonb),?,?)",id,ws,key,name,version,stringify(fragment),hash,actor(token)); return ResponseEntity.status(201).body(map("id",id.toString(),"key",key,"version",version,"hash",hash,"fragment",fragment)); }

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
    if (!matches(match, current.revision())) return conflict(f, d, current, parse(current.definition()), match);
    Integer requested = body.get("version") instanceof Number number ? number.intValue() : null;
    Component component = db.query("select version,fragment::text,fragment_hash from reusable_components where workspace_id=? and component_key=? and status='ACTIVE' "
            + (requested == null ? "order by version desc limit 1" : "and version=?"), rs -> rs.next() ? new Component(rs.getInt(1),rs.getString(2),rs.getString(3)) : null,
        requested == null ? new Object[]{workspace,componentKey} : new Object[]{workspace,componentKey,requested});
    if (component == null) throw bad("COMPONENT_NOT_FOUND", "Reusable component version is unavailable.");
    String path = required(body, "path"); String operation = String.valueOf(body.getOrDefault("operation", "add"));
    if (!List.of("add", "replace").contains(operation)) throw bad("COMPONENT_OPERATION_INVALID", "Component operation must be add or replace.");
    JsonNode copied = remapIds(parse(component.fragment())); requireBounded(copied);
    Applied applied = apply(parse(current.definition()), map("op",operation,"path",path,"value",copied));
    return persist(f, d, current, applied.document(), author, "COMPONENT_INSERT",
        map("componentKey",componentKey,"version",component.version(),"hash",component.hash(),"path",path,"operation",operation), applied.inverse());
  }

  private ResponseEntity<?> subdocument(String w,UUID f,String d,String t,String pointer) { return ResponseEntity.ok(documentBody(w,f,d,t,pointer)); }
  private Map<String,Object> documentBody(String w,UUID f,String d,String t,String... pointers) { authorizeRead(w,f,d,t); Row row=row(f); JsonNode root=parse(row.definition()); Map<String,Object> out=new LinkedHashMap<>(); out.put("revision",row.revision()); for(String pointer:pointers) out.put(pointer.substring(1),at(root,pointer)); return out; }
  private ResponseEntity<?> updateSubdocument(String w,UUID f,String d,String t,String match,String pointer,Object value) { authorizeWrite(w,f,d,t); return commandsInternal(f,d,match,map("commands",List.of(map("op","set","path",pointer,"value",value))),actor(t)); }

  private ResponseEntity<?> persist(UUID form,String draft,Row current,JsonNode next,UUID actor,String operation,Object command,Object inverse) {
    requireBounded(next); requireCompilable(next); long revision=current.revision()+1; String before=CanonicalJson.sha256(parse(current.definition())); String after=CanonicalJson.sha256(next);
    int updated=db.update("update forms set definition=cast(? as jsonb),revision=?,updated_at=now() where id=? and revision=?",stringify(next),revision,form,current.revision());
    if(updated!=1) return conflict(form,draft,row(form),next,null);
    if (!"UNDO".equals(operation) && !"REDO".equals(operation))
      db.update("delete from form_authoring_history where form_id=? and draft_id=? and undone_at is not null",form,UUID.fromString(draft));
    db.update("insert into form_authoring_history(id,form_id,draft_id,revision,command_id,actor_account_id,operation,command,inverse_command,before_hash,after_hash) values(?,?,?,?,?,?,?,cast(? as jsonb),cast(? as jsonb),?,?)",UUID.randomUUID(),form,UUID.fromString(draft),revision,UUID.randomUUID().toString(),actor,operation,stringify(json.valueToTree(command)),stringify(json.valueToTree(inverse)),before,after);
    return ResponseEntity.ok().eTag(etag(revision)).body(map("revision",revision,"etag",etag(revision),"definition",next,"packageHash",after,"diagnostics",diagnostics(next),"impact",impact(parse(current.definition()),next)));
  }

  private ResponseEntity<?> conflict(UUID form,String draft,Row server,JsonNode client,String match) {
    UUID id=UUID.randomUUID(); JsonNode packageNode=parse(server.definition()); db.update("insert into form_authoring_conflicts(id,form_id,draft_id,expected_revision,actual_revision,client_hash,server_hash,client_package,server_package) values(?,?,?,?,?,?,?,cast(? as jsonb),cast(? as jsonb))",id,form,UUID.fromString(draft),expectedRevision(match),server.revision(),CanonicalJson.sha256(client),CanonicalJson.sha256(packageNode),stringify(client),stringify(packageNode));
    return ResponseEntity.status(HttpStatus.CONFLICT).eTag(etag(server.revision())).body(map("code","AUTHORING_CONFLICT","conflictId",id.toString(),"revision",server.revision(),"server",packageNode,"client",client,"impact",impact(client,packageNode)));
  }

  private JsonNode applyBatch(JsonNode root,JsonNode batch) { if (batch.isTextual()) return parse(batch.asText()); if (batch.path("definition").isTextual()) return parse(batch.path("definition").asText()); JsonNode current=root; JsonNode commands=batch.path("commands"); if(!commands.isArray()||commands.size()>MAX_COMMANDS) throw bad("COMMAND_LIMIT","Invalid history command."); for(JsonNode command:commands){ Map<String,Object> map=json.convertValue(command,Map.class); checkCommand(map); current=apply(current,map).document(); } return current; }
  private Applied apply(JsonNode root,Map<String,Object> command) {
    String op=String.valueOf(command.getOrDefault("op",command.get("operation"))).toLowerCase(); String path=required(command,"path"); JsonNode copy=root.deepCopy(); JsonNode old=at(copy,path);
    if("remove".equals(op)){ if(old.isMissingNode()) throw bad("COMMAND_PATH_INVALID","Path does not exist."); remove(copy,path); return new Applied(copy,map("op","add","path",path,"value",old)); }
    if("move".equals(op)){ String from=required(command,"from"); JsonNode moved=at(copy,from); if(moved.isMissingNode()) throw bad("COMMAND_PATH_INVALID","Move source does not exist."); remove(copy,from); put(copy,path,moved,true); return new Applied(copy,map("op","move","from",path,"path",from)); }
    if(!"add".equals(op)&&!"replace".equals(op)&&!"set".equals(op)) throw bad("COMMAND_OPERATION_INVALID","Unsupported command operation.");
    JsonNode value=json.valueToTree(command.get("value")); if(value.isMissingNode()||value.isNull()) throw bad("COMMAND_VALUE_REQUIRED","A value is required.");
    put(copy,path,value,"add".equals(op)); Map<String,Object> inverse=old.isMissingNode()?map("op","remove","path",path):map("op","set","path",path,"value",old); return new Applied(copy,inverse);
  }
  private void put(JsonNode root,String pointer,JsonNode value,boolean add) { Parent parent=parent(root,pointer); if(parent.node() instanceof ObjectNode object){object.set(parent.token(),value);return;} if(parent.node() instanceof ArrayNode array){int i="-".equals(parent.token())?array.size():index(parent.token(),array.size()+(add?1:0));if(add) array.insert(i,value); else array.set(i,value);return;} throw bad("COMMAND_PATH_INVALID","Parent is not a container."); }
  private void remove(JsonNode root,String pointer) { Parent parent=parent(root,pointer); if(parent.node() instanceof ObjectNode object){object.remove(parent.token());return;} if(parent.node() instanceof ArrayNode array){array.remove(index(parent.token(),array.size()));return;} throw bad("COMMAND_PATH_INVALID","Parent is not a container."); }
  private Parent parent(JsonNode root,String pointer) { if(pointer==null||!pointer.startsWith("/")||pointer.equals("/")||pointer.length()>MAX_POINTER) throw bad("COMMAND_PATH_INVALID","Path must be a bounded JSON pointer."); String[] parts=pointer.substring(1).split("/",-1); JsonNode node=root; for(int i=0;i<parts.length-1;i++){String token=unescape(parts[i]); node=node.isArray()?node.path(index(token,node.size())):node.path(token); if(node.isMissingNode()) throw bad("COMMAND_PATH_INVALID","Parent does not exist.");} return new Parent(node,unescape(parts[parts.length-1])); }
  private JsonNode at(JsonNode root,String pointer) { if(pointer==null||pointer.isEmpty()) return root; if(!pointer.startsWith("/")) return json.getNodeFactory().missingNode(); JsonNode node=root; for(String part:pointer.substring(1).split("/",-1)){String token=unescape(part); node=node.isArray()?node.path(index(token,node.size())):node.path(token);} return node; }
  private int index(String value,int size){try{int i=Integer.parseInt(value);if(i<0||i>=size)throw new NumberFormatException();return i;}catch(Exception e){throw bad("COMMAND_PATH_INVALID","Array index is invalid.");}}
  private String unescape(String value){return value.replace("~1","/").replace("~0","~");}

  private JsonNode remapIds(JsonNode source) { JsonNode copy=source.deepCopy(); Map<String,String> ids=new LinkedHashMap<>(); collectIds(copy,ids); replaceIds(copy,ids); return copy; }
  private void collectIds(JsonNode node,Map<String,String> ids){if(node.isObject()){node.fields().forEachRemaining(e->{if("id".equals(e.getKey())&&e.getValue().isTextual())ids.putIfAbsent(e.getValue().asText(),"copy_"+UUID.randomUUID().toString().replace("-",""));collectIds(e.getValue(),ids);});}else if(node.isArray())node.forEach(n->collectIds(n,ids));}
  private void replaceIds(JsonNode node,Map<String,String> ids){if(node.isObject()){Iterator<Map.Entry<String,JsonNode>> it=node.fields();while(it.hasNext()){var e=it.next();if(e.getValue().isTextual()&&ids.containsKey(e.getValue().asText()))((ObjectNode)node).put(e.getKey(),ids.get(e.getValue().asText()));else replaceIds(e.getValue(),ids);}}else if(node.isArray())for(int i=0;i<node.size();i++){JsonNode child=node.get(i);if(child.isTextual()&&ids.containsKey(child.asText()))((ArrayNode)node).set(i,json.getNodeFactory().textNode(ids.get(child.asText())));else replaceIds(child,ids);}}

  private List<Map<String,Object>> diagnostics(JsonNode candidate){ return compiler.compile(candidate).diagnostics().stream().map(d->map("code",d.code(),"pointer",d.pointer(),"message",d.message())).toList(); }
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
  private void authorizeWrite(String w,UUID f,String d,String t){draft(f,d);authorization.requireOwnedForm(w,t,f);}
  private void draft(UUID form,String draft){if(!form.toString().equals(draft))throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Resource not found");}
  private Row row(UUID form){ Row result=db.query("select revision,definition::text from forms where id=?",rs->rs.next()?new Row(rs.getLong(1),rs.getString(2)):null,form); if(result==null)throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Resource not found"); return result; }
  private UUID actor(String header){try{HttpServletRequest request=((ServletRequestAttributes)RequestContextHolder.currentRequestAttributes()).getRequest();String session=sessions.session(request,header).orElseThrow();return db.queryForObject("select account_id from staff_sessions where token::text=?",UUID.class,session);}catch(Exception e){throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Valid staff workspace session required");}}
  private JsonNode parse(String value){try{return json.readTree(value);}catch(Exception e){throw new IllegalStateException("Stored package is not JSON",e);}}
  private String stringify(JsonNode node){try{return json.writeValueAsString(node);}catch(Exception e){throw new IllegalArgumentException("Cannot serialize JSON",e);}}
  @SuppressWarnings("unchecked") private List<Map<String,Object>> maps(Object value){if(!(value instanceof List<?> list))return List.of();return list.stream().filter(Map.class::isInstance).map(v->(Map<String,Object>)v).toList();}
  private String required(Map<String,Object> body,String key){Object value=body.get(key);if(value==null||String.valueOf(value).isBlank())throw bad("AUTHORING_REQUEST_INVALID",key+" is required.");return String.valueOf(value);}
  private boolean matches(String value,long revision){return etag(revision).equals(value);}
  private long expectedRevision(String match){try{if(match!=null&&match.matches("\"[0-9]+\""))return Long.parseLong(match.substring(1,match.length()-1));}catch(RuntimeException ignored){}return -1;}
  private String etag(long revision){return "\""+revision+"\"";}
  private ResponseStatusException bad(String code,String message){return new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,code+": "+message);}
  private Map<String,Object> map(Object... entries){Map<String,Object> out=new LinkedHashMap<>();for(int i=0;i<entries.length;i+=2)out.put(String.valueOf(entries[i]),entries[i+1]);return out;}
  private record Row(long revision,String definition){} private record Parent(JsonNode node,String token){} private record Applied(JsonNode document,Map<String,Object> inverse){} private record History(UUID id,String inverse,String command){} private record Candidate(long baseRevision,String digest,String json,String state){} private record Component(int version,String fragment,String hash){}
}
