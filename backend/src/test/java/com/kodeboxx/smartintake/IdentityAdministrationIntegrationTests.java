package com.kodeboxx.smartintake;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.kodeboxx.smartintake.security.IdentityAdministrationService;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.server.ResponseStatusException;

@ActiveProfiles("test")
@SpringBootTest
class IdentityAdministrationIntegrationTests {
  @Autowired JdbcTemplate db;
  @Autowired IdentityAdministrationService administration;

  UUID actor;
  UUID organization;
  String sessionToken;

  @BeforeEach
  void setUp() {
    db.execute("truncate table staff_sessions, identity_secret_actions, identity_invitations, organization_memberships, platform_roles, memberships, workspaces, organizations, accounts cascade");
    actor = account("admin@example.test");
    organization = organization("Primary");
    UUID workspace = UUID.randomUUID();
    db.update("insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?)", workspace, organization, "primary", "Primary");
    db.update("insert into memberships(account_id,workspace_id,role) values(?,?,?)", actor, workspace, "OWNER");
    db.update("insert into organization_memberships(account_id,organization_id,roles) values(?,?,array['owner','administrator'])", actor, organization);
    db.update("insert into platform_roles(account_id,role) values(?,'administrator')", actor);
    sessionToken = UUID.randomUUID().toString();
    db.update("insert into staff_sessions(token,account_id,expires_at,absolute_expires_at,last_seen_at) values(?,?,now()+interval '2 hours',now()+interval '12 hours',now())", UUID.fromString(sessionToken), actor);
  }

  @Test
  void activationCapabilityIsDeliveredOnceToAuthorizedIssuerAndCanBeConsumed() {
    ResponseEntity<?> created = administration.createUser(opaque("organization", organization),
        new IdentityAdministrationService.UserCreate("new@example.test", List.of("member"), "temporary-password"), request());
    assertEquals(HttpStatus.CREATED, created.getStatusCode());
    String link = created.getHeaders().getFirst("X-Activation-Copy-Link");
    assertTrue(link.startsWith("/activate/"));
    assertFalse(created.getBody().toString().contains(link.substring("/activate/".length())));

    String proof = link.substring("/activate/".length());
    assertEquals(HttpStatus.NO_CONTENT, administration.activate(new IdentityAdministrationService.Activation(proof, "replacement-password", "New user")).getStatusCode());
    assertEquals("active", db.queryForObject("select activation_state from accounts where email='new@example.test'", String.class));
    assertThrows(ResponseStatusException.class, () -> administration.activate(new IdentityAdministrationService.Activation(proof, "another-password", "New user")));
  }

  @Test
  void invitationReplacementRevokesPriorProofAndUnknownRecipientCreatesAccountOnAcceptance() {
    UUID invited = account("invitee@example.test");
    ResponseEntity<?> first = administration.invite(opaque("organization", organization), opaque("account", invited), request());
    ResponseEntity<?> second = administration.invite(opaque("organization", organization), opaque("account", invited), request());
    String oldProof = first.getHeaders().getFirst("X-Invitation-Copy-Link").substring("/invite/".length());
    String currentProof = second.getHeaders().getFirst("X-Invitation-Copy-Link").substring("/invite/".length());
    assertThrows(ResponseStatusException.class, () -> administration.accept(new IdentityAdministrationService.InviteAccept(oldProof, "password-for-invite")));
    assertEquals(HttpStatus.OK, administration.accept(new IdentityAdministrationService.InviteAccept(currentProof, "password-for-invite")).getStatusCode());
    assertThrows(ResponseStatusException.class, () -> administration.accept(new IdentityAdministrationService.InviteAccept(currentProof, "password-for-invite")));
  }

  @Test
  void tenantAuthoritiesCannotCrossOrganizationsAndLastActiveOwnerCannotBeRemoved() {
    UUID otherOrganization = organization("Other");
    ResponseStatusException crossTenant = assertThrows(ResponseStatusException.class,
        () -> administration.users(opaque("organization", otherOrganization), request()));
    assertEquals(HttpStatus.FORBIDDEN, crossTenant.getStatusCode());
    ResponseStatusException lastOwner = assertThrows(ResponseStatusException.class,
        () -> administration.removeUser(opaque("organization", organization), opaque("account", actor), request()));
    assertEquals(HttpStatus.CONFLICT, lastOwner.getStatusCode());
  }

  @Test
  void concurrentOwnerRemovalLeavesAnActiveOwner() throws Exception {
    UUID secondOwner = account("second-owner@example.test");
    db.update("insert into organization_memberships(account_id,organization_id,roles) values(?,?,array['owner','administrator'])", secondOwner, organization);
    String org = opaque("organization", organization);
    CompletableFuture<HttpStatusCode> first = CompletableFuture.supplyAsync(() -> removeStatus(org, opaque("account", actor)));
    CompletableFuture<HttpStatusCode> second = CompletableFuture.supplyAsync(() -> removeStatus(org, opaque("account", secondOwner)));
    List<HttpStatusCode> statuses = List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS));
    assertEquals(1, statuses.stream().filter(status -> status == HttpStatus.NO_CONTENT).count());
    assertEquals(1, db.queryForObject("select count(*) from organization_memberships om join accounts a on a.id=om.account_id where om.organization_id=? and om.membership_status='active' and om.roles @> array['owner']::text[] and a.account_status='active' and a.activation_state='active'", Integer.class, organization));
  }

  @Test
  void platformSuspensionRevokesSessionsAndRoleInputsAreAllowlisted() {
    UUID target = account("target@example.test");
    String targetSession = UUID.randomUUID().toString();
    db.update("insert into staff_sessions(token,account_id,expires_at,absolute_expires_at,last_seen_at) values(?,?,now()+interval '2 hours',now()+interval '12 hours',now())", UUID.fromString(targetSession), target);
    assertEquals(HttpStatus.OK, administration.updatePlatformAccount(opaque("account", target), new IdentityAdministrationService.PlatformAccountUpdate("suspended"), request()).getStatusCode());
    assertEquals(1, db.queryForObject("select count(*) from staff_sessions where token::text=? and revoked_at is not null", Integer.class, targetSession));
    assertThrows(ResponseStatusException.class, () -> administration.workspaceRoles("missing", opaque("account", target), new IdentityAdministrationService.Roles(List.of("administrator")), request()));
  }

  private HttpStatusCode removeStatus(String organization, String account) {
    try {
      return administration.removeUser(organization, account, request()).getStatusCode();
    } catch (ResponseStatusException expected) {
      return expected.getStatusCode();
    } catch (CannotAcquireLockException expected) {
      return HttpStatus.CONFLICT;
    }
  }

  private MockHttpServletRequest request() {
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("X-Staff-Session", sessionToken);
    return request;
  }

  private UUID account(String email) {
    UUID account = UUID.randomUUID();
    db.update("insert into accounts(id,email,password_hash,account_status,activation_state) values(?,?,?,'active','active')", account, email, "unused");
    return account;
  }

  private UUID organization(String name) {
    UUID id = UUID.randomUUID();
    db.update("insert into organizations(id,name,organization_status) values(?,?,'active')", id, name);
    return id;
  }

  private static String opaque(String prefix, UUID id) { return prefix + "-" + id; }
}
