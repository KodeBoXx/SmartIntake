package com.kodeboxx.smartintake;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.kodeboxx.smartintake.security.StaffAuthorization;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;

@ActiveProfiles("test")
@SpringBootTest
class WorkspaceRoleAuthorizationIntegrationTests {
  @Autowired JdbcTemplate db;
  @Autowired StaffAuthorization authorization;

  private UUID account;
  private UUID workspace;
  private String token;

  @BeforeEach
  void setUp() {
    db.execute("truncate table staff_sessions, organization_memberships, memberships, workspaces, organizations, accounts cascade");
    account = UUID.randomUUID();
    UUID organization = UUID.randomUUID();
    workspace = UUID.randomUUID();
    token = UUID.randomUUID().toString();
    db.update("insert into accounts(id,email,password_hash,account_status,activation_state) values(?,?,?,'active','active')", account, "roles@example.test", "hash");
    db.update("insert into organizations(id,name,organization_status) values(?,?, 'active')", organization, "Roles");
    db.update("insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?)", workspace, organization, "roles", "Roles");
    db.update("insert into staff_sessions(token,account_id,expires_at,absolute_expires_at,last_seen_at) values(?,?,now()+interval '2 hours',now()+interval '12 hours',now())", UUID.fromString(token), account);
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("X-Staff-Session", token);
    RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
  }

  @AfterEach
  void clearRequest() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void grantsAreIndependentAndLegacyOwnerIsOnlyWorkspaceAdministratorCompatibility() {
    grant("WORKSPACE_ADMINISTRATOR");
    assertEquals(workspace, authorization.authorizeWorkspaceAdministration("roles", token));
    denied(() -> authorization.authorizeAuthoring("roles", token));
    denied(() -> authorization.authorizePublishing("roles", token));
    denied(() -> authorization.authorizeResponseRead("roles", token));
    denied(() -> authorization.authorizeResponseExport("roles", token));

    grant("AUTHOR");
    assertEquals(workspace, authorization.authorizeAuthoring("roles", token));
    denied(() -> authorization.authorizePublishing("roles", token));
    denied(() -> authorization.authorizeResponseRead("roles", token));

    grant("PUBLISHER");
    assertEquals(workspace, authorization.authorizePublishing("roles", token));
    denied(() -> authorization.authorizeAuthoring("roles", token));
    denied(() -> authorization.authorizeResponseRead("roles", token));

    grant("RESPONSE_VIEWER");
    assertEquals(workspace, authorization.authorizeResponseRead("roles", token));
    denied(() -> authorization.authorizeResponseExport("roles", token));

    grant("RESPONSE_EXPORTER");
    assertEquals(workspace, authorization.authorizeResponseRead("roles", token));
    assertEquals(workspace, authorization.authorizeResponseExport("roles", token));

    grant("OWNER");
    assertEquals(workspace, authorization.authorizeWorkspaceAdministration("roles", token));
    denied(() -> authorization.authorizeAuthoring("roles", token));
  }

  @Test
  void organizationAdministratorWithoutWorkspaceGrantHasNoWorkspaceAccess() {
    UUID organization = db.queryForObject("select organization_id from workspaces where id=?", UUID.class, workspace);
    db.update("insert into organization_memberships(account_id,organization_id,roles) values(?,?,array['owner','administrator'])", account, organization);
    denied(() -> authorization.authorizeWorkspaceAdministration("roles", token));
    denied(() -> authorization.authorizeAuthoring("roles", token));
    denied(() -> authorization.authorizeResponseRead("roles", token));
  }

  private void grant(String role) {
    db.update("delete from memberships where account_id=? and workspace_id=?", account, workspace);
    db.update("insert into memberships(account_id,workspace_id,role) values(?,?,?)", account, workspace, role);
  }

  private static void denied(Runnable operation) {
    ResponseStatusException error = assertThrows(ResponseStatusException.class, operation::run);
    assertEquals(HttpStatus.FORBIDDEN, error.getStatusCode());
  }
}
