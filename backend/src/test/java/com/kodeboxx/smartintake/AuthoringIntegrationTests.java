package com.kodeboxx.smartintake;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kodeboxx.smartintake.contract.CanonicalJson;
import com.kodeboxx.smartintake.security.IdentitySessionResolver;
import com.kodeboxx.smartintake.speech.SpeechPort;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ActiveProfiles("test")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"smartintake.speech.user-daily-quota=1", "smartintake.speech.tenant-daily-quota=1"})
class AuthoringIntegrationTests {
  @LocalServerPort int port;
  @Autowired TestRestTemplate http;
  @Autowired JdbcTemplate db;
  @Autowired ObjectMapper json;
  @MockBean SpeechPort speechPort;
  UUID account, form;
  String workspace, token;

  @BeforeEach void seed() throws Exception {
    account=UUID.randomUUID(); UUID org=UUID.randomUUID(), ws=UUID.randomUUID(); form=UUID.randomUUID(); token=UUID.randomUUID().toString(); workspace="m7-"+form.toString().substring(0,8);
    db.update("insert into accounts(id,email,password_hash) values(?,?,?)",account,account+"@example.test","x");
    db.update("insert into organizations(id,name) values(?,?)",org,"M7");
    db.update("insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?)",ws,org,workspace,"M7");
    db.update("insert into organization_memberships(account_id,organization_id,roles,membership_status) values(?,?,array['member'],'active')",account,org);
    for (String role : List.of("AUTHOR", "TRANSLATOR", "REVIEWER", "PUBLISHER"))
      db.update("insert into memberships(account_id,workspace_id,role) values(?,?,?)",account,ws,role);
    db.update("insert into staff_sessions(token,account_id,expires_at) values(?,?,now()+interval '1 hour')",UUID.fromString(token),account);
    db.update("insert into forms(id,workspace_id,form_key,title,definition,revision,compatibility_profile_key) values(?,?,?,?,cast(? as jsonb),1,?)",form,ws,"m7-"+form.toString().substring(0,8),"M7",fixture(),"canonical-4.0.0");
  }

  @Test void persists_bounded_history_undo_conflicts_and_side_effect_free_preview() throws Exception {
    long revision=1;
    for(int i=0;i<100;i++) {
      ResponseEntity<String> saved=call("/commands",HttpMethod.POST,"\""+revision+"\"",Map.of("commands",List.of(Map.of("op","set","path","/translations/en/messages/q.name","value","Full name "+i))));
      assertEquals(HttpStatus.OK,saved.getStatusCode()); revision++;
    }
    assertEquals(100,db.queryForObject("select count(*) from form_authoring_history where form_id=? and operation='COMMAND_BATCH'",Integer.class,form));
    for(int i=0;i<100;i++) { ResponseEntity<String> undone=call("/undo",HttpMethod.POST,"\""+revision+"\"",Map.of()); assertEquals(HttpStatus.OK,undone.getStatusCode()); revision++; }
    ResponseEntity<String> redone=call("/redo",HttpMethod.POST,"\""+revision+"\"",Map.of());
    assertEquals(HttpStatus.OK,redone.getStatusCode()); revision++;
    ResponseEntity<String> stale=call("/commands",HttpMethod.POST,"\"1\"",Map.of("commands",List.of(Map.of("op","set","path","/translations/en/messages/q.name","value","Stale"))));
    assertEquals(HttpStatus.PRECONDITION_FAILED,stale.getStatusCode());
    assertEquals(1,db.queryForObject("select count(*) from form_authoring_conflicts where form_id=?",Integer.class,form));
    assertEquals(1L,db.queryForObject("select expected_revision from form_authoring_conflicts where form_id=?",Long.class,form));
    int sessions=db.queryForObject("select count(*) from sessions",Integer.class); int submissions=db.queryForObject("select count(*) from submissions",Integer.class);
    ResponseEntity<String> preview=call("/preview",HttpMethod.POST,null,Map.of("answers",Map.of("synthetic",true)));
    assertEquals(HttpStatus.OK,preview.getStatusCode()); assertTrue(preview.getBody().contains("\"sessions\":0")); assertTrue(preview.getBody().contains("\"projection\""));
    assertEquals(sessions,db.queryForObject("select count(*) from sessions",Integer.class)); assertEquals(submissions,db.queryForObject("select count(*) from submissions",Integer.class));
  }

  @Test void normal_form_creation_persists_a_canonical_template_that_opens_and_accepts_a_numeric_etag_command() throws Exception {
    String formKey="canonical-"+UUID.randomUUID().toString().substring(0,8);
    ResponseEntity<String> created=forms(HttpMethod.POST,Map.of("formKey",formKey,"title","Canonical authoring","profile","canonical-4.0.0"));
    assertEquals(HttpStatus.CREATED,created.getStatusCode(),created.getBody());
    UUID createdForm=UUID.fromString(json.readTree(created.getBody()).path("id").asText());
    assertEquals("canonical-4.0.0",db.queryForObject("select compatibility_profile_key from forms where id=?",String.class,createdForm));
    var definition=json.readTree(created.getBody()).path("definition");
    assertEquals(List.of("en", "hi", "ar"), json.convertValue(definition.path("supportedLocales"), new TypeReference<List<String>>() {}));
    assertEquals("ltr",definition.at("/translations/hi/direction").asText());
    assertEquals("rtl",definition.at("/translations/ar/direction").asText());
    assertEquals(3,db.queryForObject("select count(*) from form_authoring_locale_reviews where form_id=? and draft_id=? and source_revision=1 and status='DRAFT'",Integer.class,createdForm,createdForm));

    ResponseEntity<String> opened=authoringCall(createdForm,"",HttpMethod.GET,null,null);
    assertEquals(HttpStatus.OK,opened.getStatusCode(),opened.getBody());
    assertEquals("\"1\"",opened.getHeaders().getETag());
    assertEquals("smart-form-package",json.readTree(opened.getBody()).at("/definition/kind").asText());

    ResponseEntity<String> saved=authoringCall(createdForm,"/commands",HttpMethod.POST,"\"1\"",Map.of(
        "commands",List.of(Map.of("op","set","path","/translations/en/messages/q.name","value","Created name"))));
    assertEquals(HttpStatus.OK,saved.getStatusCode(),saved.getBody());
    assertEquals("\"2\"",saved.getHeaders().getETag());
  }

  @Test void canonical_locale_reviews_are_repeatable_after_nontranslation_edits_and_new_forms() throws Exception {
    String formKey="reviewable-"+UUID.randomUUID().toString().substring(0,8);
    ResponseEntity<String> created=forms(HttpMethod.POST,Map.of("formKey",formKey,"title","Reviewable canonical form","profile","canonical-4.0.0"));
    assertEquals(HttpStatus.CREATED,created.getStatusCode(),created.getBody());
    UUID createdForm=UUID.fromString(json.readTree(created.getBody()).path("id").asText());
    String initialHash=CanonicalJson.sha256(json.readTree(created.getBody()).path("definition"));
    assertEquals(3,db.queryForObject("select count(*) from form_authoring_locale_reviews where form_id=? and draft_id=? and source_revision=1 and source_package_hash=? and status='DRAFT'",Integer.class,createdForm,createdForm,initialHash));

    assertEquals(HttpStatus.OK,authoringCall(createdForm,"/content",HttpMethod.PUT,"\"1\"",Map.of("approveLocales",List.of("en", "hi", "ar")),"approve-v1").getStatusCode());
    ResponseEntity<String> edit=authoringCall(createdForm,"/commands",HttpMethod.POST,"\"1\"",Map.of("commands",List.of(Map.of("op","set","path","/theme/tokens/accent","value","#0055AA"))),"theme-edit-v2");
    assertEquals(HttpStatus.OK,edit.getStatusCode(),edit.getBody());
    String revisedHash=json.readTree(edit.getBody()).path("packageHash").asText();
    assertEquals(3,db.queryForObject("select count(*) from form_authoring_locale_reviews where form_id=? and draft_id=? and source_revision=2 and source_package_hash=? and status='DRAFT'",Integer.class,createdForm,createdForm,revisedHash));
    assertEquals(HttpStatus.OK,authoringCall(createdForm,"/content",HttpMethod.PUT,"\"2\"",Map.of("approveLocales",List.of("en", "hi", "ar")),"approve-v2").getStatusCode());
    assertEquals(HttpStatus.CREATED,publish(createdForm).getStatusCode());
  }

  @Test void treats_omitted_profile_as_legacy_and_rejects_unknown_explicit_profiles() throws Exception {
    String legacyKey="legacy-"+UUID.randomUUID().toString().substring(0,8);
    ResponseEntity<String> omitted=forms(HttpMethod.POST,Map.of("formKey",legacyKey,"title","Legacy default"));
    assertEquals(HttpStatus.CREATED,omitted.getStatusCode(),omitted.getBody());
    UUID legacyForm=UUID.fromString(json.readTree(omitted.getBody()).path("id").asText());
    assertEquals("m1-current-prototype",db.queryForObject("select compatibility_profile_key from forms where id=?",String.class,legacyForm));

    ResponseEntity<String> rejected=forms(HttpMethod.POST,Map.of("formKey","unknown-"+UUID.randomUUID().toString().substring(0,8),"title","Unknown profile","profile","legacy-prototype"));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,rejected.getStatusCode());
  }

  @Test void canonical_creation_defaults_an_omitted_title_and_rejects_an_invalid_explicit_title() throws Exception {
    String key="untitled-"+UUID.randomUUID().toString().substring(0,8);
    ResponseEntity<String> created=forms(HttpMethod.POST,Map.of("formKey",key,"profile","canonical-4.0.0"));
    assertEquals(HttpStatus.CREATED,created.getStatusCode(),created.getBody());
    UUID createdForm=UUID.fromString(json.readTree(created.getBody()).path("id").asText());
    assertEquals("Untitled form",db.queryForObject("select title from forms where id=?",String.class,createdForm));
    assertEquals("Untitled form",json.readTree(created.getBody()).at("/definition/translations/en/messages/form.title").asText());
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,forms(HttpMethod.POST,Map.of("formKey","blank-"+UUID.randomUUID().toString().substring(0,8),"title","   ","profile","canonical-4.0.0")).getStatusCode());
  }

  @Test void preview_converts_plain_synthetic_answers_through_typed_respondent_operations() throws Exception {
    int sessions=db.queryForObject("select count(*) from sessions",Integer.class);
    int submissions=db.queryForObject("select count(*) from submissions",Integer.class);

    ResponseEntity<String> preview=call("/preview",HttpMethod.POST,null,Map.of("answers",Map.of("fld_name","Ada Lovelace")));
    assertEquals(HttpStatus.OK,preview.getStatusCode(),preview.getBody());
    var body=json.readTree(preview.getBody());
    assertTrue(body.path("diagnostics").isEmpty(),body.toPrettyString());
    assertTrue(body.at("/projection/accepted").asBoolean(),body.toPrettyString());
    assertEquals("answered",body.at("/projection/answers/fld_name/status").asText());
    assertEquals("Ada Lovelace",body.at("/projection/answers/fld_name/value").asText());
    assertEquals(sessions,db.queryForObject("select count(*) from sessions",Integer.class));
    assertEquals(submissions,db.queryForObject("select count(*) from submissions",Integer.class));
  }

  @Test void preview_uses_the_requested_locale_in_the_runtime_projection() throws Exception {
    ResponseEntity<String> created=forms(HttpMethod.POST,Map.of("formKey","localized-"+UUID.randomUUID().toString().substring(0,8),"title","Localized","profile","canonical-4.0.0"));
    UUID createdForm=UUID.fromString(json.readTree(created.getBody()).path("id").asText());
    ResponseEntity<String> preview=authoringCall(createdForm,"/preview",HttpMethod.POST,null,Map.of("locale","ar","answers",Map.of("fld_name","Ada","fld_acknowledgment",true)));
    assertEquals(HttpStatus.OK,preview.getStatusCode(),preview.getBody());
    var body=json.readTree(preview.getBody());
    assertEquals("ar",body.at("/projection/locale").asText());
    assertEquals("ar",body.at("/projection/review/reviewGates/0/locale").asText(),body.toPrettyString());
    assertEquals("q.acknowledgment",body.at("/projection/review/reviewGates/0/contentKey").asText());
  }

  @Test void round_trips_schema_valid_governed_references_and_localized_text() throws Exception {
    Map<String,Object> definition=json.readValue(fixture(),new TypeReference<>() {});
    Map<String,Object> guidance=new LinkedHashMap<>();
    Map<String,Object> messages=new LinkedHashMap<>();
    for (String scope : List.of("brief", "detailed", "glossary", "questionsAndAnswers", "narration")) {
      String messageKey="guidance."+scope.toLowerCase();
      guidance.put(scope,Map.of("id","guidance_"+scope,"messageKey",messageKey));
      messages.put(messageKey, switch (scope) {
        case "glossary" -> "{\"term\":\"meaning\"}";
        case "questionsAndAnswers" -> "[{\"question\":\"What is this?\",\"answer\":\"A governed answer.\"}]";
        default -> "Localized "+scope;
      });
    }
    assertEquals(HttpStatus.OK,call("/content",HttpMethod.PUT,"\"1\"",Map.of("guidance",guidance),"guidance-refs").getStatusCode());
    @SuppressWarnings("unchecked") Map<String,Object> translations=(Map<String,Object>) definition.get("translations");
    @SuppressWarnings("unchecked") Map<String,Object> english=(Map<String,Object>) translations.get("en");
    @SuppressWarnings("unchecked") Map<String,Object> existingMessages=(Map<String,Object>) english.get("messages");
    existingMessages.putAll(messages);
    assertEquals(HttpStatus.OK,call("/content",HttpMethod.PUT,"\"2\"",Map.of("translations",translations),"guidance-text").getStatusCode());

    ResponseEntity<String> exported=call("",HttpMethod.GET,null,null);
    assertEquals(HttpStatus.OK,exported.getStatusCode());
    JsonNode packageNode=json.readTree(exported.getBody()).path("definition");
    assertEquals("guidance_brief",packageNode.at("/guidance/brief/id").asText());
    assertEquals("guidance.brief",packageNode.at("/guidance/brief/messageKey").asText());
    assertEquals("Localized narration",packageNode.at("/translations/en/messages/guidance.narration").asText());
    assertEquals("VALID",json.readTree(call("/imports/validate",HttpMethod.POST,null,Map.of("candidate",packageNode)).getBody()).path("state").asText());
  }

  @Test void selects_a_server_approved_voice_and_resolves_only_governed_qa_answers() throws Exception {
    Map<String,Object> guidance=Map.of("questionsAndAnswers",Map.of("id","guidance_questionsAndAnswers","messageKey","guidance.questionsandanswers"));
    assertEquals(HttpStatus.OK,call("/content",HttpMethod.PUT,"\"1\"",Map.of("guidance",guidance),"qa-reference").getStatusCode());
    Map<String,Object> definition=json.readValue(fixture(),new TypeReference<>() {});
    @SuppressWarnings("unchecked") Map<String,Object> translations=(Map<String,Object>) definition.get("translations");
    @SuppressWarnings("unchecked") Map<String,Object> english=(Map<String,Object>) translations.get("en");
    @SuppressWarnings("unchecked") Map<String,Object> messages=(Map<String,Object>) english.get("messages");
    messages.put("guidance.questionsandanswers","[{\"question\":\"What is this?\",\"answer\":\"A governed answer.\",\"guidanceId\":\"guidance_name\",\"scope\":{\"pageId\":\"page_name\",\"sectionId\":\"section_name\",\"fieldId\":\"fld_name\"}}]");
    assertEquals(HttpStatus.OK,call("/content",HttpMethod.PUT,"\"2\"",Map.of("translations",translations),"qa-translation").getStatusCode());
    bindVisibleQuestionGuidance(form, "guidance_name");
    approveSpeechLocale(form, "en");
    when(speechPort.configured()).thenReturn(true);
    when(speechPort.defaultVoice("en")).thenReturn("en-approved");
    when(speechPort.approvedVoice("en","en-approved")).thenReturn(true);
    when(speechPort.synthesize("A governed answer.","en","en-approved"))
        .thenReturn(new SpeechPort.SpeechResult(true,"OK","en","audio/mpeg",new byte[] {1},2));

    Map<String,Object> scope=Map.of("pageId","page_name","sectionId","section_name","fieldId","fld_name");
    ResponseEntity<String> available=call("/speech",HttpMethod.POST,null,Map.of("locale","en","question","What is this?","scope",scope));
    assertEquals(HttpStatus.OK,available.getStatusCode());
    assertTrue(available.getBody().contains("\"available\":true"));
    verify(speechPort).synthesize("A governed answer.","en","en-approved");
    ResponseEntity<String> unavailable=call("/speech",HttpMethod.POST,null,Map.of("locale","en","question","Unknown question","scope",scope));
    assertEquals(HttpStatus.OK,unavailable.getStatusCode());
    assertTrue(unavailable.getBody().contains("SPEECH_QUESTION_NOT_FOUND"));
    verify(speechPort,times(1)).synthesize(anyString(),anyString(),anyString());
  }

  @Test void rejects_hostile_candidate_and_returns_disabled_speech_without_provider_call() throws Exception {
    List<Integer> huge=new ArrayList<>(); for(int i=0;i<100_001;i++) huge.add(i);
    ResponseEntity<String> response=call("/imports/validate",HttpMethod.POST,null,Map.of("candidate",huge));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,response.getStatusCode());
    ResponseEntity<String> speech=call("/speech",HttpMethod.POST,null,Map.of("locale","en","voice","default","text","Full name"));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,speech.getStatusCode());
  }

  @Test void refuses_provider_speech_until_the_exact_locale_review_is_trusted_and_approved() {
    when(speechPort.configured()).thenReturn(true);
    when(speechPort.approvedVoice("en","en-approved")).thenReturn(true);
    ResponseEntity<String> blocked=call("/speech",HttpMethod.POST,null,Map.of("locale","en","voice","en-approved","text","Full name"));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,blocked.getStatusCode());
    verify(speechPort,times(0)).synthesize(anyString(),anyString(),anyString());
  }

  @Test void authorizes_speech_and_enforces_configured_locale_voice_and_durable_quotas_before_invocation() throws Exception {
    ResponseEntity<String> created=forms(HttpMethod.POST,Map.of("formKey","speech-"+UUID.randomUUID().toString().substring(0,8),"title","Speech","profile","canonical-4.0.0"));
    UUID speechForm=UUID.fromString(json.readTree(created.getBody()).path("id").asText());
    when(speechPort.configured()).thenReturn(true);
    when(speechPort.approvedVoice("en","en-approved")).thenReturn(true);
    when(speechPort.synthesize("Full name","en","en-approved"))
        .thenReturn(new SpeechPort.SpeechResult(true,"OK","en","audio/mpeg",new byte[] {1,2,3},7));
    approveSpeechLocale(speechForm, "en");

    ResponseEntity<String> first=authoringCall(speechForm,"/speech",HttpMethod.POST,null,Map.of("locale","en","voice","en-approved","text","Full name"));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,first.getStatusCode(),first.getBody());
    assertEquals(0,db.queryForObject("select count(*) from form_authoring_speech_usage where organization_id=(select organization_id from workspaces where id=(select workspace_id from forms where id=?)) and scope='TENANT'",Integer.class,speechForm));

    ResponseEntity<String> wrongLocaleVoice=authoringCall(speechForm,"/speech",HttpMethod.POST,null,Map.of("locale","hi","voice","en-approved","text","पूरा नाम"));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,wrongLocaleVoice.getStatusCode());
    ResponseEntity<String> quota=authoringCall(speechForm,"/speech",HttpMethod.POST,null,Map.of("locale","en","voice","en-approved","text","Full name"));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,quota.getStatusCode());
    verify(speechPort,times(0)).synthesize("Full name","en","en-approved");

    db.update("delete from memberships where account_id=?",account);
    assertEquals(HttpStatus.FORBIDDEN,authoringCall(speechForm,"/speech",HttpMethod.POST,null,Map.of("locale","en","voice","en-approved","text","Full name")).getStatusCode());
    verify(speechPort,times(0)).synthesize(anyString(),anyString(),anyString());
  }

  @Test void commits_a_valid_canonical_candidate_and_preserves_its_normalized_digest() throws Exception {
    Object candidate=json.readValue(Files.readString(Path.of("..", "docs", "contracts", "smart-form-builder-lite", "4.0.0", "fixtures", "package-prd-inline-minimal.positive.json")), new TypeReference<>() {});
    ResponseEntity<String> validated=call("/imports/validate",HttpMethod.POST,null,Map.of("candidate",candidate));
    assertEquals(HttpStatus.OK,validated.getStatusCode());
    Map<String,Object> validation=json.readValue(validated.getBody(),new TypeReference<>() {});
    assertEquals("VALID",validation.get("state"),String.valueOf(validation));

    ResponseEntity<String> committed=call("/imports/commit",HttpMethod.POST,"\"1\"",Map.of(
        "candidateId",validation.get("candidateId"),"digest",validation.get("digest"),"mode","UPDATE"));
    assertEquals(HttpStatus.OK,committed.getStatusCode());
    Map<String,Object> saved=json.readValue(committed.getBody(),new TypeReference<>() {});
    assertEquals(validation.get("digest"),saved.get("packageHash"));

    ResponseEntity<String> document=call("",HttpMethod.GET,null,null);
    assertEquals(HttpStatus.OK,document.getStatusCode());
    Map<String,Object> exported=json.readValue(document.getBody(),new TypeReference<>() {});
    ResponseEntity<String> revalidated=call("/imports/validate",HttpMethod.POST,null,Map.of("candidate",exported.get("definition")));
    assertEquals(HttpStatus.OK,revalidated.getStatusCode());
    Map<String,Object> second=json.readValue(revalidated.getBody(),new TypeReference<>() {});
    assertEquals("VALID",second.get("state"));
    assertEquals(validation.get("digest"),second.get("digest"));
  }

  @Test void rejects_invalid_command_without_revision_or_history_and_replays_an_identical_key() throws Exception {
    long before=db.queryForObject("select revision from forms where id=?",Long.class,form);
    int history=db.queryForObject("select count(*) from form_authoring_history where form_id=?",Integer.class,form);
    ResponseEntity<String> invalid=call("/commands",HttpMethod.POST,"\"1\"",Map.of("commands",List.of(Map.of("op","remove","path","/flow"))),"invalid-command");
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,invalid.getStatusCode());
    assertEquals(before,db.queryForObject("select revision from forms where id=?",Long.class,form));
    assertEquals(history,db.queryForObject("select count(*) from form_authoring_history where form_id=?",Integer.class,form));

    Map<String,Object> body=Map.of("commands",List.of(Map.of("op","set","path","/translations/en/messages/q.name","value","Idempotent")));
    ResponseEntity<String> first=call("/commands",HttpMethod.POST,"\"1\"",body,"same-command");
    assertEquals(1,db.queryForObject("select count(*) from administration_mutation_replays where actor_id=? and idempotency_key='same-command'",Integer.class,account));
    ResponseEntity<String> replay=call("/commands",HttpMethod.POST,"\"1\"",body,"same-command");
    assertEquals(HttpStatus.OK,first.getStatusCode()); assertEquals(first.getBody(),replay.getBody());
    assertEquals(2L,db.queryForObject("select revision from forms where id=?",Long.class,form));
    assertEquals(1,db.queryForObject("select count(*) from form_authoring_history where form_id=?",Integer.class,form));
    ResponseEntity<String> mismatch=call("/commands",HttpMethod.POST,"\"1\"",Map.of("commands",List.of(Map.of("op","set","path","/translations/en/messages/q.name","value","Different"))),"same-command");
    assertEquals(HttpStatus.CONFLICT,mismatch.getStatusCode());
  }

  @Test void rejects_deep_and_long_import_candidates_before_persisting_them() {
    Object nested="x"; for(int i=0;i<65;i++) nested=Map.of("value",nested);
    ResponseEntity<String> deep=call("/imports/validate",HttpMethod.POST,null,Map.of("candidate",nested));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,deep.getStatusCode());
    ResponseEntity<String> longString=call("/imports/validate",HttpMethod.POST,null,Map.of("candidate",Map.of("text","x".repeat(32_769))));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,longString.getStatusCode());
    assertEquals(0,db.queryForObject("select count(*) from form_import_candidates where form_id=?",Integer.class,form));
  }

  @Test void inserts_a_pinned_reusable_component_copy() throws Exception {
    ResponseEntity<String> created=component(HttpMethod.POST,"",Map.of("key","name-question","name","Name question",
        "fragment",Map.of("id","component-node","kind","question","fieldId","fld_name","control","shortText")));
    assertEquals(HttpStatus.CREATED,created.getStatusCode());
    Map<String,Object> request=Map.of("path","/flow/phases/0/pages/0/sections/0/nodes/0","operation","replace");
    ResponseEntity<String> inserted=call("/components/name-question/insert",HttpMethod.POST,"\"1\"",request,"component-insert");
    assertEquals(HttpStatus.OK,inserted.getStatusCode(),inserted.getBody());
    assertEquals(1,db.queryForObject("select count(*) from form_authoring_history where form_id=? and operation='COMPONENT_INSERT'",Integer.class,form));
    assertTrue(inserted.getBody().contains("\"idMap\":{\"component-node\":\"copy_"), inserted.getBody());
    assertTrue(inserted.getBody().contains("\"kind\":\"component\""), "canonical dependencies pin component identity");
    ResponseEntity<String> replay=call("/components/name-question/insert",HttpMethod.POST,"\"1\"",request,"component-insert");
    assertEquals(HttpStatus.OK,replay.getStatusCode());
    assertEquals(inserted.getBody(),replay.getBody());
    assertEquals(2L,db.queryForObject("select revision from forms where id=?",Long.class,form));
    assertEquals(1,db.queryForObject("select count(*) from form_authoring_history where form_id=? and operation='COMPONENT_INSERT'",Integer.class,form));
    ResponseEntity<String> mismatch=call("/components/name-question/insert",HttpMethod.POST,"\"1\"",Map.of(
        "path","/flow/phases/0/pages/0/sections/0/nodes/0","operation","add"),"component-insert");
    assertEquals(HttpStatus.CONFLICT,mismatch.getStatusCode());
    assertEquals(2L,db.queryForObject("select revision from forms where id=?",Long.class,form));
  }

  @Test void exposes_three_locale_completeness_and_enforces_theme_token_locks() throws Exception {
    ResponseEntity<String> content=call("/content",HttpMethod.GET,null,null);
    assertEquals(HttpStatus.OK,content.getStatusCode());
    assertTrue(content.getBody().contains("\"en\":{\"present\":true,\"complete\":true}"));
    assertTrue(content.getBody().contains("\"hi\":{\"present\":false,\"complete\":false}"));
    assertTrue(content.getBody().contains("\"ar\":{\"present\":false,\"complete\":false}"));
    db.update("insert into memberships(account_id,workspace_id,role) select ?,workspace_id,'WORKSPACE_ADMINISTRATOR' from forms where id=?",account,form);
    Map<String,Object> theme=Map.of("themeKey","accessible-default","version","1.0.0","tokens",Map.of("accent","#175CD3","background","#FFFFFF","text","#182230","fontFamily","system","density","comfortable","radius",8));
    ResponseEntity<String> locked=call("/theme",HttpMethod.PUT,"\"1\"",Map.of("theme",theme,"locks",List.of("/tokens/accent")));
    assertEquals(HttpStatus.OK,locked.getStatusCode());
    Map<String,Object> changed=new LinkedHashMap<>(theme); changed.put("tokens",Map.of("accent","#FFFFFF","background","#FFFFFF","text","#182230","fontFamily","system","density","comfortable","radius",8));
    ResponseEntity<String> rejected=call("/theme",HttpMethod.PUT,"\"2\"",Map.of("theme",changed));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,rejected.getStatusCode());
    assertEquals(2L,db.queryForObject("select revision from forms where id=?",Long.class,form));
  }

  @Test void rejects_forged_package_review_state_without_a_trusted_approval_record() throws Exception {
    Object candidate=json.readValue(Files.readString(Path.of("..", "docs", "contracts", "smart-form-builder-lite", "4.0.0", "fixtures", "package-prd-inline-minimal.positive.json")), new TypeReference<>() {});
    ResponseEntity<String> validated=call("/imports/validate",HttpMethod.POST,null,Map.of("candidate",candidate));
    Map<String,Object> validation=json.readValue(validated.getBody(),new TypeReference<>() {});
    assertEquals(HttpStatus.OK,call("/imports/commit",HttpMethod.POST,"\"1\"",Map.of("candidateId",validation.get("candidateId"),"digest",validation.get("digest"),"mode","UPDATE")).getStatusCode());

    ResponseEntity<String> published=publish();
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,published.getStatusCode());
    assertEquals(0,db.queryForObject("select count(*) from form_authoring_locale_reviews where form_id=? and status='APPROVED'",Integer.class,form));
  }

  @Test void rejects_publication_when_a_prior_revision_approval_is_stale() throws Exception {
    Map<String,Object> fixture=json.readValue(fixture(),new TypeReference<>() {});
    @SuppressWarnings("unchecked") Map<String,Object> translations=(Map<String,Object>) fixture.get("translations");
    @SuppressWarnings("unchecked") Map<String,Object> english=(Map<String,Object>) translations.get("en");
    @SuppressWarnings("unchecked") Map<String,Object> messages=(Map<String,Object>) english.get("messages");
    messages.put("q.name", "Updated name");
    assertEquals(HttpStatus.OK,call("/content",HttpMethod.PUT,"\"1\"",Map.of("translations",translations),"translations-v2").getStatusCode());
    assertEquals(HttpStatus.OK,call("/content",HttpMethod.PUT,"\"2\"",Map.of("approveLocales",List.of("en")),"approval-v2").getStatusCode());
    assertEquals(1,db.queryForObject("select count(*) from form_authoring_locale_reviews where form_id=? and source_revision=2 and status='APPROVED'",Integer.class,form));

    @SuppressWarnings("unchecked") Map<String,Object> guidance=(Map<String,Object>) fixture.get("guidance");
    assertEquals(HttpStatus.OK,call("/content",HttpMethod.PUT,"\"2\"",Map.of("guidance",guidance),"guidance-v3").getStatusCode());
    ResponseEntity<String> published=publish();
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,published.getStatusCode());
  }

  @Test void replays_other_authoring_mutations_and_rejects_changed_key_bodies() throws Exception {
    Map<String,Object> definition=json.readValue(fixture(),new TypeReference<>() {});
    Map<String,Object> theme=Map.of("theme",definition.get("theme"));
    ResponseEntity<String> firstTheme=call("/theme",HttpMethod.PUT,"\"1\"",theme,"theme-key");
    ResponseEntity<String> replayTheme=call("/theme",HttpMethod.PUT,"\"1\"",theme,"theme-key");
    assertEquals(HttpStatus.OK,firstTheme.getStatusCode()); assertEquals(firstTheme.getBody(),replayTheme.getBody());
    assertEquals(HttpStatus.CONFLICT,call("/theme",HttpMethod.PUT,"\"1\"",Map.of("theme",Map.of()),"theme-key").getStatusCode());

    Map<String,Object> content=Map.of("guidance",definition.get("guidance"));
    ResponseEntity<String> firstContent=call("/content",HttpMethod.PUT,"\"2\"",content,"content-key");
    assertEquals(firstContent.getBody(),call("/content",HttpMethod.PUT,"\"2\"",content,"content-key").getBody());
    assertEquals(HttpStatus.CONFLICT,call("/content",HttpMethod.PUT,"\"2\"",Map.of("guidance",Map.of("brief","Changed")),"content-key").getStatusCode());

    Map<String,Object> comment=Map.of("pointer","/flow","body","Review this section");
    ResponseEntity<String> firstComment=call("/comments",HttpMethod.POST,null,comment,"comment-key");
    assertEquals(HttpStatus.CREATED,firstComment.getStatusCode());
    assertEquals(firstComment.getBody(),call("/comments",HttpMethod.POST,null,comment,"comment-key").getBody());
    assertEquals(HttpStatus.CONFLICT,call("/comments",HttpMethod.POST,null,Map.of("pointer","/flow","body","Changed"),"comment-key").getStatusCode());

    ResponseEntity<String> stale=call("/commands",HttpMethod.POST,"\"1\"",Map.of("commands",List.of(Map.of("op","set","path","/translations/en/messages/q.name","value","Stale"))),"stale-for-resolve");
    Map<String,Object> conflict=json.readValue(stale.getBody(),new TypeReference<>() {});
    Map<String,Object> resolution=Map.of("conflictId",conflict.get("conflictId"),"definition",definition);
    ResponseEntity<String> firstResolve=call("/resolve",HttpMethod.POST,"\"3\"",resolution,"resolve-key");
    assertEquals(HttpStatus.OK,firstResolve.getStatusCode());
    assertEquals(firstResolve.getBody(),call("/resolve",HttpMethod.POST,"\"3\"",resolution,"resolve-key").getBody());
    assertEquals(HttpStatus.CONFLICT,call("/resolve",HttpMethod.POST,"\"3\"",Map.of("conflictId",conflict.get("conflictId"),"definition",Map.of()),"resolve-key").getStatusCode());
  }

  @Test void rejects_governed_references_without_stable_ids_or_message_keys() {
    ResponseEntity<String> invalid=call("/content",HttpMethod.PUT,"\"1\"",Map.of("guidance",Map.of("brief",Map.of("id","invalid id","messageKey","Guidance.Bad"))),"invalid-guidance-reference");
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,invalid.getStatusCode());
  }

  private String fixture() throws Exception { return Files.readString(Path.of("..", "docs", "contracts", "smart-form-builder-lite", "4.0.0", "fixtures", "package-prd-inline-minimal.positive.json")); }
  private ResponseEntity<String> call(String suffix,HttpMethod method,String match,Object body) { return call(suffix,method,match,body,UUID.randomUUID().toString()); }
  private ResponseEntity<String> call(String suffix,HttpMethod method,String match,Object body,String key) {
    return authoringCall(form,suffix,method,match,body,key);
  }
  private ResponseEntity<String> authoringCall(UUID targetForm,String suffix,HttpMethod method,String match,Object body) {
    return authoringCall(targetForm,suffix,method,match,body,UUID.randomUUID().toString());
  }
  private ResponseEntity<String> authoringCall(UUID targetForm,String suffix,HttpMethod method,String match,Object body,String key) {
    HttpHeaders headers=new HttpHeaders(); headers.setContentType(MediaType.APPLICATION_JSON); headers.set("X-Staff-Session",token); if(match!=null)headers.setIfMatch(match); if("/commands".equals(suffix)||"/undo".equals(suffix)||"/redo".equals(suffix)||"/resolve".equals(suffix)||"/theme".equals(suffix)||"/content".equals(suffix)||"/comments".equals(suffix)||suffix.contains("/components/")||"/imports/commit".equals(suffix))headers.set("Idempotency-Key",key);
    return http.exchange("http://localhost:"+port+"/v1/workspaces/"+workspace+"/forms/"+targetForm+"/authoring/"+targetForm+suffix,method,new HttpEntity<>(body,headers),String.class);
  }
  private ResponseEntity<String> forms(HttpMethod method,Object body) {
    HttpHeaders headers=new HttpHeaders(); headers.setContentType(MediaType.APPLICATION_JSON); headers.set("X-Staff-Session",token);
    return http.exchange("http://localhost:"+port+"/v1/workspaces/"+workspace+"/forms",method,new HttpEntity<>(body,headers),String.class);
  }
  private ResponseEntity<String> publish() {
    return publish(form);
  }
  private ResponseEntity<String> publish(UUID targetForm) {
    HttpHeaders headers=new HttpHeaders(); headers.set("X-Staff-Session",token);
    return http.exchange("http://localhost:"+port+"/v1/workspaces/"+workspace+"/forms/"+targetForm+"/releases",HttpMethod.POST,new HttpEntity<>(headers),String.class);
  }
  private ResponseEntity<String> component(HttpMethod method,String suffix,Object body) {
    HttpHeaders headers=new HttpHeaders(); headers.setContentType(MediaType.APPLICATION_JSON); headers.set("X-Staff-Session",token);
    return http.exchange("http://localhost:"+port+"/v1/workspaces/"+workspace+"/reusable-components"+suffix,method,new HttpEntity<>(body,headers),String.class);
  }
  private void approveSpeechLocale(UUID targetForm, String locale) throws Exception {
    String definition=db.queryForObject("select definition::text from forms where id=?",String.class,targetForm);
    long revision=db.queryForObject("select revision from forms where id=?",Long.class,targetForm);
    assertEquals(1,db.update("update form_authoring_locale_reviews set status='APPROVED',reviewed_by=?,reviewed_at=now(),source_revision=?,source_package_hash=? where form_id=? and draft_id=? and locale=?",account,revision,CanonicalJson.sha256(json.readTree(definition)),targetForm,targetForm,locale));
  }
  private void bindVisibleQuestionGuidance(UUID targetForm, String guidanceId) throws Exception {
    com.fasterxml.jackson.databind.node.ObjectNode definition=(com.fasterxml.jackson.databind.node.ObjectNode)json.readTree(db.queryForObject("select definition::text from forms where id=?",String.class,targetForm));
    definition.at("/flow/phases/0/pages/0/sections/0/nodes/0").deepCopy();
    ((com.fasterxml.jackson.databind.node.ObjectNode)definition.at("/flow/phases/0/pages/0/sections/0/nodes/0")).put("guidanceId",guidanceId);
    db.update("update forms set definition=cast(? as jsonb) where id=?",json.writeValueAsString(definition),targetForm);
  }
}
