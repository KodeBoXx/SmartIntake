package com.kodeboxx.smartintake;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.kodeboxx.smartintake.contract.CanonicalJson;
import com.kodeboxx.smartintake.publication.GovernedPublicationService;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/** Explicit, opt-in live-browser fixture. Run only with -Dtest=M8LiveFixtureProvisioner. */
@ActiveProfiles("test")
@SpringBootTest
class M8LiveFixtureProvisioner {
  @Autowired JdbcTemplate db;
  @Autowired ObjectMapper json;
  @Autowired GovernedPublicationService governed;

  @Test void provision() throws Exception {
    UUID account=UUID.randomUUID(),form=UUID.randomUUID(),workspaceId=UUID.randomUUID(),org=UUID.randomUUID();
    String token=UUID.randomUUID().toString(),workspace="m8-live-"+form.toString().substring(0,8);
    db.update("insert into accounts(id,email,password_hash) values(?,?,?)",account,account+"@example.test","x");
    db.update("insert into organizations(id,name) values(?,?)",org,"M8 Live");
    db.update("insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?)",workspaceId,org,workspace,"M8 Live");
    db.update("insert into organization_memberships(account_id,organization_id,roles,membership_status) values(?,?,array['member'],'active')",account,org);
    for(String role:List.of("AUTHOR","REVIEWER","PUBLISHER"))db.update("insert into memberships(account_id,workspace_id,role) values(?,?,?)",account,workspaceId,role);
    db.update("insert into staff_sessions(token,account_id,expires_at,absolute_expires_at,last_seen_at) values(?,?,now()+interval '8 hours',now()+interval '8 hours',now())",UUID.fromString(token),account);
    ObjectNode definition=(ObjectNode)json.readTree(Files.readString(Path.of("../docs/contracts/smart-form-builder-lite/4.0.0/fixtures/package.positive.json")));
    ((ArrayNode)definition.at("/flow/phases/0/pages/0/sections/0/nodes")).add(json.readTree("{\"id\":\"review\",\"kind\":\"review\",\"labelKey\":\"title\"}"));
    db.update("insert into forms(id,workspace_id,form_key,title,definition,revision,compatibility_profile_key) values(?,?,?,?,cast(? as jsonb),1,?)",form,workspaceId,"m8-live-"+form.toString().substring(0,8),"M8 Live",json.writeValueAsString(definition),"canonical-4.0.0");
    String hash=CanonicalJson.sha256(definition);
    for(JsonNode locale:definition.path("supportedLocales"))db.update("insert into form_authoring_locale_reviews(form_id,draft_id,locale,source_revision,source_package_hash,status,reviewed_by,reviewed_at) values(?,?,?,?,?,'APPROVED',?,now())",form,form,locale.asText(),1,hash,account);
    MockHttpServletRequest request=new MockHttpServletRequest();request.addHeader("X-Staff-Session",token);RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    UUID review=UUID.fromString(governed.requestReview(workspace,form,token).get("reviewRequestId").toString());governed.approve(workspace,form,review,token);
    @SuppressWarnings("unchecked") Map<String,Object> published=(Map<String,Object>)governed.publish(workspace,form,review,token).getBody();UUID release=UUID.fromString(published.get("releaseId").toString());
    Map<String,Object> channels=new LinkedHashMap<>();channels.put("link",channel(workspace,form,release,"LINK",List.of(),token));channels.put("qr",channel(workspace,form,release,"QR",List.of(),token));channels.put("iframe",channel(workspace,form,release,"IFRAME",List.of("https://embed.example.test"),token));
    Map<String,Object> fixture=Map.of("workspace",workspace,"formId",form,"releaseId",release,"staffSession",token,"parentOrigin","https://embed.example.test","channels",channels);
    Files.writeString(Path.of("/var/tmp/m8-live-fixture.json"),json.writerWithDefaultPrettyPrinter().writeValueAsString(fixture));
  }

  private UUID channel(String workspace,UUID form,UUID release,String type,List<String> origins,String token){Map<String,Object> input=new LinkedHashMap<>();input.put("type",type);input.put("allowedOrigins",origins);return UUID.fromString(governed.createChannel(workspace,form,release,input,token).get("channelId").toString());}
}
