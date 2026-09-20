package com.kodeboxx.smartintake.web;

import com.kodeboxx.smartintake.security.IdentityAdministrationService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1")
public class IdentityAdministrationController {
  private final IdentityAdministrationService administration;

  public IdentityAdministrationController(IdentityAdministrationService administration) {
    this.administration = administration;
  }

  @PostMapping("/auth/password-change")
  ResponseEntity<?> passwordChange(@RequestBody IdentityAdministrationService.PasswordChange request, HttpServletRequest http) { return administration.passwordChange(request, http); }
  @PostMapping("/auth/recovery")
  ResponseEntity<?> recovery(@RequestBody IdentityAdministrationService.Recovery request) { return administration.recovery(request); }
  @PostMapping("/auth/reset")
  ResponseEntity<?> reset(@RequestBody IdentityAdministrationService.TokenPassword request) { return administration.reset(request); }
  @PostMapping("/auth/activate")
  ResponseEntity<?> activate(@RequestBody IdentityAdministrationService.Activation request) { return administration.activate(request); }
  @PostMapping("/invitations/accept")
  ResponseEntity<?> accept(@RequestBody IdentityAdministrationService.InviteAccept request) { return administration.accept(request); }

  @GetMapping("/organizations/{organization}/users")
  ResponseEntity<?> users(@PathVariable String organization, HttpServletRequest http) { return administration.users(organization, http); }
  @PostMapping("/organizations/{organization}/users")
  ResponseEntity<?> createUser(@PathVariable String organization, @RequestBody IdentityAdministrationService.UserCreate request, @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey, HttpServletRequest http) { return administration.createUserMutation(organization, request, idempotencyKey, http); }
  @PatchMapping("/organizations/{organization}/users/{user}")
  ResponseEntity<?> updateUser(@PathVariable String organization, @PathVariable String user, @RequestBody IdentityAdministrationService.UserUpdate request, @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey, @RequestHeader(value = "If-Match", required = false) String ifMatch, HttpServletRequest http) { return administration.updateUserMutation(organization, user, request, idempotencyKey, ifMatch, http); }
  @DeleteMapping("/organizations/{organization}/users/{user}")
  ResponseEntity<?> removeUser(@PathVariable String organization, @PathVariable String user, @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey, @RequestHeader(value = "If-Match", required = false) String ifMatch, HttpServletRequest http) { return administration.removeUserMutation(organization, user, idempotencyKey, ifMatch, http); }
  @PostMapping("/organizations/{organization}/users/{user}/invitations")
  ResponseEntity<?> invite(@PathVariable String organization, @PathVariable String user, @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey, HttpServletRequest http) { return administration.inviteMutation(organization, user, idempotencyKey, http); }
  @DeleteMapping("/organizations/{organization}/invitations/{invitation}")
  ResponseEntity<?> revokeInvite(@PathVariable String organization, @PathVariable String invitation, @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey, @RequestHeader(value = "If-Match", required = false) String ifMatch, HttpServletRequest http) { return administration.revokeInviteMutation(organization, invitation, idempotencyKey, ifMatch, http); }
  @PostMapping("/organizations/{organization}/users/{user}/recovery")
  ResponseEntity<?> organizationRecovery(@PathVariable String organization, @PathVariable String user, @RequestBody IdentityAdministrationService.RecoveryRequest request, @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey, HttpServletRequest http) { return administration.organizationRecoveryMutation(organization, user, request, idempotencyKey, http); }

  @GetMapping("/platform/organizations")
  ResponseEntity<?> platformOrganizations(@RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "50") int limit, HttpServletRequest http) {
    return administration.platformOrganizations(cursor, limit, http);
  }
  @PostMapping("/platform/organizations")
  ResponseEntity<?> createPlatformOrganization(@RequestBody IdentityAdministrationService.OrganizationCreate request, @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey, HttpServletRequest http) { return administration.createPlatformOrganizationMutation(request, idempotencyKey, http); }
  @PatchMapping("/platform/organizations/{organization}")
  ResponseEntity<?> updatePlatformOrganization(@PathVariable String organization, @RequestBody IdentityAdministrationService.OrganizationUpdate request, @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey, @RequestHeader(value = "If-Match", required = false) String ifMatch, HttpServletRequest http) { return administration.updatePlatformOrganizationMutation(organization, request, idempotencyKey, ifMatch, http); }
  @PostMapping("/platform/organizations/{organization}/users")
  ResponseEntity<?> addPendingOwner(@PathVariable String organization, @RequestBody IdentityAdministrationService.UserCreate request, @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey, HttpServletRequest http) { return administration.addPendingOwnerMutation(organization, request, idempotencyKey, http); }
  @PatchMapping("/platform/accounts/{account}")
  ResponseEntity<?> updatePlatformAccount(@PathVariable String account, @RequestBody IdentityAdministrationService.PlatformAccountUpdate request, @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey, @RequestHeader(value = "If-Match", required = false) String ifMatch, HttpServletRequest http) { return administration.updatePlatformAccountMutation(account, request, idempotencyKey, ifMatch, http); }
  @PostMapping("/platform/accounts/{account}/recovery")
  ResponseEntity<?> platformRecovery(@PathVariable String account, @RequestBody IdentityAdministrationService.RecoveryRequest request, @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey, HttpServletRequest http) { return administration.platformRecoveryMutation(account, request, idempotencyKey, http); }

  @GetMapping("/workspaces/{workspace}/members")
  ResponseEntity<?> workspaceMembers(@PathVariable String workspace, HttpServletRequest http) { return administration.workspaceMembers(workspace, http); }
  @PutMapping("/workspaces/{workspace}/users/{user}/roles")
  ResponseEntity<?> workspaceRoles(@PathVariable String workspace, @PathVariable String user, @RequestBody IdentityAdministrationService.Roles request, @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey, @RequestHeader(value = "If-Match", required = false) String ifMatch, HttpServletRequest http) { return administration.workspaceRolesMutation(workspace, user, request, idempotencyKey, ifMatch, http); }
  @DeleteMapping("/workspaces/{workspace}/users/{user}/roles")
  ResponseEntity<?> removeWorkspaceRoles(@PathVariable String workspace, @PathVariable String user, @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey, @RequestHeader(value = "If-Match", required = false) String ifMatch, HttpServletRequest http) { return administration.removeWorkspaceRolesMutation(workspace, user, idempotencyKey, ifMatch, http); }
}
