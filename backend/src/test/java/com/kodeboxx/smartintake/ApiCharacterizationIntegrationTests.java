package com.kodeboxx.smartintake;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kodeboxx.smartintake.compatibility.RespondentSecretVerifier;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.*;
import org.springframework.boot.test.web.client.*;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import static org.junit.jupiter.api.Assertions.*;

/**
 * M1 characterization for the complete legacy /v1 route surface. Assertions deliberately
 * describe observed Lite behavior rather than introducing a future contract.
 */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
class ApiCharacterizationIntegrationTests {
 @LocalServerPort int port; @Autowired TestRestTemplate http; @Autowired JdbcTemplate db; @Autowired ObjectMapper json; @Autowired RespondentSecretVerifier respondentSecrets;
 UUID account,form,session; String workspace,staff,respondent;
 String u(String path){return "http://localhost:"+port+"/v1"+path;}
 HttpHeaders headers(String token){HttpHeaders h=new HttpHeaders();h.setContentType(MediaType.APPLICATION_JSON);if(token!=null)h.set("X-Staff-Session",token);return h;}
 HttpHeaders respondentHeaders(){HttpHeaders h=new HttpHeaders();h.setContentType(MediaType.APPLICATION_JSON);h.set("X-Respondent-Session",respondent);return h;}
 ResponseEntity<String> call(String path,HttpMethod method,HttpHeaders headers,Object body){return http.exchange(u(path),method,new HttpEntity<>(body,headers),String.class);}
 Map<String,Object> object(String body)throws Exception{return json.readValue(body,new TypeReference<>(){});}
 @BeforeEach void seed(){
  account=UUID.randomUUID(); UUID organization=UUID.randomUUID(),workspaceId=UUID.randomUUID(); workspace="m1-"+account.toString().substring(0,8); staff=UUID.randomUUID().toString();
  db.update("insert into accounts(id,email,password_hash) values(?,?,?)",account,"m1-"+account+"@example.test",new BCryptPasswordEncoder().encode("correct-horse-battery"));
  db.update("insert into organizations(id,name) values(?,?)",organization,"M1 characterization");
  db.update("insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?)",workspaceId,organization,workspace,"M1 characterization");
  db.update("insert into memberships(account_id,workspace_id,role) values(?,?,?)",account,workspaceId,"OWNER");
  db.update("insert into staff_sessions(token,account_id,expires_at) values(?,?,now()+interval '1 hour')",UUID.fromString(staff),account);
 }
 @Test void systemAndAuthenticationRoutesRetainObservedResponses()throws Exception{
  ResponseEntity<String> health=http.getForEntity(u("/health"),String.class);
  assertEquals(HttpStatus.OK,health.getStatusCode()); assertEquals("UP",object(health.getBody()).get("status")); assertEquals("4.0.0",object(health.getBody()).get("contractVersion"));
  ResponseEntity<String> capabilities=http.getForEntity(u("/capabilities"),String.class);
  assertEquals(HttpStatus.OK,capabilities.getStatusCode()); assertTrue(capabilities.getBody().contains("fieldTypes"));
  Map<String,Object> credentials=Map.of("email","m1-"+account+"@example.test","password","correct-horse-battery");
  ResponseEntity<String> signIn=call("/auth/sign-in",HttpMethod.POST,headers(null),credentials);
  assertEquals(HttpStatus.OK,signIn.getStatusCode()); assertEquals("local",object(signIn.getBody()).get("workspaceKey"));
  String signedIn=(String)object(signIn.getBody()).get("staffSession");
  assertEquals(HttpStatus.NO_CONTENT,call("/auth/logout",HttpMethod.POST,headers(signedIn),null).getStatusCode());
  assertEquals(HttpStatus.UNAUTHORIZED,call("/workspaces/"+workspace+"/forms",HttpMethod.GET,headers(signedIn),null).getStatusCode());
  ResponseEntity<String> bootstrap=call("/auth/bootstrap",HttpMethod.POST,headers(null),Map.of("email","later@example.test","password","correct-horse-battery"));
  assertEquals(HttpStatus.CONFLICT,bootstrap.getStatusCode());
  assertEquals(HttpStatus.UNAUTHORIZED,call("/auth/sign-in",HttpMethod.POST,headers(null),Map.of("email","m1-"+account+"@example.test","password","wrong-password")).getStatusCode());
 }
 @Test void createDraftTransferPublishSessionReplaySubmissionAndExportsRemainStable()throws Exception{
  HttpHeaders staffHeaders=headers(staff); String key="form-"+UUID.randomUUID();
  ResponseEntity<String> created=call("/workspaces/"+workspace+"/forms",HttpMethod.POST,staffHeaders,Map.of("formKey",key,"title","Characterized intake"));
  assertEquals(HttpStatus.CREATED,created.getStatusCode()); assertEquals("\"1\"",created.getHeaders().getETag());
  Map<String,Object> createdBody=object(created.getBody()); form=UUID.fromString(createdBody.get("id").toString());
  assertEquals(HttpStatus.OK,call("/workspaces/"+workspace+"/forms",HttpMethod.GET,staffHeaders,null).getStatusCode());
  ResponseEntity<String> draft=call("/workspaces/"+workspace+"/forms/"+form+"/drafts/legacy-draft",HttpMethod.GET,staffHeaders,null);
  assertEquals(HttpStatus.OK,draft.getStatusCode()); assertEquals("\"1\"",draft.getHeaders().getETag());
  Map<String,Object> draftBody=object(draft.getBody()); @SuppressWarnings("unchecked") Map<String,Object> definition=(Map<String,Object>)draftBody.get("definition");
  assertEquals(HttpStatus.PRECONDITION_REQUIRED,call("/workspaces/"+workspace+"/forms/"+form+"/drafts/legacy-draft",HttpMethod.PUT,staffHeaders,Map.of("definition",definition)).getStatusCode());
  HttpHeaders stale=headers(staff);stale.setIfMatch("\"0\"");
  assertEquals(HttpStatus.PRECONDITION_FAILED,call("/workspaces/"+workspace+"/forms/"+form+"/drafts/legacy-draft",HttpMethod.PUT,stale,Map.of("definition",definition)).getStatusCode());
  HttpHeaders revisionOne=headers(staff);revisionOne.setIfMatch("\"1\"");
  ResponseEntity<String> saved=call("/workspaces/"+workspace+"/forms/"+form+"/drafts/legacy-draft",HttpMethod.PUT,revisionOne,Map.of("definition",definition));
  assertEquals(HttpStatus.OK,saved.getStatusCode());assertEquals("\"2\"",saved.getHeaders().getETag());
  ResponseEntity<String> exported=call("/workspaces/"+workspace+"/forms/"+form+"/definition-export",HttpMethod.GET,staffHeaders,null);
  assertEquals(HttpStatus.OK,exported.getStatusCode()); Map<String,Object> transferred=object(exported.getBody()); assertTrue(transferred.containsKey("packageStamp"));
  HttpHeaders invalidImportHeaders=headers(staff);invalidImportHeaders.setIfMatch("\"2\"");
  assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,call("/workspaces/"+workspace+"/forms/"+form+"/definition-import",HttpMethod.PUT,invalidImportHeaders,Map.of("contractVersion","4.0.0","pages",List.of())).getStatusCode());
  HttpHeaders revisionTwo=headers(staff);revisionTwo.setIfMatch("\"2\"");
  ResponseEntity<String> imported=call("/workspaces/"+workspace+"/forms/"+form+"/definition-import",HttpMethod.PUT,revisionTwo,transferred);
  assertEquals(HttpStatus.OK,imported.getStatusCode()); assertEquals("\"3\"",imported.getHeaders().getETag());
  ResponseEntity<String> published=call("/workspaces/"+workspace+"/forms/"+form+"/releases",HttpMethod.POST,staffHeaders,null);
  assertEquals(HttpStatus.CREATED,published.getStatusCode()); assertEquals("PUBLISHED",object(published.getBody()).get("status"));
  ResponseEntity<String> started=call("/public/forms/"+form+"/sessions",HttpMethod.POST,headers(null),Map.of("locale","en","timeZone","UTC"));
  assertEquals(HttpStatus.CREATED,started.getStatusCode()); Map<String,Object> startedBody=object(started.getBody()); session=UUID.fromString(startedBody.get("sessionId").toString()); respondent=(String)startedBody.get("respondentSession"); assertEquals(respondentSecrets.digest(UUID.fromString(respondent)),db.queryForObject("select respondent_secret_sha256 from sessions where id=?",String.class,session)); assertEquals(0,((Number)startedBody.get("revision")).intValue()); assertTrue(startedBody.containsKey("release"));
  assertEquals(HttpStatus.OK,call("/sessions/"+session,HttpMethod.GET,respondentHeaders(),null).getStatusCode());
  assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,call("/sessions/"+session+"/submissions",HttpMethod.POST,respondentHeaders(),Map.of("sessionRevision",0)).getStatusCode());
  assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,call("/sessions/"+session,HttpMethod.PATCH,respondentHeaders(),Map.of("baseRevision",0,"answers",Map.of())).getStatusCode());
  UUID mutation=UUID.randomUUID(); Map<String,Object> patch=Map.of("baseRevision",0,"clientMutationId",mutation,"answers",Map.of("full-name","=M1 User","contact-method","email","email-address","m1@example.test"));
  ResponseEntity<String> patched=call("/sessions/"+session,HttpMethod.PATCH,respondentHeaders(),patch); assertEquals(HttpStatus.OK,patched.getStatusCode()); assertEquals(1,((Number)object(patched.getBody()).get("acceptedRevision")).intValue());
  ResponseEntity<String> replay=call("/sessions/"+session,HttpMethod.PATCH,respondentHeaders(),patch); assertEquals(HttpStatus.OK,replay.getStatusCode()); assertEquals(object(patched.getBody()),object(replay.getBody()));
  assertEquals(HttpStatus.CONFLICT,call("/sessions/"+session,HttpMethod.PATCH,respondentHeaders(),Map.of("baseRevision",0,"clientMutationId",UUID.randomUUID(),"answers",Map.of())).getStatusCode());
  assertEquals(HttpStatus.OK,call("/sessions/"+session+"/validate",HttpMethod.POST,respondentHeaders(),null).getStatusCode());
  assertEquals(HttpStatus.CONFLICT,call("/sessions/"+session+"/submissions",HttpMethod.POST,respondentHeaders(),Map.of("sessionRevision",0)).getStatusCode());
  ResponseEntity<String> submitted=call("/sessions/"+session+"/submissions",HttpMethod.POST,respondentHeaders(),Map.of("sessionRevision",1)); assertEquals(HttpStatus.CREATED,submitted.getStatusCode()); UUID submission=UUID.fromString(object(submitted.getBody()).get("submissionId").toString());
  assertEquals(HttpStatus.OK,call("/workspaces/"+workspace+"/submissions",HttpMethod.GET,staffHeaders,null).getStatusCode());
  assertEquals(HttpStatus.OK,call("/workspaces/"+workspace+"/submissions/"+submission,HttpMethod.GET,staffHeaders,null).getStatusCode());
  assertEquals(HttpStatus.OK,call("/workspaces/"+workspace+"/exports.json",HttpMethod.GET,staffHeaders,null).getStatusCode());
  ResponseEntity<String> csv=call("/workspaces/"+workspace+"/exports.csv",HttpMethod.GET,staffHeaders,null); assertEquals(HttpStatus.OK,csv.getStatusCode()); assertTrue(csv.getHeaders().getContentType().isCompatibleWith(MediaType.valueOf("text/csv"))); assertTrue(csv.getBody().startsWith("submission_id,form_id,submitted_at,answers\n"),csv.getBody()); assertTrue(csv.getBody().contains("\""+submission+"\""),csv.getBody()); assertTrue(csv.getBody().contains("=M1 User"),csv.getBody()); String csvAnswerCell=csv.getBody().substring(csv.getBody().indexOf(",\"{",csv.getBody().indexOf("\n")+1)); assertTrue(csvAnswerCell.startsWith(",\"{"),csv.getBody()); assertTrue(csvAnswerCell.contains("\"\"=M1 User\"\""),csv.getBody()); assertFalse(csvAnswerCell.startsWith(",="),csv.getBody());
  assertTrue(db.queryForObject("select count(*) from audit_events where resource_id in (?,?)",Integer.class,form,submission)>=3);
 }
 @Test void routeDenialsAndObservableValidationErrorsRemainUnchanged(){
  assertEquals(HttpStatus.UNAUTHORIZED,call("/workspaces/"+workspace+"/forms",HttpMethod.GET,headers(null),null).getStatusCode());
  assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,call("/workspaces/"+workspace+"/forms",HttpMethod.POST,headers(staff),Map.of("formKey","A","title","invalid")).getStatusCode());
  assertEquals(HttpStatus.UNAUTHORIZED,call("/sessions/"+UUID.randomUUID(),HttpMethod.GET,headers(null),null).getStatusCode());
  assertEquals(HttpStatus.NOT_FOUND,call("/public/forms/"+UUID.randomUUID()+"/sessions",HttpMethod.POST,headers(null),Map.of()).getStatusCode());
 }
}
