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
  ResponseEntity<?> createUser(@PathVariable String organization, @RequestBody IdentityAdministrationService.UserCreate request, HttpServletRequest http) { return administration.createUser(organization, request, http); }
  @PatchMapping("/organizations/{organization}/users/{user}")
  ResponseEntity<?> updateUser(@PathVariable String organization, @PathVariable String user, @RequestBody IdentityAdministrationService.UserUpdate request, HttpServletRequest http) { return administration.updateUser(organization, user, request, http); }
  @DeleteMapping("/organizations/{organization}/users/{user}")
  ResponseEntity<?> removeUser(@PathVariable String organization, @PathVariable String user, HttpServletRequest http) { return administration.removeUser(organization, user, http); }
  @PostMapping("/organizations/{organization}/users/{user}/invitations")
  ResponseEntity<?> invite(@PathVariable String organization, @PathVariable String user, HttpServletRequest http) { return administration.invite(organization, user, http); }
  @DeleteMapping("/organizations/{organization}/invitations/{invitation}")
  ResponseEntity<?> revokeInvite(@PathVariable String organization, @PathVariable String invitation, HttpServletRequest http) { return administration.revokeInvite(organization, invitation, http); }
  @PostMapping("/organizations/{organization}/users/{user}/recovery")
  ResponseEntity<?> organizationRecovery(@PathVariable String organization, @PathVariable String user, @RequestBody IdentityAdministrationService.RecoveryRequest request, HttpServletRequest http) { return administration.organizationRecovery(organization, user, request, http); }

  @GetMapping("/platform/organizations")
  ResponseEntity<?> platformOrganizations(HttpServletRequest http) { return administration.platformOrganizations(http); }
  @PostMapping("/platform/organizations")
  ResponseEntity<?> createPlatformOrganization(@RequestBody IdentityAdministrationService.OrganizationCreate request, HttpServletRequest http) { return administration.createPlatformOrganization(request, http); }
  @PatchMapping("/platform/organizations/{organization}")
  ResponseEntity<?> updatePlatformOrganization(@PathVariable String organization, @RequestBody IdentityAdministrationService.OrganizationUpdate request, HttpServletRequest http) { return administration.updatePlatformOrganization(organization, request, http); }
  @PostMapping("/platform/organizations/{organization}/users")
  ResponseEntity<?> addPendingOwner(@PathVariable String organization, @RequestBody IdentityAdministrationService.UserCreate request, HttpServletRequest http) { return administration.addPendingOwner(organization, request, http); }
  @PatchMapping("/platform/accounts/{account}")
  ResponseEntity<?> updatePlatformAccount(@PathVariable String account, @RequestBody IdentityAdministrationService.PlatformAccountUpdate request, HttpServletRequest http) { return administration.updatePlatformAccount(account, request, http); }
  @PostMapping("/platform/accounts/{account}/recovery")
  ResponseEntity<?> platformRecovery(@PathVariable String account, @RequestBody IdentityAdministrationService.RecoveryRequest request, HttpServletRequest http) { return administration.platformRecovery(account, request, http); }

  @PutMapping("/workspaces/{workspace}/users/{user}/roles")
  ResponseEntity<?> workspaceRoles(@PathVariable String workspace, @PathVariable String user, @RequestBody IdentityAdministrationService.Roles request, HttpServletRequest http) { return administration.workspaceRoles(workspace, user, request, http); }
  @DeleteMapping("/workspaces/{workspace}/users/{user}/roles")
  ResponseEntity<?> removeWorkspaceRoles(@PathVariable String workspace, @PathVariable String user, HttpServletRequest http) { return administration.removeWorkspaceRoles(workspace, user, http); }
}
