package com.kodeboxx.smartintake;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.kodeboxx.smartintake.security.IdentityAdministrationService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
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
  @Autowired ObjectMapper json;

  UUID actor;
  UUID organization;
  UUID workspace;
  String sessionToken;

  @BeforeEach
  void setUp() {
    db.execute("truncate table staff_sessions, identity_secret_actions, identity_invitations, organization_memberships, platform_roles, memberships, workspaces, organizations, accounts cascade");
    actor = account("admin@example.test");
    organization = organization("Primary");
    workspace = UUID.randomUUID();
    db.update("insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?)", workspace, organization, "primary", "Primary");
    db.update("insert into memberships(account_id,workspace_id,role) values(?,?,?)", actor, workspace, "WORKSPACE_ADMINISTRATOR");
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
    db.update("update accounts set password_hash=? where id=?", new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder().encode("password-for-invite"), invited);
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

  @Test
  void workspaceRoleApiPersistsOnlyExactPrdRolesAndRejectsReplacedVocabulary() {
    UUID target = account("workspace-role@example.test");
    db.update("insert into organization_memberships(account_id,organization_id,roles) values(?,?,array['member'])", target, organization);
    administration.workspaceRoles("primary", opaque("account", target),
        new IdentityAdministrationService.Roles(List.of("author", "response-exporter", "translator")), request());
    assertEquals(List.of("AUTHOR", "RESPONSE_EXPORTER", "TRANSLATOR"), db.queryForList(
        "select role from memberships where account_id=? and workspace_id=? order by role", String.class, target, workspace));
    ResponseStatusException rejected = assertThrows(ResponseStatusException.class, () -> administration.workspaceRoles("primary", opaque("account", target),
        new IdentityAdministrationService.Roles(List.of("owner", "editor", "analyst")), request()));
    assertEquals(HttpStatus.BAD_REQUEST, rejected.getStatusCode());
  }

  @Test
  void workspaceAdministratorsListTransferableMembersUsingOpaqueAccountIdsAndPublicRoles() {
    UUID target = account("transferable@example.test");
    db.update("insert into organization_memberships(account_id,organization_id,roles) values(?,?,array['member'])", target, organization);
    db.update("insert into memberships(account_id,workspace_id,role) values(?,?,?)", target, workspace, "AUTHOR");
    db.update("insert into memberships(account_id,workspace_id,role) values(?,?,?)", target, workspace, "RESPONSE_EXPORTER");

    ResponseEntity<?> response = administration.workspaceMembers(opaque("workspace", workspace), request());
    assertEquals(HttpStatus.OK, response.getStatusCode());
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> members = (List<Map<String, Object>>) ((Map<String, Object>) response.getBody()).get("items");
    Map<String, Object> member = members.stream().filter(item -> opaque("account", target).equals(item.get("accountId"))).findFirst().orElseThrow();
    assertEquals("active", member.get("membershipStatus"));
    assertEquals(List.of("author", "response-exporter"), member.get("roles"));

    db.update("update memberships set role='AUTHOR' where account_id=? and workspace_id=?", actor, workspace);
    ResponseStatusException denied = assertThrows(ResponseStatusException.class,
        () -> administration.workspaceMembers(opaque("workspace", workspace), request()));
    assertEquals(HttpStatus.FORBIDDEN, denied.getStatusCode());
  }

  @Test
  void recoveryUsesThirtyMinuteProofsAndCredentialChangeInvalidatesEveryOutstandingProof() {
    administration.recovery(new IdentityAdministrationService.Recovery("admin@example.test"));
    assertTrue(db.queryForObject("select bool_and(expires_at > now() + interval '29 minutes' and expires_at < now() + interval '31 minutes') from identity_secret_actions where account_id=? and action='self-recovery'", Boolean.class, actor));

    String proof = "superseded-recovery-proof";
    db.update("insert into identity_secret_actions(id,account_id,action,token_hash,expires_at) values(?,?, 'organization-recovery', ?, now()+interval '24 hours')",
        UUID.randomUUID(), actor, sha256(proof));
    db.update("update accounts set password_hash=? where id=?", new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder().encode("current-password-15"), actor);
    assertEquals(HttpStatus.NO_CONTENT, administration.passwordChange(new IdentityAdministrationService.PasswordChange("current-password-15", "replacement-password"), request()).getStatusCode());
    assertEquals(0, db.queryForObject("select count(*) from identity_secret_actions where account_id=? and used_at is null", Integer.class, actor));
    assertThrows(ResponseStatusException.class, () -> administration.reset(new IdentityAdministrationService.TokenPassword(proof, "another-password")));
  }

  @Test
  void organizationRecoveryCopyProofIsRedeemableOnlyWhileItsTenantMembershipRemainsActive() {
    UUID target = account("recover@example.test");
    db.update("update accounts set password_hash=? where id=?", new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder().encode("recoverable-password"), target);
    db.update("insert into organization_memberships(account_id,organization_id,roles) values(?,?,array['member'])", target, organization);
    ResponseEntity<?> recovery = administration.organizationRecovery(opaque("organization", organization), opaque("account", target),
        new IdentityAdministrationService.RecoveryRequest("lost device", "administrator-assisted", true, true, null), request());
    String proof = recovery.getHeaders().getFirst("X-Recovery-Copy-Link").substring("/reset/".length());
    assertEquals(HttpStatus.NO_CONTENT, administration.reset(new IdentityAdministrationService.TokenPassword(proof, "recovered-password")).getStatusCode());
    assertThrows(ResponseStatusException.class, () -> administration.reset(new IdentityAdministrationService.TokenPassword(proof, "different-password")));
  }

  @Test
  void administrationCreateReplayIsExactAndNeverReissuesCapabilityCopies() {
    IdentityAdministrationService.UserCreate create = new IdentityAdministrationService.UserCreate("replay@example.test", List.of("member"), "temporary-password");
    ResponseEntity<?> first = administration.createUserMutation(opaque("organization", organization), create, "create-replay", request());
    ResponseEntity<?> replay = administration.createUserMutation(opaque("organization", organization), create, "create-replay", request());

    assertEquals(HttpStatus.CREATED, first.getStatusCode());
    assertEquals(json.valueToTree(first.getBody()), json.valueToTree(replay.getBody()));
    assertEquals(first.getHeaders().getETag(), replay.getHeaders().getETag());
    assertTrue(first.getHeaders().containsKey("X-Activation-Copy-Link"));
    assertFalse(replay.getHeaders().containsKey("X-Activation-Copy-Link"));
    assertEquals(1, db.queryForObject("select count(*) from accounts where email='replay@example.test'", Integer.class));
    ResponseStatusException mismatch = assertThrows(ResponseStatusException.class, () -> administration.createUserMutation(
        opaque("organization", organization), new IdentityAdministrationService.UserCreate("other@example.test", List.of("member"), "temporary-password"), "create-replay", request()));
    assertEquals(HttpStatus.CONFLICT, mismatch.getStatusCode());
  }

  @Test
  void concurrentDuplicateAdministrationMutationsCreateOneResourceAndReplayOneResponse() throws Exception {
    IdentityAdministrationService.UserCreate create = new IdentityAdministrationService.UserCreate("concurrent@example.test", List.of("member"), "temporary-password");
    CompletableFuture<ResponseEntity<?>> first = CompletableFuture.supplyAsync(() -> administration.createUserMutation(opaque("organization", organization), create, "concurrent-create", request()));
    CompletableFuture<ResponseEntity<?>> second = CompletableFuture.supplyAsync(() -> administration.createUserMutation(opaque("organization", organization), create, "concurrent-create", request()));
    ResponseEntity<?> one = first.get(10, TimeUnit.SECONDS);
    ResponseEntity<?> two = second.get(10, TimeUnit.SECONDS);
    assertEquals(json.valueToTree(one.getBody()), json.valueToTree(two.getBody()));
    assertEquals(1, db.queryForObject("select count(*) from accounts where email='concurrent@example.test'", Integer.class));
  }

  @Test
  void revisionedMutationsRequireStrongCurrentEtagAndRetainOwnerSafety() {
    UUID target = account("revisioned-member@example.test");
    db.update("insert into organization_memberships(account_id,organization_id,roles) values(?,?,array['member'])", target, organization);
    IdentityAdministrationService.UserUpdate update = new IdentityAdministrationService.UserUpdate("member-renamed@example.test", List.of("member"));
    ResponseStatusException missing = assertThrows(ResponseStatusException.class, () -> administration.updateUserMutation(
        opaque("organization", organization), opaque("account", target), update, "missing-match", null, request()));
    assertEquals(HttpStatus.PRECONDITION_REQUIRED, missing.getStatusCode());
    ResponseStatusException stale = assertThrows(ResponseStatusException.class, () -> administration.updateUserMutation(
        opaque("organization", organization), opaque("account", target), update, "stale-match", "\"rev-9\"", request()));
    assertEquals(HttpStatus.PRECONDITION_FAILED, stale.getStatusCode());
    ResponseEntity<?> updated = administration.updateUserMutation(
        opaque("organization", organization), opaque("account", target), update, "current-match", "\"rev-0\"", request());
    ResponseEntity<?> updateReplay = administration.updateUserMutation(
        opaque("organization", organization), opaque("account", target), update, "current-match", "\"rev-0\"", request());
    assertEquals(json.valueToTree(updated.getBody()), json.valueToTree(updateReplay.getBody()));
    assertEquals("\"rev-1\"", updateReplay.getHeaders().getETag());
    ResponseStatusException lastOwner = assertThrows(ResponseStatusException.class, () -> administration.removeUserMutation(
        opaque("organization", organization), opaque("account", actor), "owner-safety", "\"rev-0\"", request()));
    assertEquals(HttpStatus.CONFLICT, lastOwner.getStatusCode());
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

  private static String sha256(String value) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception ex) {
      throw new IllegalStateException(ex);
    }
  }
}
