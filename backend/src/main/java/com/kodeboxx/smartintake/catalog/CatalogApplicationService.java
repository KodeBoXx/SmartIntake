package com.kodeboxx.smartintake.catalog;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import com.kodeboxx.smartintake.security.IdentitySessionResolver;

/** M6 catalog authority boundary. Request role claims are deliberately never accepted. */
@Service
public class CatalogApplicationService {
  // OWNER is retained only for pre-M6 workspace-administrator compatibility.
  private static final Set<String> CATALOG_READ = Set.of(
      "WORKSPACE_ADMINISTRATOR", "OWNER", "AUTHOR", "REVIEWER", "TRANSLATOR", "PUBLISHER",
      "RESPONSE_VIEWER", "RESPONSE_EXPORTER", "AUDITOR");
  // Authoring and workspace administration are deliberately disjoint. A workspace
  // administrator can manage ownership, members and settings, but does not receive
  // authoring permissions merely by administering the workspace.
  private static final Set<String> CATALOG_AUTHORING = Set.of("AUTHOR");
  private static final Set<String> WORKSPACE_ADMINISTRATION = Set.of("WORKSPACE_ADMINISTRATOR", "OWNER");
  private final CatalogRepository catalog;
  private final JdbcTemplate db;
  private final IdentitySessionResolver sessions;

  public CatalogApplicationService(CatalogRepository catalog, JdbcTemplate db, IdentitySessionResolver sessions) {
    this.catalog = catalog;
    this.db = db;
    this.sessions = sessions;
  }

  public record Named(String name) {}
  public record TagInput(String name, String color) {}
  public record FormClassification(UUID folderId, List<UUID> tagIds) {}
  public record Transfer(String accountId) {}
  public record Settings(Map<String, Object> policyOverrides, Map<String, Object> providerOverrides) {}

  public Map<String, Object> search(String workspace, String headerToken, HttpServletRequest request,
                                    CatalogRepository.Search search) {
    Principal principal = principal(workspace, headerToken, request, CATALOG_READ);
    CatalogRepository.Page page = catalog.search(principal.workspaceId(), search);
    return Map.of("items", page.items(), "nextCursor", page.nextCursor() == null ? "" : page.nextCursor(), "catalogRevision", page.catalogRevision());
  }
  public List<Map<String, Object>> folders(String workspace, String token, HttpServletRequest request) {
    return catalog.folders(principal(workspace, token, request, CATALOG_READ).workspaceId());
  }
  @Transactional public Map<String, Object> createFolder(String workspace, String token, HttpServletRequest request, Named input) {
    return catalog.createFolder(principal(workspace, token, request, CATALOG_AUTHORING).workspaceId(), input == null ? null : input.name());
  }
  @Transactional public Map<String, Object> updateFolder(String workspace, String token, HttpServletRequest request, UUID folder, Named input) {
    return catalog.updateFolder(principal(workspace, token, request, CATALOG_AUTHORING).workspaceId(), folder, input == null ? null : input.name());
  }
  @Transactional public void deleteFolder(String workspace, String token, HttpServletRequest request, UUID folder) {
    catalog.deleteFolder(principal(workspace, token, request, CATALOG_AUTHORING).workspaceId(), folder);
  }
  public List<Map<String, Object>> tags(String workspace, String token, HttpServletRequest request) {
    return catalog.tags(principal(workspace, token, request, CATALOG_READ).workspaceId());
  }
  @Transactional public Map<String, Object> createTag(String workspace, String token, HttpServletRequest request, TagInput input) {
    return catalog.createTag(principal(workspace, token, request, CATALOG_AUTHORING).workspaceId(), input == null ? null : input.name(), input == null ? null : input.color());
  }
  @Transactional public Map<String, Object> updateTag(String workspace, String token, HttpServletRequest request, UUID tag, TagInput input) {
    return catalog.updateTag(principal(workspace, token, request, CATALOG_AUTHORING).workspaceId(), tag, input == null ? null : input.name(), input == null ? null : input.color());
  }
  @Transactional public void deleteTag(String workspace, String token, HttpServletRequest request, UUID tag) {
    catalog.deleteTag(principal(workspace, token, request, CATALOG_AUTHORING).workspaceId(), tag);
  }
  @Transactional public Map<String, Object> duplicate(String workspace, String token, HttpServletRequest request, UUID form) {
    Principal principal = principal(workspace, token, request, CATALOG_AUTHORING);
    return catalog.duplicate(principal.workspaceId(), form, principal.accountId());
  }
  @Transactional public Map<String, Object> archive(String workspace, String token, HttpServletRequest request, UUID form) {
    Principal principal = principal(workspace, token, request, CATALOG_AUTHORING);
    return catalog.archive(principal.workspaceId(), form, principal.accountId());
  }
  @Transactional public Map<String, Object> restore(String workspace, String token, HttpServletRequest request, UUID form) {
    return catalog.restore(principal(workspace, token, request, CATALOG_AUTHORING).workspaceId(), form);
  }
  @Transactional public Map<String, Object> transfer(String workspace, String token, HttpServletRequest request, UUID form, Transfer input) {
    Principal principal = principal(workspace, token, request, WORKSPACE_ADMINISTRATION);
    if (input == null || input.accountId() == null) throw bad("TRANSFER_TARGET_INVALID", "A workspace account is required");
    return catalog.transfer(principal.workspaceId(), form, opaqueId("account", input.accountId()));
  }
  @Transactional public void classify(String workspace, String token, HttpServletRequest request, UUID form, FormClassification input) {
    Principal principal = principal(workspace, token, request, CATALOG_AUTHORING);
    if (input == null) throw bad("CATALOG_INPUT_INVALID", "Classification is required");
    catalog.setFolder(principal.workspaceId(), form, input.folderId(), principal.accountId());
    catalog.setTags(principal.workspaceId(), form, input.tagIds() == null ? List.of() : input.tagIds(), principal.accountId());
  }
  public Map<String, Object> settings(String workspace, String token, HttpServletRequest request) {
    return catalog.effectiveSettings(principal(workspace, token, request, WORKSPACE_ADMINISTRATION).workspaceId());
  }
  @Transactional public Map<String, Object> updateSettings(String workspace, String token, HttpServletRequest request, Settings input) {
    return catalog.updateSettings(principal(workspace, token, request, WORKSPACE_ADMINISTRATION).workspaceId(),
        input == null || input.policyOverrides() == null ? Map.of() : input.policyOverrides(),
        input == null || input.providerOverrides() == null ? Map.of() : input.providerOverrides());
  }

  private Principal principal(String workspaceKey, String headerToken, HttpServletRequest request, Set<String> requiredRoles) {
    UUID workspace;
    try { workspace = db.queryForObject("select w.id from workspaces w join organizations o on o.id=w.organization_id where (w.workspace_key=? or w.id=?::uuid) and o.organization_status='active'", UUID.class, workspaceKey, workspaceKey != null && workspaceKey.startsWith("workspace-") ? opaqueId("workspace", workspaceKey) : new UUID(0, 0)); }
    catch (Exception ignored) { throw missing(); }
    String session = sessions.session(request, headerToken).orElseThrow(this::unauthenticated);
    UUID account;
    try {
      account = db.queryForObject("select s.account_id from staff_sessions s join accounts a on a.id=s.account_id where s.token::text=? and s.revoked_at is null and s.setup_only=false and a.account_status='active' and s.last_seen_at > now()-interval '2 hours' and s.expires_at>now() and s.absolute_expires_at>now()", UUID.class, session);
    } catch (Exception ignored) { throw unauthenticated(); }
    List<String> roles = db.queryForList("select role from memberships where workspace_id=? and account_id=?", String.class, workspace, account);
    if (roles.isEmpty()) throw missing(); // Do not disclose a cross-workspace resource.
    if (!requiredRoles.isEmpty() && roles.stream().noneMatch(requiredRoles::contains)) throw forbidden();
    return new Principal(workspace, account, Set.copyOf(roles));
  }
  private record Principal(UUID workspaceId, UUID accountId, Set<String> roles) {}
  private ResponseStatusException unauthenticated() { return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Valid staff workspace session required"); }
  private ResponseStatusException forbidden() { return new ResponseStatusException(HttpStatus.FORBIDDEN, "Current workspace role cannot perform this action"); }
  private ResponseStatusException missing() { return new ResponseStatusException(HttpStatus.NOT_FOUND, "Resource not found"); }
  private ResponseStatusException bad(String code, String detail) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, code + ": " + detail); }
  private UUID opaqueId(String kind, String value) {
    try { return UUID.fromString(value.startsWith(kind + "-") ? value.substring(kind.length() + 1) : value); }
    catch (Exception ignored) { throw bad("CATALOG_INPUT_INVALID", "Invalid " + kind + " identifier"); }
  }
}
