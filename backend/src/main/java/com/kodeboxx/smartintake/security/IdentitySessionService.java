package com.kodeboxx.smartintake.security;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Dedicated M6 identity boundary for bootstrap, credential proof, and staff session lifecycle. */
@Service
public class IdentitySessionService {
  public static final String CSRF_COOKIE = "SI_CSRF";
  public static final String LOGIN_CSRF_COOKIE = "SI_LOGIN_CSRF";
  private static final Duration IDLE_TTL = Duration.ofHours(2);
  private static final Duration ABSOLUTE_TTL = Duration.ofHours(12);
  private static final Duration LOGIN_CSRF_TTL = Duration.ofMinutes(5);
  private static final Duration THROTTLE_WINDOW = Duration.ofMinutes(15);
  private static final int ACCOUNT_THROTTLE_LIMIT = 10;
  // These aggregate controls are deliberately much higher than the account control:
  // they slow distributed guessing without allowing one account to deny unrelated users.
  private static final int SOURCE_THROTTLE_LIMIT = 100;
  private static final int GLOBAL_THROTTLE_LIMIT = 1_000;
  private static final int MAX_UNKNOWN_THROTTLE_BUCKETS = 10_000;
  private final JdbcTemplate db;
  private final IdentitySessionResolver resolver;
  private final CredentialEncoder credentials;
  private final List<String> allowedOrigins;
  private final String bootstrapToken;
  private final Set<String> trustedProxyAddresses;
  private final SecureRandom random = new SecureRandom();

  public record Credentials(String email, String password) {}
  public record BootstrapRequest(String email, String password, String organizationName, String workspaceName) {}

  public IdentitySessionService(JdbcTemplate db, IdentitySessionResolver resolver, CredentialEncoder credentials,
      @Value("${smartintake.security.allowed-origins:http://localhost:4200,http://127.0.0.1:4200}") String origins,
      @Value("${smartintake.bootstrap-token:${SMARTINTAKE_BOOTSTRAP_TOKEN:}}") String bootstrapToken,
      @Value("${smartintake.trusted-proxy-addresses:}") String trustedProxyAddresses) {
    this.db = db;
    this.resolver = resolver;
    this.credentials = credentials;
    this.allowedOrigins = java.util.Arrays.stream(origins.split(",")).map(String::trim).filter(value -> !value.isEmpty()).toList();
    this.bootstrapToken = bootstrapToken;
    this.trustedProxyAddresses = java.util.Arrays.stream(trustedProxyAddresses.split(",")).map(String::trim).filter(value -> !value.isEmpty()).collect(java.util.stream.Collectors.toUnmodifiableSet());
  }

  @Transactional
  public ResponseEntity<?> bootstrap(BootstrapRequest input, String presentedBootstrapToken, HttpServletRequest request) {
    requireOrigin(request);
    if (bootstrapToken == null || bootstrapToken.isBlank() || presentedBootstrapToken == null
        || !MessageDigest.isEqual(bootstrapToken.getBytes(StandardCharsets.UTF_8), presentedBootstrapToken.getBytes(StandardCharsets.UTF_8))) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Bootstrap unavailable");
    }
    validateCredentials(input.email(), input.password());
    Boolean completed = db.queryForObject("select completed_at is not null from identity_bootstrap_state where singleton=true for update", Boolean.class);
    if (Boolean.TRUE.equals(completed) || db.queryForObject("select count(*) from accounts", Integer.class) != 0)
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Bootstrap closed");
    UUID account = UUID.randomUUID();
    UUID organization = UUID.randomUUID();
    UUID workspace = UUID.randomUUID();
    db.update("insert into accounts(id,email,password_hash,activation_state,temporary_password_expires_at) values(?,?,?,'pending',now()+interval '24 hours')", account, normalizedEmail(input.email()), credentials.encode(input.password()));
    db.update("insert into organizations(id,name) values(?,?)", organization, nonBlank(input.organizationName(), "Local organization"));
    db.update("insert into workspaces(id,organization_id,workspace_key,name) values(?,?,?,?)", workspace, organization, "local", nonBlank(input.workspaceName(), "Local workspace"));
    db.update("insert into memberships(account_id,workspace_id,role) values(?,?,?)", account, workspace, "WORKSPACE_ADMINISTRATOR");
    // The protected one-time bootstrap establishes the initial platform authority as well as tenant ownership.
    db.update("insert into platform_roles(account_id,role) values(?,'administrator') on conflict do nothing", account);
    db.update("insert into organization_memberships(account_id,organization_id,roles,membership_status) values(?,?,array['owner','administrator'],'suspended')", account, organization);
    String activation = secret();
    db.update("insert into identity_secret_actions(id,account_id,organization_id,action,token_hash,expires_at) values(?,?,?,'activation',?,now()+interval '24 hours')",
        UUID.randomUUID(), account, organization, sha256(activation));
    db.update("update identity_bootstrap_state set completed_at=now() where singleton=true");
    audit("identity.bootstrap", account, Map.of("organization", organization.toString()));
    return ResponseEntity.status(HttpStatus.CREATED).header("X-Activation-Copy-Link", "/activate/" + activation)
        .body(Map.of("requestId", opaque("req"), "bootstrap", "pending-activation"));
  }

  public ResponseEntity<?> anonymousSession() {
    String token = UUID.randomUUID().toString();
    db.update("delete from login_csrf_challenges where expires_at <= now() or consumed_at is not null");
    db.update("insert into login_csrf_challenges(token_hash,expires_at) values(?,?)", sha256(token), Timestamp.from(Instant.now().plus(LOGIN_CSRF_TTL)));
    return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
        .header("X-Login-CSRF-Token", token)
        .header(HttpHeaders.SET_COOKIE, loginCsrfCookie(token).toString())
        .build();
  }

  @Transactional(noRollbackFor = ResponseStatusException.class)
  public ResponseEntity<?> signIn(Credentials input, String loginCsrf, HttpServletRequest request) {
    requireOrigin(request);
    consumeLoginCsrf(loginCsrf, cookie(request, LOGIN_CSRF_COOKIE));
    String normalized = normalizedEmail(input == null ? null : input.email());
    List<ThrottleBucket> subjects = throttleSubjects(normalized, clientSource(request));
    cleanupThrottleBuckets();
    UUID account = null;
    try {
      if (input == null || input.email() == null || input.password() == null) throw new IllegalArgumentException();
      List<Map<String, Object>> rows = db.queryForList(
          "select id,password_hash,account_status,activation_state,temporary_password_expires_at from accounts where email=?",
          normalizedEmail(input.email()));
      String hash = rows.isEmpty() ? credentials.encode("invalid-credential-proof") : (String) rows.get(0).get("password_hash");
      if (!credentials.matches(input.password(), hash) || rows.isEmpty()) throw new IllegalArgumentException();
      Map<String, Object> accountRow = rows.get(0);
      if (!"active".equals(accountRow.get("account_status"))) throw new IllegalArgumentException();
      if ("pending".equals(accountRow.get("activation_state"))) {
        Timestamp expires = (Timestamp) accountRow.get("temporary_password_expires_at");
        if (expires == null || !expires.toInstant().isAfter(Instant.now())) throw new IllegalArgumentException();
      }
      account = ((UUID) accountRow.get("id"));
    } catch (Exception ignored) {
      // Aggregate buckets deliberately apply only after a proof has failed.
      // This prevents a shared source or the global capacity counter from
      // turning an attack into a denial of service for legitimate credentials.
      if (subjects.stream().anyMatch(this::throttled))
        throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Try again later");
      subjects.forEach(this::registerFailure);
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
    }
    // Account protection remains independent: a correct password does not
    // bypass that account's own ten-failure lock, but source/global saturation
    // never denies a correct known credential.
    if (throttled(subjects.get(0)))
      throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Try again later");
    db.update("delete from sign_in_throttles where subject_hash=?", sha256("account|" + normalized));
    resolver.session(request, request.getHeader("X-Staff-Session")).ifPresent(token -> db.update("update staff_sessions set revoked_at=now(),updated_at=now() where token::text=? and revoked_at is null", token));
    boolean setupOnly = Boolean.TRUE.equals(db.queryForObject("select activation_state='pending' from accounts where id=?", Boolean.class, account));
    return issued(account, request, HttpStatus.OK, setupOnly);
  }

  public ResponseEntity<?> currentSession(HttpServletRequest request) {
    String token = resolver.session(request, request.getHeader("X-Staff-Session")).orElse(null);
    if (token == null) return anonymousSession();
    try {
      Map<String, Object> row = db.queryForMap(
          "select s.account_id,a.email,a.activation_state,a.account_status,s.created_at,s.updated_at,s.last_seen_at,s.absolute_expires_at,s.csrf_token_hash,s.setup_only,s.current_organization_id,s.current_workspace_id"
              + " from staff_sessions s join accounts a on a.id=s.account_id where s.token::text=? and s.revoked_at is null and a.account_status='active'"
              + " and s.last_seen_at > now() - interval '2 hours' and s.expires_at > now() and s.absolute_expires_at > now()", token);
      boolean setupOnly = Boolean.TRUE.equals(row.get("setup_only"));
      db.update("update staff_sessions set last_seen_at=now(),expires_at=now() + (? * interval '1 second'),updated_at=now() where token::text=?",
          setupOnly ? Duration.ofMinutes(15).toSeconds() : IDLE_TTL.toSeconds(), token);
      UUID account = (UUID) row.get("account_id");
      String email = (String) row.get("email");
      List<Map<String, Object>> memberships = setupOnly ? List.of() : db.queryForList(
          "select o.id organization_id,o.name organization_name,w.id workspace_id,w.name workspace_name,m.role"
              + " from memberships m join workspaces w on w.id=m.workspace_id join organizations o on o.id=w.organization_id"
              + " join organization_memberships om on om.account_id=m.account_id and om.organization_id=o.id"
              + " where m.account_id=? and om.membership_status='active' and o.organization_status='active' order by o.name,w.name,m.role", account);
      List<Map<String, Object>> organizationGrants = setupOnly ? List.of() : db.queryForList(
          "select o.id organization_id,o.name organization_name,om.roles from organization_memberships om join organizations o on o.id=om.organization_id"
              + " where om.account_id=? and om.membership_status='active' and o.organization_status='active' order by o.name", account);
      List<String> platformRoles = setupOnly ? List.of() : db.queryForList("select role from platform_roles where account_id=? order by role", String.class, account);
      return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, staffCookie(token, setupOnly).toString()).body(
          sessionResponse(account, email, memberships, organizationGrants, platformRoles, setupOnly, (String) row.get("activation_state"),
              (String) row.get("account_status"), setupOnly ? null : (UUID) row.get("current_organization_id"),
              setupOnly ? null : (UUID) row.get("current_workspace_id")));
    } catch (Exception ignored) {
      return anonymousSession();
    }
  }

  @Transactional
  public ResponseEntity<?> signOut(HttpServletRequest request) {
    // StaffCsrfFilter owns the single CSRF/Origin check for an authenticated sign-out request.
    String token = resolver.session(request, request.getHeader("X-Staff-Session")).orElse(null);
    if (token != null) db.update("update staff_sessions set revoked_at=now(),updated_at=now() where token::text=? and revoked_at is null", token);
    return ResponseEntity.noContent()
        .header(HttpHeaders.SET_COOKIE, expiredCookie(IdentitySessionResolver.STAFF_COOKIE, true).toString())
        .header(HttpHeaders.SET_COOKIE, expiredCookie(CSRF_COOKIE, false).toString())
        .build();
  }

  public boolean setupOnly(String token) {
    try {
      return Boolean.TRUE.equals(db.queryForObject("select setup_only from staff_sessions where token::text=? and revoked_at is null and expires_at>now() and absolute_expires_at>now()", Boolean.class, token));
    } catch (Exception ignored) {
      return false;
    }
  }

  public boolean validCsrf(String token, String presentedCsrf) {
    if (token == null || presentedCsrf == null) return false;
    try {
      String stored = db.queryForObject("select csrf_token_hash from staff_sessions where token::text=? and revoked_at is null", String.class, token);
      return constantTimeEquals(stored, sha256(presentedCsrf));
    } catch (Exception ignored) {
      return false;
    }
  }

  public void requireOrigin(HttpServletRequest request) {
    String origin = request.getHeader(HttpHeaders.ORIGIN);
    if (resolver.isTestProfile() && origin == null) return;
    String ownOrigin = request.getScheme() + "://" + request.getServerName()
        + ((request.getServerPort() == 80 || request.getServerPort() == 443) ? "" : ":" + request.getServerPort());
    if (origin == null || !(origin.equals(ownOrigin) || allowedOrigins.contains(origin)))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Origin denied");
  }

  private ResponseEntity<?> issued(UUID account, HttpServletRequest request, HttpStatus status, boolean setupOnly) {
    String token = UUID.randomUUID().toString();
    String csrf = secret();
    Instant now = Instant.now();
    Duration idleTtl = setupOnly ? Duration.ofMinutes(15) : IDLE_TTL;
    Duration absoluteTtl = setupOnly ? Duration.ofMinutes(15) : ABSOLUTE_TTL;
    List<Map<String, Object>> contexts = db.queryForList(
        "select w.organization_id,w.id from memberships m join workspaces w on w.id=m.workspace_id where m.account_id=? order by w.created_at limit 1", account);
    UUID organization = contexts.isEmpty() ? null : (UUID) contexts.get(0).get("organization_id");
    UUID workspace = contexts.isEmpty() ? null : (UUID) contexts.get(0).get("id");
    db.update("insert into staff_sessions(token,account_id,expires_at,csrf_token_hash,last_seen_at,absolute_expires_at,updated_at,setup_only,current_organization_id,current_workspace_id) values(?,?,?,?,?,?,?,?,?,?)",
        UUID.fromString(token), account, Timestamp.from(now.plus(idleTtl)), sha256(csrf), Timestamp.from(now), Timestamp.from(now.plus(absoluteTtl)), Timestamp.from(now), setupOnly, setupOnly ? null : organization, setupOnly ? null : workspace);
    Map<String, Object> body = Map.of("requestId", opaque("req"), "staffSession", Map.of(
        "id", opaque("staffsession"), "kind", "StaffSession", "revision", 0, "status", "active",
        "createdAt", now.toString(), "updatedAt", now.toString(), "userId", opaque("account", account),
        "expiresAt", now.plus(absoluteTtl).toString(), "csrfToken", csrf));
    return ResponseEntity.status(status)
        .header(HttpHeaders.SET_COOKIE, staffCookie(token, setupOnly).toString())
        .header("X-CSRF-Token", csrf)
        .header(HttpHeaders.SET_COOKIE, csrfCookie(csrf, setupOnly).toString())
        .body(body);
  }

  private Map<String, Object> sessionResponse(UUID account, String email, List<Map<String, Object>> memberships,
      List<Map<String, Object>> organizationGrants, List<String> platformRoles, boolean setupOnly,
      String activationState, String accountStatus, UUID currentOrganization, UUID currentWorkspace) {
    Map<UUID, Map<String, Object>> organizations = new LinkedHashMap<>();
    for (Map<String, Object> grant : organizationGrants) {
      UUID organization = (UUID) grant.get("organization_id");
      organizations.put(organization, new LinkedHashMap<>(Map.of(
          "organizationId", opaque("organization", organization), "name", grant.get("organization_name"),
          "membershipState", "active", "organizationRoles", sqlArray(grant.get("roles")),
          "workspaces", new java.util.ArrayList<Map<String, Object>>())));
    }
    for (Map<String, Object> membership : memberships) {
      UUID organization = (UUID) membership.get("organization_id");
      @SuppressWarnings("unchecked") List<Map<String, Object>> workspaces = (List<Map<String, Object>>) organizations
          .computeIfAbsent(organization, ignored -> new LinkedHashMap<>(Map.of("organizationId", opaque("organization", organization),
              "name", membership.get("organization_name"), "membershipState", "active", "organizationRoles", List.of(), "workspaces", new java.util.ArrayList<Map<String, Object>>())))
          .get("workspaces");
      workspaces.add(Map.of("workspaceId", opaque("workspace", (UUID) membership.get("workspace_id")),
          "name", membership.get("workspace_name"), "roles", List.of(role((String) membership.get("role")))));
    }
    Map<String, Object> authenticated = new LinkedHashMap<>();
    authenticated.put("safeIdentity", Map.of("accountId", opaque("account", account), "username", email, "displayName", displayName(email)));
    authenticated.put("activationState", activationState);
    authenticated.put("accountStatus", accountStatus);
    authenticated.put("awaitingSetup", setupOnly);
    authenticated.put("platformRoles", setupOnly ? List.of() : platformRoles);
    authenticated.put("organizations", setupOnly ? List.of() : List.copyOf(organizations.values()));
    if (!setupOnly) {
      authenticated.put("currentOrganizationId", currentOrganization == null
          ? (organizations.isEmpty() ? null : organizations.values().iterator().next().get("organizationId"))
          : opaque("organization", currentOrganization));
      if (currentWorkspace != null) authenticated.put("currentWorkspaceId", opaque("workspace", currentWorkspace));
    }
    return Map.of("requestId", opaque("req"), "authenticatedSession", authenticated);
  }

  private List<ThrottleBucket> throttleSubjects(String email, String source) {
    String safeSource = source == null || source.isBlank() ? "unknown" : source;
    List<ThrottleBucket> buckets = new java.util.ArrayList<>();
    // Every identifier gets the same bounded bucket so status behavior cannot reveal
    // whether the normalized address belongs to a registered account.
    buckets.add(new ThrottleBucket(sha256("account|" + email), ACCOUNT_THROTTLE_LIMIT));
    buckets.add(new ThrottleBucket(sha256("source|" + safeSource), SOURCE_THROTTLE_LIMIT));
    buckets.add(new ThrottleBucket(sha256("global|sign-in"), GLOBAL_THROTTLE_LIMIT));
    return buckets;
  }

  private void cleanupThrottleBuckets() {
    db.update("delete from sign_in_throttles where updated_at < now() - interval '1 day'");
    db.update("delete from sign_in_throttles where subject_hash in (select subject_hash from sign_in_throttles where subject_hash not in (select subject_hash from sign_in_throttles where subject_hash=? or subject_hash=? ) order by updated_at desc offset ?)",
        sha256("global|sign-in"), sha256("global|sign-in"), MAX_UNKNOWN_THROTTLE_BUCKETS);
  }

  private boolean throttled(ThrottleBucket bucket) {
    List<Map<String, Object>> rows = db.queryForList("select failure_count,window_started_at,blocked_until from sign_in_throttles where subject_hash=?", bucket.subject());
    if (rows.isEmpty()) return false;
    Object blocked = rows.get(0).get("blocked_until");
    return blocked instanceof Timestamp timestamp && timestamp.toInstant().isAfter(Instant.now());
  }

  private void registerFailure(ThrottleBucket bucket) {
    long seconds = THROTTLE_WINDOW.toSeconds();
    db.queryForMap("""
        insert into sign_in_throttles(subject_hash,failure_count,window_started_at,blocked_until,updated_at)
        values (?, 1, now(), null, now())
        on conflict (subject_hash) do update set
          failure_count = case when sign_in_throttles.window_started_at + (? * interval '1 second') <= now()
              then 1 else sign_in_throttles.failure_count + 1 end,
          window_started_at = case when sign_in_throttles.window_started_at + (? * interval '1 second') <= now()
              then now() else sign_in_throttles.window_started_at end,
          blocked_until = case when (case when sign_in_throttles.window_started_at + (? * interval '1 second') <= now()
              then 1 else sign_in_throttles.failure_count + 1 end) >= ?
              then now() + (? * interval '1 second') else null end,
          updated_at = now()
        returning failure_count, window_started_at, blocked_until
        """, bucket.subject(), seconds, seconds, seconds, bucket.limit(), seconds);
  }

  private String clientSource(HttpServletRequest request) {
    String remote = request.getRemoteAddr();
    if (!trustedProxyAddresses.contains(remote)) return remote;
    String forwarded = request.getHeader("X-Forwarded-For");
    return forwarded == null || forwarded.isBlank() ? remote : forwarded.split(",", 2)[0].trim();
  }

  private void consumeLoginCsrf(String header, String cookie) {
    if (header == null || cookie == null || !constantTimeEquals(header, cookie)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Sign-in denied");
    int changed = db.update("update login_csrf_challenges set consumed_at=now() where token_hash=? and consumed_at is null and expires_at>now()", sha256(header));
    if (changed != 1) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Sign-in denied");
  }

  private void audit(String action, UUID resource, Map<String, Object> detail) {
    // Audit payloads deliberately contain only stable hashed correlations, never
    // credentials, cookies, CSRF values, or capability proofs.
    String target = sha256(resource.toString()).substring(0, 16);
    db.update("insert into audit_events(id,action,resource_id,detail) values(?,?,?,cast(? as jsonb))", UUID.randomUUID(), action, resource,
        "{\"category\":\"identity\",\"actor\":\"deployment-bootstrap\",\"tenantScope\":\"bootstrap\",\"target\":\"id-" + target
            + "\",\"reasonClass\":\"initial-provisioning\",\"deliveryClass\":\"copy-link\",\"ownerSafetyDecision\":\"initial-owner\",\"outcome\":\"success\",\"revision\":0,\"requestCorrelation\":null,\"idempotencyCorrelation\":null}");
  }

  private record ThrottleBucket(String subject, int limit) {}

  private void validateCredentials(String email, String password) {
    if (email == null || !email.contains("@") || email.length() > 254 || password == null
        || password.codePointCount(0, password.length()) < 15 || password.codePointCount(0, password.length()) > 512)
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid credentials");
  }

  private static String normalizedEmail(String email) { return email == null ? "" : email.toLowerCase(Locale.ROOT); }
  private static List<String> sqlArray(Object value) {
    try { return value instanceof java.sql.Array array ? List.of((String[]) array.getArray()) : List.of(); }
    catch (java.sql.SQLException ignored) { return List.of(); }
  }
  private static String nonBlank(String value, String fallback) { return value == null || value.isBlank() ? fallback : value; }
  private static String role(String storedRole) {
    return switch (storedRole) {
      // OWNER is a read-only compatibility alias for pre-M6 workspace administrators.
      case "OWNER", "WORKSPACE_ADMINISTRATOR" -> "workspace-administrator";
      case "AUTHOR" -> "author";
      case "REVIEWER" -> "reviewer";
      case "TRANSLATOR" -> "translator";
      case "PUBLISHER" -> "publisher";
      case "RESPONSE_VIEWER" -> "response-viewer";
      case "RESPONSE_EXPORTER" -> "response-exporter";
      case "AUDITOR" -> "auditor";
      default -> storedRole.toLowerCase(Locale.ROOT);
    };
  }
  private static String displayName(String email) { return email.substring(0, email.indexOf('@')); }
  private String secret() { byte[] bytes = new byte[32]; random.nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
  private static String opaque(String prefix) { return prefix + "-" + UUID.randomUUID(); }
  private static String opaque(String prefix, UUID id) { return prefix + "-" + id; }
  private static String sha256(String value) { try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); } catch (Exception e) { throw new IllegalStateException(e); } }
  private static boolean constantTimeEquals(String left, String right) { return left != null && right != null && MessageDigest.isEqual(left.getBytes(StandardCharsets.UTF_8), right.getBytes(StandardCharsets.UTF_8)); }
  private static String cookie(HttpServletRequest request, String name) { if (request.getCookies() == null) return null; for (Cookie cookie : request.getCookies()) if (name.equals(cookie.getName())) return cookie.getValue(); return null; }
  public ResponseCookie renewStaffCookie(String value) { return staffCookie(value, setupOnly(value)); }
  private static ResponseCookie staffCookie(String value, boolean setupOnly) { return ResponseCookie.from(IdentitySessionResolver.STAFF_COOKIE, value).httpOnly(true).secure(true).sameSite("Strict").path("/").maxAge(setupOnly ? Duration.ofMinutes(15) : IDLE_TTL).build(); }
  private static ResponseCookie csrfCookie(String value, boolean setupOnly) { return ResponseCookie.from(CSRF_COOKIE, value).httpOnly(false).secure(true).sameSite("Strict").path("/").maxAge(setupOnly ? Duration.ofMinutes(15) : IDLE_TTL).build(); }
  private static ResponseCookie loginCsrfCookie(String value) { return ResponseCookie.from(LOGIN_CSRF_COOKIE, value).httpOnly(true).secure(true).sameSite("Strict").path("/v1/auth").maxAge(LOGIN_CSRF_TTL).build(); }
  private static ResponseCookie expiredCookie(String name, boolean httpOnly) { return ResponseCookie.from(name, "").httpOnly(httpOnly).secure(true).sameSite("Strict").path("/").maxAge(Duration.ZERO).build(); }
}
