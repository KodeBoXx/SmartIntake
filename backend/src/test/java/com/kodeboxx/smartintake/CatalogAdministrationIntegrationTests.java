package com.kodeboxx.smartintake;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

@ActiveProfiles("test")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CatalogAdministrationIntegrationTests {
  @LocalServerPort int port;
  @Autowired TestRestTemplate http;
  @Autowired JdbcTemplate db;
  @Autowired ObjectMapper json;
  UUID organization, firstWorkspace, secondWorkspace, owner, otherOwner, author, viewer, firstForm, secondForm, thirdForm;
  String ownerToken, otherToken, authorToken, viewerToken;

  @BeforeEach void setup() {
    db.execute("truncate table forms, accounts, organizations cascade");
    organization = UUID.randomUUID(); firstWorkspace = UUID.randomUUID(); secondWorkspace = UUID.randomUUID();
    owner = UUID.randomUUID(); otherOwner = UUID.randomUUID(); author = UUID.randomUUID(); viewer = UUID.randomUUID();
    ownerToken = UUID.randomUUID().toString(); otherToken = UUID.randomUUID().toString(); authorToken = UUID.randomUUID().toString(); viewerToken = UUID.randomUUID().toString();
    db.update("insert into organizations(id,name) values(?,?)", organization, "Org");
    db.update("insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?),(?,?,?,?)", firstWorkspace, organization, "catalog-a", "A", secondWorkspace, organization, "catalog-b", "B");
    account(owner, "owner@catalog.test", firstWorkspace, "WORKSPACE_ADMINISTRATOR", ownerToken);
    account(otherOwner, "other@catalog.test", secondWorkspace, "WORKSPACE_ADMINISTRATOR", otherToken);
    account(author, "author@catalog.test", firstWorkspace, "AUTHOR", authorToken);
    account(viewer, "viewer@catalog.test", firstWorkspace, "REVIEWER", viewerToken);
    firstForm = form(firstWorkspace, "alpha-form", "Alpha intake", "2026-01-03T00:00:00Z");
    secondForm = form(firstWorkspace, "beta-form", "Beta intake", "2026-01-02T00:00:00Z");
    thirdForm = form(firstWorkspace, "gamma-form", "Gamma intake", "2026-01-01T00:00:00Z");
    form(secondWorkspace, "other-form", "Other workspace", "2026-01-04T00:00:00Z");
    db.update("insert into form_catalog_metadata(form_id,owner_account_id) values(?,?),(?,?),(?,?)", firstForm, owner, secondForm, owner, thirdForm, owner);
  }

  @Test void catalogIsWorkspaceScopedAndCursorIsDeterministicAndDuplicateFree() throws Exception {
    ResponseEntity<String> first = call("catalog-a/catalog/forms?limit=1", HttpMethod.GET, ownerToken, null);
    assertEquals(HttpStatus.OK, first.getStatusCode());
    Map<String, Object> firstPage = object(first);
    assertEquals("alpha-form", ((Map<?, ?>) ((List<?>) firstPage.get("items")).get(0)).get("formKey"));
    String cursor = (String) firstPage.get("nextCursor"); assertFalse(cursor.isBlank());
    ResponseEntity<String> second = call("catalog-a/catalog/forms?limit=1&cursor=" + cursor, HttpMethod.GET, ownerToken, null);
    Map<String, Object> secondPage = object(second);
    assertEquals("beta-form", ((Map<?, ?>) ((List<?>) secondPage.get("items")).get(0)).get("formKey"));
    assertNotEquals(((Map<?, ?>) ((List<?>) firstPage.get("items")).get(0)).get("id"), ((Map<?, ?>) ((List<?>) secondPage.get("items")).get(0)).get("id"));
    assertEquals(HttpStatus.BAD_REQUEST, call("catalog-a/catalog/forms?limit=1&status=DRAFT&cursor=" + cursor, HttpMethod.GET, ownerToken, null).getStatusCode());
    assertEquals(HttpStatus.OK, call("workspace-" + firstWorkspace + "/catalog/forms?limit=1", HttpMethod.GET, ownerToken, null).getStatusCode());
    db.update("update form_catalog_metadata set archived_at=now() where form_id=?", thirdForm);
    assertEquals(HttpStatus.CONFLICT, call("catalog-a/catalog/forms?limit=1&cursor=" + cursor, HttpMethod.GET, ownerToken, null).getStatusCode());
    assertEquals(HttpStatus.NOT_FOUND, call("catalog-b/catalog/forms", HttpMethod.GET, ownerToken, null).getStatusCode());
  }

  @Test void freshWorkspaceWithoutRevisionRowReturnsAnEmptyCatalog() throws Exception {
    db.update("delete from forms where workspace_id=?", firstWorkspace);
    db.update("delete from catalog_workspace_revisions where workspace_id=?", firstWorkspace);
    ResponseEntity<String> response = call("catalog-a/catalog/forms", HttpMethod.GET, ownerToken, null);
    assertEquals(HttpStatus.OK, response.getStatusCode());
    assertEquals(List.of(), object(response).get("items"));
    assertEquals("", object(response).get("nextCursor"));
  }

  @Test void folderTagFiltersAndCatalogMutationsUseCurrentServerRole() throws Exception {
    String folder = id(call("catalog-a/folders", HttpMethod.POST, authorToken, Map.of("name", "Clinical")));
    String tag = id(call("catalog-a/tags", HttpMethod.POST, authorToken, Map.of("name", "priority", "color", "#1144aa")));
    assertEquals(HttpStatus.NO_CONTENT, call("catalog-a/catalog/forms/" + firstForm + "/classification", HttpMethod.PUT, authorToken, Map.of("folderId", folder, "tagIds", List.of(tag))).getStatusCode());
    Map<String, Object> filtered = object(call("catalog-a/catalog/forms?folder=" + folder + "&tag=priority", HttpMethod.GET, authorToken, null));
    assertEquals(1, ((List<?>) filtered.get("items")).size());
    assertEquals(firstForm.toString(), ((Map<?, ?>) ((List<?>) filtered.get("items")).get(0)).get("id"));
    assertEquals(HttpStatus.FORBIDDEN, call("catalog-a/catalog/forms/" + firstForm + "/archive", HttpMethod.POST, viewerToken, null).getStatusCode());
    assertEquals(HttpStatus.OK, call("catalog-a/catalog/forms/" + firstForm + "/archive", HttpMethod.POST, authorToken, null).getStatusCode());
    assertEquals(0, ((List<?>) object(call("catalog-a/catalog/forms?tag=priority", HttpMethod.GET, authorToken, null)).get("items")).size());
    assertEquals(1, ((List<?>) object(call("catalog-a/catalog/forms?tag=priority&archived=true", HttpMethod.GET, authorToken, null)).get("items")).size());
    assertEquals(1, ((List<?>) object(call("catalog-a/catalog/forms?status=ARCHIVED", HttpMethod.GET, authorToken, null)).get("items")).size());
    assertEquals(HttpStatus.OK, call("catalog-a/catalog/forms/" + firstForm + "/restore", HttpMethod.POST, authorToken, null).getStatusCode());
    ResponseEntity<String> copy = call("catalog-a/catalog/forms/" + firstForm + "/duplicate", HttpMethod.POST, authorToken, null);
    assertEquals(HttpStatus.CREATED, copy.getStatusCode());
    assertTrue(String.valueOf(object(copy).get("formKey")).contains("-copy-"));
  }

  @Test void catalogAcceptsOnlyPrdWorkspaceRolesAndRetainsOwnerCompatibility() throws Exception {
    assertEquals(HttpStatus.OK, call("catalog-a/catalog/forms", HttpMethod.GET, viewerToken, null).getStatusCode());
    assertEquals(HttpStatus.FORBIDDEN, call("catalog-a/folders", HttpMethod.POST, viewerToken, Map.of("name", "Denied")).getStatusCode());

    assertEquals(HttpStatus.CREATED, call("catalog-a/folders", HttpMethod.POST, authorToken, Map.of("name", "Author folder")).getStatusCode());
    assertEquals(HttpStatus.FORBIDDEN, call("catalog-a/catalog/settings", HttpMethod.GET, authorToken, null).getStatusCode());

    UUID legacyOwner = UUID.randomUUID();
    String legacyOwnerToken = UUID.randomUUID().toString();
    account(legacyOwner, "legacy-owner@catalog.test", firstWorkspace, "OWNER", legacyOwnerToken);
    assertEquals(HttpStatus.OK, call("catalog-a/catalog/settings", HttpMethod.GET, legacyOwnerToken, null).getStatusCode());

    UUID organizationAdministrator = UUID.randomUUID();
    String organizationAdministratorToken = UUID.randomUUID().toString();
    db.update("insert into accounts(id,email,password_hash) values(?,?,?)", organizationAdministrator, "organization-admin@catalog.test", "unused");
    db.update("insert into organization_memberships(account_id,organization_id,roles) values(?,?,array['administrator'])", organizationAdministrator, organization);
    db.update("insert into staff_sessions(token,account_id,expires_at) values(?,?,now()+interval '1 hour')", UUID.fromString(organizationAdministratorToken), organizationAdministrator);
    assertEquals(HttpStatus.NOT_FOUND, call("catalog-a/catalog/forms", HttpMethod.GET, organizationAdministratorToken, null).getStatusCode());
  }

  @Test void authoringAndWorkspaceAdministrationRemainMutuallyExclusive() throws Exception {
    assertEquals(HttpStatus.FORBIDDEN, call("catalog-a/catalog/forms/" + firstForm + "/duplicate", HttpMethod.POST, ownerToken, null).getStatusCode());
    assertEquals(HttpStatus.FORBIDDEN, call("catalog-a/folders", HttpMethod.POST, ownerToken, Map.of("name", "Administrator folder")).getStatusCode());
    assertEquals(HttpStatus.FORBIDDEN, call("catalog-a/catalog/forms/" + firstForm + "/classification", HttpMethod.PUT, ownerToken, Map.of("tagIds", List.of())).getStatusCode());

    assertEquals(HttpStatus.CREATED, call("catalog-a/catalog/forms/" + firstForm + "/duplicate", HttpMethod.POST, authorToken, null).getStatusCode());
    assertEquals(HttpStatus.NO_CONTENT, call("catalog-a/catalog/forms/" + firstForm + "/classification", HttpMethod.PUT, authorToken, Map.of("tagIds", List.of())).getStatusCode());
    assertEquals(HttpStatus.FORBIDDEN, call("catalog-a/catalog/settings", HttpMethod.GET, authorToken, null).getStatusCode());
    assertEquals(HttpStatus.FORBIDDEN, call("catalog-a/catalog/forms/" + firstForm + "/ownership", HttpMethod.PUT, authorToken, Map.of("accountId", "account-" + viewer)).getStatusCode());

    assertEquals(HttpStatus.OK, call("catalog-a/catalog/settings", HttpMethod.GET, ownerToken, null).getStatusCode());
    assertEquals(HttpStatus.OK, call("catalog-a/catalog/forms/" + firstForm + "/ownership", HttpMethod.PUT, ownerToken, Map.of("accountId", "account-" + author)).getStatusCode());
  }

  @Test void ownershipAndEffectiveSettingsRemainInsideWorkspace() throws Exception {
    db.update("insert into memberships(account_id,workspace_id,role) values(?,?,?)", viewer, firstWorkspace, "AUTHOR");
    assertEquals(HttpStatus.OK, call("catalog-a/catalog/forms/" + firstForm + "/ownership", HttpMethod.PUT, ownerToken, Map.of("accountId", "account-" + viewer)).getStatusCode());
    assertEquals(viewer, db.queryForObject("select owner_account_id from form_catalog_metadata where form_id=?", UUID.class, firstForm));
    assertEquals(HttpStatus.BAD_REQUEST, call("catalog-a/catalog/forms/" + firstForm + "/ownership", HttpMethod.PUT, ownerToken, Map.of("accountId", "account-" + otherOwner)).getStatusCode());
    db.update("insert into catalog_organization_settings(organization_id,policy_settings,provider_settings) values(?,cast(? as jsonb),cast(? as jsonb))", organization, "{\"retention\":{\"days\":30},\"enabled\":true}", "{\"email\":{\"enabled\":false}}");
    ResponseEntity<String> changed = call("catalog-a/catalog/settings", HttpMethod.PUT, ownerToken, Map.of("policyOverrides", Map.of("retention", Map.of("days", 7)), "providerOverrides", Map.of("email", Map.of("from", "noreply@example.test"))));
    assertEquals(HttpStatus.OK, changed.getStatusCode());
    Map<String, Object> effective = (Map<String, Object>) object(changed).get("effective");
    Map<String, Object> policy = (Map<String, Object>) effective.get("policy");
    assertEquals(7, ((Map<?, ?>) policy.get("retention")).get("days"));
    Map<String, Object> providers = (Map<String, Object>) effective.get("providers");
    assertEquals(false, ((Map<?, ?>) providers.get("email")).get("enabled"));
    assertEquals("noreply@example.test", ((Map<?, ?>) providers.get("email")).get("from"));
    Map<String, Object> overrides = (Map<String, Object>) object(changed).get("overrides");
    assertEquals(Map.of("retention", Map.of("days", 7)), overrides.get("policy"));
  }

  private void account(UUID id, String email, UUID workspace, String role, String token) {
    db.update("insert into accounts(id,email,password_hash) values(?,?,?)", id, email, "unused");
    db.update("insert into organization_memberships(account_id,organization_id,roles,membership_status) select ?,organization_id,array['member'],'active' from workspaces where id=?", id, workspace);
    db.update("insert into memberships(account_id,workspace_id,role) values(?,?,?)", id, workspace, role);
    db.update("insert into staff_sessions(token,account_id,expires_at) values(?,?,now()+interval '1 hour')", UUID.fromString(token), id);
  }
  private UUID form(UUID workspace, String key, String title, String updated) {
    UUID id = UUID.randomUUID();
    db.update("insert into forms(id,workspace_id,form_key,title,definition,updated_at) values(?,?,?,?,cast(? as jsonb),?::timestamptz)", id, workspace, key, title, "{}", updated);
    return id;
  }
  private ResponseEntity<String> call(String path, HttpMethod method, String token, Object body) {
    HttpHeaders headers = new HttpHeaders(); headers.setContentType(MediaType.APPLICATION_JSON); headers.set("X-Staff-Session", token);
    return http.exchange("http://localhost:" + port + "/v1/workspaces/" + path, method, new HttpEntity<>(body, headers), String.class);
  }
  private Map<String, Object> object(ResponseEntity<String> response) throws Exception { return json.readValue(response.getBody(), new TypeReference<>() {}); }
  private String id(ResponseEntity<String> response) throws Exception { assertEquals(HttpStatus.CREATED, response.getStatusCode()); return (String) object(response).get("id"); }
}
