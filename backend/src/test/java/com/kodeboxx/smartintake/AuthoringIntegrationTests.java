package com.kodeboxx.smartintake;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kodeboxx.smartintake.security.IdentitySessionResolver;
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
import org.springframework.test.context.ActiveProfiles;

@ActiveProfiles("test")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AuthoringIntegrationTests {
  @LocalServerPort int port;
  @Autowired TestRestTemplate http;
  @Autowired JdbcTemplate db;
  @Autowired ObjectMapper json;
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
    ResponseEntity<String> created=forms(HttpMethod.POST,Map.of("formKey",formKey,"title","Canonical authoring"));
    assertEquals(HttpStatus.CREATED,created.getStatusCode(),created.getBody());
    UUID createdForm=UUID.fromString(json.readTree(created.getBody()).path("id").asText());
    assertEquals("canonical-4.0.0",db.queryForObject("select compatibility_profile_key from forms where id=?",String.class,createdForm));

    ResponseEntity<String> opened=authoringCall(createdForm,"",HttpMethod.GET,null,null);
    assertEquals(HttpStatus.OK,opened.getStatusCode(),opened.getBody());
    assertEquals("\"1\"",opened.getHeaders().getETag());
    assertEquals("smart-form-package",json.readTree(opened.getBody()).at("/definition/kind").asText());

    ResponseEntity<String> saved=authoringCall(createdForm,"/commands",HttpMethod.POST,"\"1\"",Map.of(
        "commands",List.of(Map.of("op","set","path","/translations/en/messages/q.name","value","Created name"))));
    assertEquals(HttpStatus.OK,saved.getStatusCode(),saved.getBody());
    assertEquals("\"2\"",saved.getHeaders().getETag());
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

  @Test void rejects_hostile_candidate_and_returns_disabled_speech_without_provider_call() throws Exception {
    List<Integer> huge=new ArrayList<>(); for(int i=0;i<100_001;i++) huge.add(i);
    ResponseEntity<String> response=call("/imports/validate",HttpMethod.POST,null,Map.of("candidate",huge));
    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,response.getStatusCode());
    ResponseEntity<String> speech=call("/speech",HttpMethod.POST,null,Map.of("locale","en","voice","default","text","Full name"));
    assertEquals(HttpStatus.OK,speech.getStatusCode()); assertTrue(speech.getBody().contains("SPEECH_UNAVAILABLE"));
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
    HttpHeaders headers=new HttpHeaders(); headers.set("X-Staff-Session",token);
    return http.exchange("http://localhost:"+port+"/v1/workspaces/"+workspace+"/forms/"+form+"/releases",HttpMethod.POST,new HttpEntity<>(headers),String.class);
  }
  private ResponseEntity<String> component(HttpMethod method,String suffix,Object body) {
    HttpHeaders headers=new HttpHeaders(); headers.setContentType(MediaType.APPLICATION_JSON); headers.set("X-Staff-Session",token);
    return http.exchange("http://localhost:"+port+"/v1/workspaces/"+workspace+"/reusable-components"+suffix,method,new HttpEntity<>(body,headers),String.class);
  }
}
