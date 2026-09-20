package com.kodeboxx.smartintake.security;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Array;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Server-authoritative identity administration.
 *
 * <p>Path identifiers select resources only; every mutation derives its actor and tenant authority from
 * the authenticated staff session. Secret capabilities are persisted as SHA-256 hashes and are returned
 * exactly once, only through an administrator-authorized copy-link header.
 */
@Service
public class IdentityAdministrationService {
  private static final Duration ACTION_TTL = Duration.ofHours(24);
  private static final Duration SELF_RECOVERY_TTL = Duration.ofMinutes(30);
  private static final Duration INVITATION_TTL = Duration.ofHours(72);
  private static final Set<String> ORGANIZATION_ROLES = Set.of("owner", "administrator", "member");
  private static final Set<String> ASSIGNABLE_ORGANIZATION_ROLES = Set.of("administrator", "member");
  private static final Set<String> WORKSPACE_ROLES = Set.of(
      "workspace-administrator", "author", "reviewer", "translator", "publisher",
      "response-viewer", "response-exporter", "auditor");
  private static final Set<String> ACCOUNT_STATUSES = Set.of("active", "suspended");
  private static final Set<String> ORGANIZATION_STATUSES = Set.of("active", "suspended");

  private final JdbcTemplate db;
  private final IdentitySessionResolver sessions;
  private final CredentialEncoder credentials;
  private final AdministrationMutationExecutor mutations;
  private final SecureRandom random = new SecureRandom();

  public record PasswordChange(String currentPassword, String newPassword) {}
  public record TokenPassword(String resetToken, String newPassword) {}
  public record Activation(String activationToken, String password, String displayName) {}
  public record Recovery(String email) {}
  public record InviteAccept(String invitationToken, String password) {}
  public record UserCreate(String email, List<String> roles, String temporaryPassword) {}
  public record UserUpdate(String email, List<String> roles) {}
  public record Roles(List<String> roles) {}
  public record OrganizationCreate(String name) {}
  public record OrganizationUpdate(String name, String organizationStatus) {}
  public record PlatformAccountUpdate(String accountStatus) {}
  public record RecoveryRequest(String reason, String safeDelivery, Boolean revokeExistingSessions,
                                Boolean ownerSafetyConfirmed, String idempotencyReplay) {}

  public IdentityAdministrationService(JdbcTemplate db, IdentitySessionResolver sessions, CredentialEncoder credentials,
                                       AdministrationMutationExecutor mutations) {
    this.db = db;
    this.sessions = sessions;
    this.credentials = credentials;
    this.mutations = mutations;
  }

  @Transactional
  public ResponseEntity<?> passwordChange(PasswordChange request, HttpServletRequest http) {
    UUID account = currentAccount(http);
    String stored = db.queryForObject("select password_hash from accounts where id=? for update", String.class, account);
    if (!credentials.matches(request.currentPassword(), stored)) throw unauthorized();
    validatePassword(request.newPassword());
    db.update("update accounts set password_hash=?, activation_state='active', temporary_password_expires_at=null where id=?",
        credentials.encode(request.newPassword()), account);
    revokeSecretActions(account);
    revokeAllSessions(account);
    return ResponseEntity.noContent().build();
  }

  /** Always neutral: no account enumeration and no raw capability in this unauthenticated response. */
  @Transactional
  public ResponseEntity<?> recovery(Recovery request) {
    List<UUID> accounts = db.query("select id from accounts where email=?", (rs, row) -> (UUID) rs.getObject(1), email(request.email()));
    if (!accounts.isEmpty()) issueAction(accounts.get(0), null, "self-recovery", SELF_RECOVERY_TTL);
    return ResponseEntity.accepted().body(Map.of("requestId", opaque("req"), "accountAction", accountAction("recovery-requested")));
  }

  @Transactional
  public ResponseEntity<?> reset(TokenPassword request) {
    ActionGrant grant = consumeRecoveryAction(request.resetToken());
    UUID account = grant.account();
    ensureRecoveryOrganizationIsActive(account, grant.organization());
    validatePassword(request.newPassword());
    db.update("update accounts set password_hash=?, activation_state='active', temporary_password_expires_at=null where id=?",
        credentials.encode(request.newPassword()), account);
    revokeSecretActions(account);
    revokeAllSessions(account);
    return ResponseEntity.noContent().build();
  }

  @Transactional
  public ResponseEntity<?> activate(Activation request) {
    ActionGrant grant = consumeAction(request.activationToken(), "activation");
    UUID account = grant.account();
    validatePassword(request.password());
    if (request.displayName() == null || request.displayName().isBlank() || request.displayName().length() > 120) badRequest();
    db.update("update accounts set password_hash=?, display_name=?, activation_state='active', temporary_password_expires_at=null where id=?",
        credentials.encode(request.password()), request.displayName().trim(), account);
    // A pending owner is activated only in the tenant to which the proof was bound.
    if (grant.organization() != null) db.update("update organization_memberships set membership_status='active',updated_at=now(),revision=revision+1 where account_id=? and organization_id=? and membership_status='suspended'", account, grant.organization());
    revokeSecretActions(account);
    revokeAllSessions(account);
    return ResponseEntity.noContent().build();
  }

  public ResponseEntity<?> users(String organizationValue, HttpServletRequest http) {
    UUID organization = organization(organizationValue);
    requireOrganizationAdministrator(currentAccount(http), organization);
    List<Map<String, Object>> items = db.queryForList(
        "select a.id,a.email,om.roles,om.membership_status,om.revision,om.created_at,om.updated_at "
            + "from organization_memberships om join accounts a on a.id=om.account_id where om.organization_id=? order by a.email", organization);
    return ResponseEntity.ok(Map.of("requestId", opaque("req"), "items", items.stream().map(this::organizationUser).toList(), "page", page()));
  }

  @Transactional
  public ResponseEntity<?> createUser(String organizationValue, UserCreate request, HttpServletRequest http) {
    UUID organization = organization(organizationValue);
    UUID actor = currentAccount(http);
    requireOrganizationAdministrator(actor, organization);
    List<String> roles = allowedOrganizationRoles(request.roles(), false);
    String email = email(request.email());
    UUID account = accountByEmail(email);
    ActionCapability activation = null;

    String generatedTemporaryPassword = null;
    if (account == null) {
      account = UUID.randomUUID();
      String temporaryPassword = request.temporaryPassword();
      if (temporaryPassword != null) validatePassword(temporaryPassword);
      String initialPassword = temporaryPassword == null ? randomSecret() : temporaryPassword;
      generatedTemporaryPassword = temporaryPassword == null ? initialPassword : null;
      db.update("insert into accounts(id,email,password_hash,activation_state,temporary_password_expires_at) values(?,?,?,'pending',now()+interval '24 hours')",
          account, email, credentials.encode(initialPassword));
      activation = issueAction(account, organization, "activation", ACTION_TTL);
    }

    db.update("insert into organization_memberships(account_id,organization_id,roles,membership_status) values(?,?,?,'active') "
            + "on conflict(account_id,organization_id) do update set roles=excluded.roles,membership_status='active',updated_at=now(),revision=organization_memberships.revision+1",
        account, organization, roles.toArray(String[]::new));

    Map<String, Object> body = Map.of("requestId", opaque("req"), "organizationUser", organizationUser(account, email, roles, "active", 0, Instant.now(), Instant.now()));
    ResponseEntity.BodyBuilder response = ResponseEntity.status(HttpStatus.CREATED);
    // An activation proof is an administrator-delivered no-email copy link, never a response property.
    if (activation != null) response.header("X-Activation-Copy-Link", "/activate/" + activation.token());
    if (generatedTemporaryPassword != null) response.header("X-Temporary-Password-Copy", generatedTemporaryPassword);
    return response.body(body);
  }

  @Transactional
  public ResponseEntity<?> createUserMutation(String organizationValue, UserCreate request, String idempotencyKey, HttpServletRequest http) {
    UUID organization = organization(organizationValue);
    UUID actor = currentAccount(http);
    return mutations.execute(actor, organizationScope(organization), "organization-user-create", idempotencyKey, request,
        () -> createUser(organizationValue, request, http));
  }

  @Transactional(isolation = Isolation.SERIALIZABLE)
  public ResponseEntity<?> updateUser(String organizationValue, String userValue, UserUpdate request, HttpServletRequest http) {
    UUID organization = organization(organizationValue);
    UUID target = opaqueId(userValue);
    requireOrganizationAdministrator(currentAccount(http), organization);
    lockOrganizationOwners(organization);
    Map<String, Object> existing = membershipForUpdate(organization, target);
    List<String> roles = allowedOrganizationRoles(request.roles(), false);
    ensureOwnerContinuity(organization, target, roles, "active");
    String newEmail = request.email() == null ? (String) db.queryForObject("select email from accounts where id=?", String.class, target) : email(request.email());
    db.update("update accounts set email=? where id=?", newEmail, target);
    db.update("update organization_memberships set roles=?, revision=revision+1, updated_at=now() where organization_id=? and account_id=?",
        roles.toArray(String[]::new), organization, target);
    return ResponseEntity.ok(Map.of("requestId", opaque("req"), "organizationUser", organizationUser(target, newEmail, roles,
        (String) existing.get("membership_status"), ((Number) existing.get("revision")).longValue() + 1, Instant.now(), Instant.now())));
  }

  @Transactional(isolation = Isolation.SERIALIZABLE)
  public ResponseEntity<?> updateUserMutation(String organizationValue, String userValue, UserUpdate request, String idempotencyKey,
                                                String ifMatch, HttpServletRequest http) {
    UUID organization = organization(organizationValue);
    UUID target = opaqueId(userValue);
    UUID actor = currentAccount(http);
    requireOrganizationAdministrator(actor, organization);
    return mutations.execute(actor, organizationScope(organization), "organization-user-update:" + target, idempotencyKey,
        requestWithMatch(request, ifMatch), () -> {
          requireRevision(ifMatch, membershipRevisionForUpdate(organization, target));
          return updateUser(organizationValue, userValue, request, http);
        });
  }

  @Transactional(isolation = Isolation.SERIALIZABLE)
  public ResponseEntity<?> removeUser(String organizationValue, String userValue, HttpServletRequest http) {
    UUID organization = organization(organizationValue);
    UUID target = opaqueId(userValue);
    requireOrganizationAdministrator(currentAccount(http), organization);
    lockOrganizationOwners(organization);
    long revision = membershipRevisionForUpdate(organization, target);
    ensureOwnerContinuity(organization, target, List.of(), "suspended");
    db.update("delete from organization_memberships where organization_id=? and account_id=?", organization, target);
    return ResponseEntity.noContent().eTag(etag(revision + 1)).build();
  }

  @Transactional(isolation = Isolation.SERIALIZABLE)
  public ResponseEntity<?> removeUserMutation(String organizationValue, String userValue, String idempotencyKey, String ifMatch,
                                                HttpServletRequest http) {
    UUID organization = organization(organizationValue);
    UUID target = opaqueId(userValue);
    UUID actor = currentAccount(http);
    requireOrganizationAdministrator(actor, organization);
    return mutations.execute(actor, organizationScope(organization), "organization-user-delete:" + target, idempotencyKey,
        requestWithMatch(null, ifMatch), () -> {
          requireRevision(ifMatch, membershipRevisionForUpdate(organization, target));
          return removeUser(organizationValue, userValue, http);
        });
  }

  /** Creates or replaces the recipient's outstanding copy-link; recipients need not have an account. */
  @Transactional
  public ResponseEntity<?> invite(String organizationValue, String userValue, HttpServletRequest http) {
    UUID organization = organization(organizationValue);
    UUID actor = currentAccount(http);
    requireOrganizationAdministrator(actor, organization);
    UUID target = opaqueId(userValue);
    String email = db.queryForObject("select email from accounts where id=?", String.class, target);
    return createInvitation(organization, target, email, actor, List.of("member"));
  }

  @Transactional
  public ResponseEntity<?> inviteMutation(String organizationValue, String userValue, String idempotencyKey, HttpServletRequest http) {
    UUID organization = organization(organizationValue);
    UUID actor = currentAccount(http);
    return mutations.execute(actor, organizationScope(organization), "organization-invitation-create:" + opaqueId(userValue), idempotencyKey,
        Map.of(), () -> invite(organizationValue, userValue, http));
  }

  /** Copy-link invitation endpoint for a newly supplied email without a pre-created account. */
  @Transactional
  public ResponseEntity<?> inviteEmail(String organizationValue, UserCreate request, HttpServletRequest http) {
    UUID organization = organization(organizationValue);
    UUID actor = currentAccount(http);
    requireOrganizationAdministrator(actor, organization);
    String email = email(request.email());
    return createInvitation(organization, accountByEmail(email), email, actor, allowedOrganizationRoles(request.roles(), false));
  }

  @Transactional
  public ResponseEntity<?> accept(InviteAccept request) {
    Map<String, Object> invitation;
    try {
      invitation = db.queryForMap(
          "select * from identity_invitations where token_hash=? and used_at is null and revoked_at is null and expires_at>now() for update",
          sha256(request.invitationToken()));
    } catch (Exception ex) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid or expired credential");
    }
    UUID organization = (UUID) invitation.get("organization_id");
    UUID issuer = (UUID) invitation.get("created_by");
    // Issuer authority, tenant state, recipient state, and invitation grant are all checked under this lock.
    requireOrganizationAdministrator(issuer, organization);
    UUID account = (UUID) invitation.get("account_id");
    if (account == null) {
      validatePassword(request.password());
      account = UUID.randomUUID();
      db.update("insert into accounts(id,email,password_hash,activation_state) values(?,?,?,'active')", account,
          invitation.get("email"), credentials.encode(request.password()));
    } else {
      Map<String, Object> existing = db.queryForMap("select password_hash,account_status from accounts where id=? for update", account);
      if (!"active".equals(existing.get("account_status")) || request.password() == null
          || !credentials.matches(request.password(), (String) existing.get("password_hash"))) {
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
      }
    }
    List<String> roles = sqlArray(invitation.get("organization_roles"));
    db.update("insert into organization_memberships(account_id,organization_id,roles,membership_status) values(?,?,?,'active') "
            + "on conflict(account_id,organization_id) do update set roles=excluded.roles,membership_status='active',updated_at=now(),revision=organization_memberships.revision+1",
        account, invitation.get("organization_id"), roles.toArray(String[]::new));
    db.update("update identity_invitations set used_at=now(),updated_at=now() where id=?", invitation.get("id"));
    return ResponseEntity.ok(Map.of("requestId", opaque("req"), "invitation", invitation((UUID) invitation.get("id"), (String) invitation.get("email"),
        ((Timestamp) invitation.get("expires_at")).toInstant())));
  }

  @Transactional
  public ResponseEntity<?> revokeInvite(String organizationValue, String invitationValue, HttpServletRequest http) {
    UUID organization = organization(organizationValue);
    requireOrganizationAdministrator(currentAccount(http), organization);
    UUID invitation = opaqueId(invitationValue);
    long revision = invitationRevisionForUpdate(organization, invitation);
    db.update("update identity_invitations set revoked_at=now(),updated_at=now(),revision=revision+1 where id=? and organization_id=? and used_at is null", invitation, organization);
    return ResponseEntity.noContent().eTag(etag(revision + 1)).build();
  }

  @Transactional
  public ResponseEntity<?> revokeInviteMutation(String organizationValue, String invitationValue, String idempotencyKey, String ifMatch,
                                                  HttpServletRequest http) {
    UUID organization = organization(organizationValue);
    UUID invitation = opaqueId(invitationValue);
    UUID actor = currentAccount(http);
    requireOrganizationAdministrator(actor, organization);
    return mutations.execute(actor, organizationScope(organization), "organization-invitation-revoke:" + invitation, idempotencyKey,
        requestWithMatch(null, ifMatch), () -> {
          requireRevision(ifMatch, invitationRevisionForUpdate(organization, invitation));
          return revokeInvite(organizationValue, invitationValue, http);
        });
  }

  @Transactional(isolation = Isolation.SERIALIZABLE)
  public ResponseEntity<?> workspaceRoles(String workspaceValue, String userValue, Roles request, HttpServletRequest http) {
    UUID workspace = workspace(workspaceValue);
    UUID actor = currentAccount(http);
    requireWorkspaceManager(actor, workspace);
    List<String> roles = allowed(request.roles(), WORKSPACE_ROLES, "workspace role");
    UUID target = opaqueId(userValue);
    long revision = workspaceRoleRevisionForUpdate(workspace, target);
    ensureWorkspaceOwnerContinuity(workspace, target, roles);
    UUID organization = db.queryForObject("select organization_id from workspaces where id=?", UUID.class, workspace);
    if (!activeOrganizationMember(target, organization)) throw forbidden();
    db.update("delete from memberships where account_id=? and workspace_id=?", target, workspace);
    for (String role : roles) db.update("insert into memberships(account_id,workspace_id,role) values(?,?,?)", target, workspace, workspaceRole(role));
    db.update("update workspace_role_revisions set revision=revision+1 where workspace_id=? and account_id=?", workspace, target);
    return ResponseEntity.ok().eTag(etag(revision + 1)).body(Map.of("requestId", opaque("req"), "workspaceRole", workspaceRole(target, roles, revision + 1)));
  }

  @Transactional(isolation = Isolation.SERIALIZABLE)
  public ResponseEntity<?> workspaceRolesMutation(String workspaceValue, String userValue, Roles request, String idempotencyKey,
                                                    String ifMatch, HttpServletRequest http) {
    UUID workspace = workspace(workspaceValue);
    UUID target = opaqueId(userValue);
    UUID actor = currentAccount(http);
    requireWorkspaceManager(actor, workspace);
    return mutations.execute(actor, workspaceScope(workspace), "workspace-role-replace:" + target, idempotencyKey,
        requestWithMatch(request, ifMatch), () -> {
          requireRevision(ifMatch, workspaceRoleRevisionForUpdate(workspace, target));
          return workspaceRoles(workspaceValue, userValue, request, http);
        });
  }

  @Transactional(isolation = Isolation.SERIALIZABLE)
  public ResponseEntity<?> removeWorkspaceRoles(String workspaceValue, String userValue, HttpServletRequest http) {
    UUID workspace = workspace(workspaceValue);
    requireWorkspaceManager(currentAccount(http), workspace);
    UUID target = opaqueId(userValue);
    long revision = workspaceRoleRevisionForUpdate(workspace, target);
    ensureWorkspaceOwnerContinuity(workspace, target, List.of());
    db.update("delete from memberships where account_id=? and workspace_id=?", target, workspace);
    db.update("update workspace_role_revisions set revision=revision+1 where workspace_id=? and account_id=?", workspace, target);
    return ResponseEntity.noContent().eTag(etag(revision + 1)).build();
  }

  @Transactional(isolation = Isolation.SERIALIZABLE)
  public ResponseEntity<?> removeWorkspaceRolesMutation(String workspaceValue, String userValue, String idempotencyKey,
                                                          String ifMatch, HttpServletRequest http) {
    UUID workspace = workspace(workspaceValue);
    UUID target = opaqueId(userValue);
    UUID actor = currentAccount(http);
    requireWorkspaceManager(actor, workspace);
    return mutations.execute(actor, workspaceScope(workspace), "workspace-role-delete:" + target, idempotencyKey,
        requestWithMatch(null, ifMatch), () -> {
          requireRevision(ifMatch, workspaceRoleRevisionForUpdate(workspace, target));
          return removeWorkspaceRoles(workspaceValue, userValue, http);
        });
  }

  @Transactional
  public ResponseEntity<?> organizationRecovery(String organizationValue, String userValue, RecoveryRequest request, HttpServletRequest http) {
    UUID organization = organization(organizationValue);
    UUID actor = currentAccount(http);
    UUID target = opaqueId(userValue);
    requireOrganizationAdministrator(actor, organization);
    requireRecoveryRequest(request, "administrator-assisted");
    // Tenant recovery may only assist a sole-tenant, non-platform account. It preserves organization ownership.
    if (isPlatformAccount(target) || organizationMembershipCount(target) != 1 || !activeOrganizationMember(target, organization)) throw forbidden();
    revokeAllSessions(target);
    ActionCapability action = issueAction(target, organization, "organization-recovery", ACTION_TTL);
    return ResponseEntity.status(HttpStatus.CREATED).header("X-Recovery-Copy-Link", "/reset/" + action.token())
        .body(Map.of("requestId", opaque("req"), "organizationRecovery", recovery("OrganizationRecovery", "administrator-assisted")));
  }

  @Transactional
  public ResponseEntity<?> organizationRecoveryMutation(String organizationValue, String userValue, RecoveryRequest request,
                                                          String idempotencyKey, HttpServletRequest http) {
    UUID organization = organization(organizationValue);
    UUID actor = currentAccount(http);
    return mutations.execute(actor, organizationScope(organization), "organization-recovery:" + opaqueId(userValue), idempotencyKey,
        request, () -> organizationRecovery(organizationValue, userValue, request, http));
  }

  @Transactional
  public ResponseEntity<?> platformRecovery(String accountValue, RecoveryRequest request, HttpServletRequest http) {
    UUID actor = currentAccount(http);
    UUID target = opaqueId(accountValue);
    requirePlatformAdministrator(actor);
    requireRecoveryRequest(request, "manual-security-review");
    revokeAllSessions(target);
    // Platform recovery is deliberately manual; no self-service raw capability is disclosed.
    issueAction(target, null, "platform-recovery", ACTION_TTL);
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(Map.of("requestId", opaque("req"), "platformRecovery", recovery("PlatformRecovery", "manual-security-review")));
  }

  @Transactional
  public ResponseEntity<?> platformRecoveryMutation(String accountValue, RecoveryRequest request, String idempotencyKey,
                                                      HttpServletRequest http) {
    UUID account = opaqueId(accountValue);
    UUID actor = currentAccount(http);
    return mutations.execute(actor, accountScope(account), "platform-account-recovery", idempotencyKey, request,
        () -> platformRecovery(accountValue, request, http));
  }

  public ResponseEntity<?> platformOrganizations(HttpServletRequest http) {
    requirePlatformAdministrator(currentAccount(http));
    List<Map<String, Object>> items = db.queryForList("select id,name,organization_status,created_at from organizations order by name").stream()
        .map(this::organizationResource).toList();
    return ResponseEntity.ok(Map.of("requestId", opaque("req"), "items", items, "page", page()));
  }

  @Transactional
  public ResponseEntity<?> createPlatformOrganization(OrganizationCreate request, HttpServletRequest http) {
    requirePlatformAdministrator(currentAccount(http));
    if (request.name() == null || request.name().isBlank() || request.name().length() > 160) badRequest();
    UUID organization = UUID.randomUUID();
    db.update("insert into organizations(id,name,organization_status) values(?,?,'active')", organization, request.name().trim());
    return ResponseEntity.status(HttpStatus.CREATED).eTag(etag(0)).body(Map.of("requestId", opaque("req"), "organization", organizationResource(organization, request.name().trim(), "active", 0, Instant.now())));
  }

  @Transactional
  public ResponseEntity<?> createPlatformOrganizationMutation(OrganizationCreate request, String idempotencyKey, HttpServletRequest http) {
    UUID actor = currentAccount(http);
    return mutations.execute(actor, "platform", "platform-organization-create", idempotencyKey, request,
        () -> createPlatformOrganization(request, http));
  }

  @Transactional
  public ResponseEntity<?> updatePlatformOrganization(String organizationValue, OrganizationUpdate request, HttpServletRequest http) {
    requirePlatformAdministrator(currentAccount(http));
    UUID organization = organization(organizationValue);
    long revision = organizationRevisionForUpdate(organization);
    String status = request.organizationStatus();
    if (status == null) status = db.queryForObject("select organization_status from organizations where id=?", String.class, organization);
    if (request.name() == null || request.name().isBlank() || request.name().length() > 160 || !ORGANIZATION_STATUSES.contains(status)) badRequest();
    db.update("update organizations set name=?,organization_status=?,revision=revision+1 where id=?", request.name().trim(), status, organization);
    return ResponseEntity.ok().eTag(etag(revision + 1)).body(Map.of("requestId", opaque("req"), "organization", organizationResource(organization, request.name().trim(), status, revision + 1, Instant.now())));
  }

  @Transactional
  public ResponseEntity<?> updatePlatformOrganizationMutation(String organizationValue, OrganizationUpdate request, String idempotencyKey,
                                                                String ifMatch, HttpServletRequest http) {
    UUID organization = organization(organizationValue);
    UUID actor = currentAccount(http);
    requirePlatformAdministrator(actor);
    return mutations.execute(actor, organizationScope(organization), "platform-organization-update", idempotencyKey,
        requestWithMatch(request, ifMatch), () -> {
          requireRevision(ifMatch, organizationRevisionForUpdate(organization));
          return updatePlatformOrganization(organizationValue, request, http);
        });
  }

  @Transactional(isolation = Isolation.SERIALIZABLE)
  public ResponseEntity<?> updatePlatformAccount(String accountValue, PlatformAccountUpdate request, HttpServletRequest http) {
    requirePlatformAdministrator(currentAccount(http));
    if (!ACCOUNT_STATUSES.contains(request.accountStatus())) badRequest();
    UUID account = opaqueId(accountValue);
    long revision = accountRevisionForUpdate(account);
    if ("suspended".equals(request.accountStatus())) ensureSuspensionSafety(account);
    db.update("update accounts set account_status=?,revision=revision+1 where id=?", request.accountStatus(), account);
    if ("suspended".equals(request.accountStatus())) {
      revokeSecretActions(account);
      revokeAllSessions(account);
    }
    return ResponseEntity.ok().eTag(etag(revision + 1)).body(Map.of("requestId", opaque("req"), "platformAccount", platformAccount(account, request.accountStatus(), revision + 1)));
  }

  @Transactional(isolation = Isolation.SERIALIZABLE)
  public ResponseEntity<?> updatePlatformAccountMutation(String accountValue, PlatformAccountUpdate request, String idempotencyKey,
                                                          String ifMatch, HttpServletRequest http) {
    UUID account = opaqueId(accountValue);
    UUID actor = currentAccount(http);
    requirePlatformAdministrator(actor);
    return mutations.execute(actor, accountScope(account), "platform-account-update", idempotencyKey,
        requestWithMatch(request, ifMatch), () -> {
          requireRevision(ifMatch, accountRevisionForUpdate(account));
          return updatePlatformAccount(accountValue, request, http);
        });
  }

  /** Platform assigns a pending owner without making the invitation recipient an active administrator first. */
  @Transactional
  public ResponseEntity<?> addPendingOwner(String organizationValue, UserCreate request, HttpServletRequest http) {
    UUID organization = organization(organizationValue);
    requirePlatformAdministrator(currentAccount(http));
    String email = email(request.email());
    UUID account = accountByEmail(email);
    String generatedTemporaryPassword = null;
    if (account == null) {
      account = UUID.randomUUID();
      String password = request.temporaryPassword() == null ? randomSecret() : request.temporaryPassword();
      generatedTemporaryPassword = request.temporaryPassword() == null ? password : null;
      validatePassword(password);
      db.update("insert into accounts(id,email,password_hash,activation_state,temporary_password_expires_at) values(?,?,?,'pending',now()+interval '24 hours')",
          account, email, credentials.encode(password));
    }
    db.update("insert into organization_memberships(account_id,organization_id,roles,membership_status) values(?,?,array['owner','administrator'],'suspended') "
        + "on conflict(account_id,organization_id) do update set roles=array['owner','administrator'],membership_status='suspended',updated_at=now()", account, organization);
    ActionCapability activation = issueAction(account, organization, "activation", ACTION_TTL);
    ResponseEntity.BodyBuilder response = ResponseEntity.status(HttpStatus.CREATED)
        .header("X-Activation-Copy-Link", "/activate/" + activation.token());
    if (generatedTemporaryPassword != null) response.header("X-Temporary-Password-Copy", generatedTemporaryPassword);
    return response.body(Map.of("requestId", opaque("req"), "organizationUser", organizationUser(account, email, List.of("owner", "administrator"), "suspended", 0, Instant.now(), Instant.now())));
  }

  @Transactional
  public ResponseEntity<?> addPendingOwnerMutation(String organizationValue, UserCreate request, String idempotencyKey,
                                                    HttpServletRequest http) {
    UUID organization = organization(organizationValue);
    UUID actor = currentAccount(http);
    return mutations.execute(actor, organizationScope(organization), "platform-pending-owner-create", idempotencyKey, request,
        () -> addPendingOwner(organizationValue, request, http));
  }

  private ResponseEntity<?> createInvitation(UUID organization, UUID account, String email, UUID actor, List<String> roles) {
    db.update("update identity_invitations set revoked_at=now(),updated_at=now() where organization_id=? and email=? and used_at is null and revoked_at is null", organization, email);
    UUID invitation = UUID.randomUUID();
    String token = randomSecret();
    Instant expires = Instant.now().plus(INVITATION_TTL);
    db.update("insert into identity_invitations(id,organization_id,account_id,email,organization_roles,token_hash,expires_at,created_by) values(?,?,?,?,?,?,?,?)",
        invitation, organization, account, email, roles.toArray(String[]::new), sha256(token), Timestamp.from(expires), actor);
    return ResponseEntity.status(HttpStatus.CREATED).header("X-Invitation-Copy-Link", "/invite/" + token)
        .body(Map.of("requestId", opaque("req"), "invitation", invitation(invitation, email, expires)));
  }

  private UUID currentAccount(HttpServletRequest request) {
    String token = sessions.session(request, request.getHeader("X-Staff-Session")).orElseThrow(IdentityAdministrationService::unauthorized);
    try {
      return db.queryForObject("select s.account_id from staff_sessions s join accounts a on a.id=s.account_id where s.token::text=? and s.revoked_at is null "
          + "and a.account_status='active' and s.last_seen_at>now()-interval '2 hours' and s.expires_at>now() and s.absolute_expires_at>now()", UUID.class, token);
    } catch (Exception ex) { throw unauthorized(); }
  }

  private void requireOrganizationAdministrator(UUID account, UUID organization) {
    Integer allowed = db.queryForObject("select count(*) from organization_memberships om join organizations o on o.id=om.organization_id "
        + "where om.account_id=? and om.organization_id=? and om.membership_status='active' and o.organization_status='active' "
        + "and om.roles && array['owner','administrator']::text[]", Integer.class, account, organization);
    if (allowed == null || allowed != 1) throw forbidden();
  }

  private void requireWorkspaceManager(UUID account, UUID workspace) {
    Integer allowed = db.queryForObject("select count(*) from memberships m join workspaces w on w.id=m.workspace_id join organizations o on o.id=w.organization_id "
        + "join accounts a on a.id=m.account_id where m.account_id=? and m.workspace_id=? and a.account_status='active' and o.organization_status='active' "
        + "and m.role in ('WORKSPACE_ADMINISTRATOR','OWNER')", Integer.class, account, workspace);
    if (allowed == null || allowed == 0) throw forbidden();
  }

  private void requirePlatformAdministrator(UUID account) {
    Integer allowed = db.queryForObject("select count(*) from platform_roles where account_id=? and role='administrator'", Integer.class, account);
    if (allowed == null || allowed == 0) throw forbidden();
  }

  private void ensureWorkspaceOwnerContinuity(UUID workspace, UUID target, List<String> proposedRoles) {
    db.queryForList("select account_id from memberships where workspace_id=? and role in ('WORKSPACE_ADMINISTRATOR','OWNER') for update", workspace);
    Integer targetAdministrator = db.queryForObject("select count(*) from memberships where workspace_id=? and account_id=? and role in ('WORKSPACE_ADMINISTRATOR','OWNER')", Integer.class, workspace, target);
    if (targetAdministrator == null || targetAdministrator == 0 || proposedRoles.contains("workspace-administrator")) return;
    Integer remaining = db.queryForObject("select count(*) from memberships m join accounts a on a.id=m.account_id where m.workspace_id=? and m.account_id<>? and m.role in ('WORKSPACE_ADMINISTRATOR','OWNER') and a.account_status='active'", Integer.class, workspace, target);
    if (remaining == null || remaining == 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "Last workspace administrator required");
  }

  private void ensureSuspensionSafety(UUID account) {
    db.queryForList("select account_id from platform_roles where role='administrator' for update");
    Integer administrators = db.queryForObject("select count(*) from platform_roles where role='administrator'", Integer.class);
    if (administrators != null && administrators == 1 && isPlatformAccount(account))
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Last platform administrator required");
    List<UUID> ownerOrganizations = db.query("select organization_id from organization_memberships where account_id=? and membership_status='active' and roles @> array['owner']::text[]", (rs, row) -> (UUID) rs.getObject(1), account);
    for (UUID organization : ownerOrganizations) {
      lockOrganizationOwners(organization);
      ensureOwnerContinuity(organization, account, List.of(), "suspended");
    }
  }

  private void lockOrganizationOwners(UUID organization) {
    db.queryForList("select account_id from organization_memberships where organization_id=? and membership_status='active' and roles @> array['owner']::text[] for update", organization);
  }

  private Map<String, Object> membershipForUpdate(UUID organization, UUID account) {
    try { return db.queryForMap("select roles,membership_status,revision from organization_memberships where organization_id=? and account_id=? for update", organization, account); }
    catch (Exception ex) { throw notFound(); }
  }

  private long membershipRevisionForUpdate(UUID organization, UUID account) {
    try { return db.queryForObject("select revision from organization_memberships where organization_id=? and account_id=? for update", Long.class, organization, account); }
    catch (Exception ex) { throw notFound(); }
  }

  private long invitationRevisionForUpdate(UUID organization, UUID invitation) {
    try { return db.queryForObject("select revision from identity_invitations where organization_id=? and id=? for update", Long.class, organization, invitation); }
    catch (Exception ex) { throw notFound(); }
  }

  private long organizationRevisionForUpdate(UUID organization) {
    try { return db.queryForObject("select revision from organizations where id=? for update", Long.class, organization); }
    catch (Exception ex) { throw notFound(); }
  }

  private long accountRevisionForUpdate(UUID account) {
    try { return db.queryForObject("select revision from accounts where id=? for update", Long.class, account); }
    catch (Exception ex) { throw notFound(); }
  }

  private long workspaceRoleRevisionForUpdate(UUID workspace, UUID account) {
    db.update("insert into workspace_role_revisions(workspace_id,account_id) values(?,?) on conflict do nothing", workspace, account);
    return db.queryForObject("select revision from workspace_role_revisions where workspace_id=? and account_id=? for update", Long.class, workspace, account);
  }

  private static void requireRevision(String ifMatch, long current) {
    if (ifMatch == null || ifMatch.isBlank()) {
      throw new ResponseStatusException(HttpStatus.PRECONDITION_REQUIRED, "If-Match required");
    }
    if (!etag(current).equals(ifMatch)) {
      throw new ResponseStatusException(HttpStatus.PRECONDITION_FAILED, "Stale resource revision");
    }
  }

  private static String organizationScope(UUID organization) { return "organization:" + organization; }
  private static String workspaceScope(UUID workspace) { return "workspace:" + workspace; }
  private static String accountScope(UUID account) { return "account:" + account; }
  private static String etag(long revision) { return "\"rev-" + revision + "\""; }

  private static Map<String, Object> requestWithMatch(Object request, String ifMatch) {
    Map<String, Object> canonical = new LinkedHashMap<>();
    if (request != null) canonical.put("request", request);
    canonical.put("ifMatch", ifMatch);
    return canonical;
  }

  private void ensureOwnerContinuity(UUID organization, UUID target, List<String> proposedRoles, String proposedStatus) {
    Map<String, Object> current = membershipForUpdate(organization, target);
    boolean targetIsActiveOwner = "active".equals(current.get("membership_status")) && sqlArray(current.get("roles")).contains("owner");
    boolean remainsActiveOwner = "active".equals(proposedStatus) && proposedRoles.contains("owner");
    if (!targetIsActiveOwner || remainsActiveOwner) return;
    Integer remaining = db.queryForObject("select count(*) from organization_memberships om join accounts a on a.id=om.account_id "
        + "where om.organization_id=? and om.account_id<>? and om.membership_status='active' and om.roles @> array['owner']::text[] "
        + "and a.account_status='active' and a.activation_state='active'", Integer.class, organization, target);
    if (remaining == null || remaining == 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "Last active owner required");
  }

  private ActionCapability issueAction(UUID account, UUID organization, String action, Duration ttl) {
    // A new purpose-bound proof supersedes any previous live proof for that account and purpose.
    db.update("update identity_secret_actions set used_at=now() where account_id=? and action=? and used_at is null", account, action);
    UUID id = UUID.randomUUID();
    String token = randomSecret();
    db.update("insert into identity_secret_actions(id,account_id,organization_id,action,token_hash,expires_at) values(?,?,?,?,?,?)",
        id, account, organization, action, sha256(token), Timestamp.from(Instant.now().plus(ttl)));
    return new ActionCapability(id, token);
  }

  private ActionGrant consumeAction(String token, String action) {
    try {
      return db.queryForObject("update identity_secret_actions set used_at=now() where token_hash=? and action=? and used_at is null and expires_at>now() returning account_id,organization_id",
          (rs, row) -> new ActionGrant((UUID) rs.getObject("account_id"), (UUID) rs.getObject("organization_id")), sha256(token), action);
    } catch (Exception ex) { throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid or expired credential"); }
  }

  private ActionGrant consumeRecoveryAction(String token) {
    try {
      return db.queryForObject("update identity_secret_actions set used_at=now() where token_hash=? and action in ('self-recovery','organization-recovery') and used_at is null and expires_at>now() returning account_id,organization_id",
          (rs, row) -> new ActionGrant((UUID) rs.getObject("account_id"), (UUID) rs.getObject("organization_id")), sha256(token));
    } catch (Exception ex) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid or expired credential");
    }
  }

  private void ensureRecoveryOrganizationIsActive(UUID account, UUID organization) {
    if (organization == null) return;
    Integer active = db.queryForObject("select count(*) from organization_memberships om join organizations o on o.id=om.organization_id "
        + "where om.account_id=? and om.organization_id=? and om.membership_status='active' and o.organization_status='active'",
        Integer.class, account, organization);
    if (active == null || active != 1) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid or expired credential");
  }

  private void revokeAllSessions(UUID account) { db.update("update staff_sessions set revoked_at=now(),updated_at=now() where account_id=? and revoked_at is null", account); }
  private void revokeSecretActions(UUID account) { db.update("update identity_secret_actions set used_at=now() where account_id=? and used_at is null", account); }
  private UUID accountByEmail(String email) { List<UUID> matches = db.query("select id from accounts where email=?", (rs, row) -> (UUID) rs.getObject(1), email); return matches.isEmpty() ? null : matches.get(0); }
  private int organizationMembershipCount(UUID account) { return db.queryForObject("select count(*) from organization_memberships where account_id=? and membership_status='active'", Integer.class, account); }
  private boolean isPlatformAccount(UUID account) { return db.queryForObject("select count(*) from platform_roles where account_id=?", Integer.class, account) > 0; }
  private boolean activeOrganizationMember(UUID account, UUID organization) { return db.queryForObject("select count(*) from organization_memberships where account_id=? and organization_id=? and membership_status='active'", Integer.class, account, organization) > 0; }
  private UUID organization(String value) { UUID id = opaqueId(value); try { db.queryForObject("select id from organizations where id=?", UUID.class, id); return id; } catch (Exception ex) { throw notFound(); } }
  private UUID workspace(String value) { try { return db.queryForObject("select id from workspaces where workspace_key=?", UUID.class, value); } catch (Exception ignored) { UUID id = opaqueId(value); try { db.queryForObject("select id from workspaces where id=?", UUID.class, id); return id; } catch (Exception ex) { throw notFound(); } } }

  private List<String> allowedOrganizationRoles(List<String> roles, boolean ownersAllowed) { return allowed(roles, ownersAllowed ? ORGANIZATION_ROLES : ASSIGNABLE_ORGANIZATION_ROLES, "organization role"); }
  private List<String> allowed(List<String> values, Set<String> allowed, String label) {
    if (values == null || values.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Missing " + label);
    List<String> normalized = values.stream().map(value -> value == null ? "" : value.toLowerCase(Locale.ROOT)).distinct().toList();
    if (!allowed.containsAll(normalized)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid " + label);
    return normalized;
  }
  private void requireRecoveryRequest(RecoveryRequest request, String delivery) {
    if (request == null || !delivery.equals(request.safeDelivery()) || !Boolean.TRUE.equals(request.ownerSafetyConfirmed())) badRequest();
  }
  private void validatePassword(String password) { if (password == null || password.codePointCount(0, password.length()) < 15 || password.codePointCount(0, password.length()) > 512) badRequest(); }
  private static String workspaceRole(String role) {
    return switch (role) {
      case "workspace-administrator" -> "WORKSPACE_ADMINISTRATOR";
      case "author" -> "AUTHOR";
      case "reviewer" -> "REVIEWER";
      case "translator" -> "TRANSLATOR";
      case "publisher" -> "PUBLISHER";
      case "response-viewer" -> "RESPONSE_VIEWER";
      case "response-exporter" -> "RESPONSE_EXPORTER";
      case "auditor" -> "AUDITOR";
      default -> throw new IllegalArgumentException();
    };
  }
  private static String email(String value) { if (value == null || value.isBlank() || value.length() > 254 || !value.contains("@")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid email"); return value.trim().toLowerCase(Locale.ROOT); }
  private static List<String> sqlArray(Object value) { try { return value instanceof Array array ? Arrays.asList((String[]) array.getArray()) : List.of(); } catch (Exception ex) { throw new IllegalStateException(ex); } }
  private String randomSecret() { byte[] bytes = new byte[32]; random.nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
  private static String sha256(String value) { try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); } catch (Exception ex) { throw new IllegalStateException(ex); } }
  private static UUID opaqueId(String value) { try { return UUID.fromString(value.substring(value.indexOf('-') + 1)); } catch (Exception ex) { throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Resource not found"); } }
  private static String opaque(String prefix) { return prefix + "-" + UUID.randomUUID(); }
  private static String opaque(String prefix, UUID id) { return prefix + "-" + id; }
  private static Map<String, Object> page() { return Map.of("limit", 50, "nextCursor", null); }
  private static void badRequest() { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid request"); }
  private static ResponseStatusException unauthorized() { return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Staff session required"); }
  private static ResponseStatusException forbidden() { return new ResponseStatusException(HttpStatus.FORBIDDEN, "Current authority required"); }
  private static ResponseStatusException notFound() { return new ResponseStatusException(HttpStatus.NOT_FOUND, "Resource not found"); }

  private Map<String, Object> organizationUser(Map<String, Object> row) { return organizationUser((UUID) row.get("id"), (String) row.get("email"), sqlArray(row.get("roles")), (String) row.get("membership_status"), ((Number) row.get("revision")).longValue(), ((Timestamp) row.get("created_at")).toInstant(), ((Timestamp) row.get("updated_at")).toInstant()); }
  private static Map<String, Object> organizationUser(UUID account, String email, List<String> roles, String status, long revision, Instant created, Instant updated) { return resource("OrganizationUser", "organizationuser", account, status, revision, created, updated, Map.of("email", email, "roles", roles)); }
  private static Map<String, Object> invitation(UUID id, String email, Instant expires) { return resource("Invitation", "invitation", id, "active", 0, Instant.now(), Instant.now(), Map.of("email", email, "expiresAt", expires.toString())); }
  private static Map<String, Object> accountAction(String action) { return resource("AccountAction", "accountaction", UUID.randomUUID(), "active", 0, Instant.now(), Instant.now(), Map.of("action", action)); }
  private static Map<String, Object> workspaceRole(UUID account, List<String> roles, long revision) { return resource("WorkspaceRole", "workspacerole", account, "active", revision, Instant.now(), Instant.now(), Map.of("roles", roles)); }
  private static Map<String, Object> recovery(String kind, String delivery) { return resource(kind, kind.toLowerCase(Locale.ROOT), UUID.randomUUID(), "active", 0, Instant.now(), Instant.now(), Map.of("safeDelivery", delivery, "revocation", "sessions-revoked", "ownerSafety", "confirmed", "idempotencyReplay", "redacted")); }
  private Map<String, Object> organizationResource(Map<String, Object> row) { return organizationResource((UUID) row.get("id"), (String) row.get("name"), (String) row.get("organization_status"), row.get("revision") instanceof Number revision ? revision.longValue() : 0, ((Timestamp) row.get("created_at")).toInstant()); }
  private static Map<String, Object> organizationResource(UUID id, String name, String status, long revision, Instant created) { return resource("Organization", "organization", id, status, revision, created, created, Map.of("name", name)); }
  private Map<String, Object> platformAccount(UUID account, String status, long revision) { return resource("PlatformAccount", "account", account, "active", revision, Instant.now(), Instant.now(), Map.of("accountStatus", status)); }
  private static Map<String, Object> resource(String kind, String prefix, UUID id, String status, long revision, Instant created, Instant updated, Map<String, Object> fields) { Map<String, Object> output = new LinkedHashMap<>(); output.put("id", opaque(prefix, id)); output.put("kind", kind); output.put("revision", revision); output.put("status", status); output.put("createdAt", created.toString()); output.put("updatedAt", updated.toString()); output.putAll(fields); return output; }
  private record ActionCapability(UUID id, String token) {}
  private record ActionGrant(UUID account, UUID organization) {}
}
