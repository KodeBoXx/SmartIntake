package com.kodeboxx.smartintake;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kodeboxx.smartintake.security.IdentitySessionResolver;
import com.kodeboxx.smartintake.security.IdentitySessionService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

@ActiveProfiles("test")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class IdentitySessionIntegrationTests {
  @LocalServerPort int port;
  @Autowired TestRestTemplate http;
  @Autowired JdbcTemplate db;
  @Autowired ObjectMapper json;

  private String url(String path) { return "http://localhost:" + port + "/v1/auth" + path; }
  private ResponseEntity<String> call(String path, HttpMethod method, HttpHeaders headers, Object body) {
    return http.exchange(url(path), method, new HttpEntity<>(body, headers), String.class);
  }
  private HttpHeaders jsonHeaders() { HttpHeaders headers = new HttpHeaders(); headers.setContentType(MediaType.APPLICATION_JSON); return headers; }
  private String cookie(ResponseEntity<String> response, String name) {
    return response.getHeaders().get(HttpHeaders.SET_COOKIE).stream().filter(value -> value.startsWith(name + "=")).findFirst().orElseThrow().split(";", 2)[0];
  }
  private Map<String, Object> object(String body) throws Exception { return json.readValue(body, new TypeReference<>() {}); }

  @BeforeEach
  void clearIdentity() {
    db.execute("truncate table staff_sessions, memberships, workspaces, organizations, accounts cascade");
    db.update("update identity_bootstrap_state set completed_at=null where singleton=true");
    db.update("delete from login_csrf_challenges");
    db.update("delete from sign_in_throttles");
  }

  @Test
  void bootstrapRequiresFifteenUnicodeCodePointsAndOnlyRunsOnce() throws Exception {
    HttpHeaders headers = jsonHeaders();
    assertEquals(HttpStatus.BAD_REQUEST, call("/bootstrap", HttpMethod.POST, headers,
        Map.of("email", "owner@example.test", "password", "12345678901234")).getStatusCode());
    String unicodePassword = "😀".repeat(64);
    ResponseEntity<String> created = call("/bootstrap", HttpMethod.POST, jsonHeaders(),
        Map.of("email", "owner@example.test", "password", unicodePassword));
    assertEquals(HttpStatus.CREATED, created.getStatusCode());
    Map<String, Object> body = object(created.getBody());
    assertTrue(body.containsKey("requestId"));
    assertTrue(body.containsKey("staffSession"));
    assertFalse(created.getBody().contains("SI_STAFF_SESSION"));
    assertEquals(HttpStatus.CONFLICT, call("/bootstrap", HttpMethod.POST, jsonHeaders(),
        Map.of("email", "second@example.test", "password", "123456789012345")).getStatusCode());
  }

  @Test
  void signInUsesOneTimeLoginCsrfAndCreatesCookieOnlySession() throws Exception {
    call("/bootstrap", HttpMethod.POST, jsonHeaders(), Map.of("email", "owner@example.test", "password", "123456789012345"));
    ResponseEntity<String> anonymous = http.getForEntity(url("/session"), String.class);
    assertEquals(HttpStatus.UNAUTHORIZED, anonymous.getStatusCode());
    assertNotNull(anonymous.getHeaders().getFirst("X-Login-CSRF-Token"));
    assertTrue(cookie(anonymous, IdentitySessionService.LOGIN_CSRF_COOKIE).contains("="));
    HttpHeaders denied = jsonHeaders();
    denied.set(HttpHeaders.COOKIE, cookie(anonymous, IdentitySessionService.LOGIN_CSRF_COOKIE));
    assertEquals(HttpStatus.FORBIDDEN, call("/sign-in", HttpMethod.POST, denied,
        Map.of("email", "owner@example.test", "password", "123456789012345")).getStatusCode());

    ResponseEntity<String> fresh = http.getForEntity(url("/session"), String.class);
    HttpHeaders login = jsonHeaders();
    login.set(HttpHeaders.COOKIE, cookie(fresh, IdentitySessionService.LOGIN_CSRF_COOKIE));
    login.set("X-Login-CSRF-Token", fresh.getHeaders().getFirst("X-Login-CSRF-Token"));
    ResponseEntity<String> signedIn = call("/sign-in", HttpMethod.POST, login,
        Map.of("email", "owner@example.test", "password", "123456789012345"));
    assertEquals(HttpStatus.OK, signedIn.getStatusCode());
    assertTrue(cookie(signedIn, IdentitySessionResolver.STAFF_COOKIE).contains("="));
    assertTrue(signedIn.getHeaders().get(HttpHeaders.SET_COOKIE).stream().anyMatch(value -> value.contains("HttpOnly") && value.contains("Secure") && value.contains("SameSite=Strict")));
    assertFalse(signedIn.getBody().contains(cookie(signedIn, IdentitySessionResolver.STAFF_COOKIE).substring(IdentitySessionResolver.STAFF_COOKIE.length() + 1)));

    HttpHeaders authenticated = jsonHeaders();
    authenticated.set(HttpHeaders.COOKIE, cookie(signedIn, IdentitySessionResolver.STAFF_COOKIE) + "; " + cookie(signedIn, IdentitySessionService.CSRF_COOKIE));
    authenticated.set("X-CSRF-Token", signedIn.getHeaders().getFirst("X-CSRF-Token"));
    ResponseEntity<String> session = call("/session", HttpMethod.GET, authenticated, null);
    assertEquals(HttpStatus.OK, session.getStatusCode());
    assertTrue(object(session.getBody()).containsKey("authenticatedSession"));
    assertFalse(session.getBody().contains("password_hash"));

    assertEquals(HttpStatus.NO_CONTENT, call("/sign-out", HttpMethod.POST, authenticated, null).getStatusCode());
    assertEquals(HttpStatus.UNAUTHORIZED, call("/session", HttpMethod.GET, authenticated, null).getStatusCode());
  }

  @Test
  void failedSignInIsGenericAndBoundedlyThrottled() {
    call("/bootstrap", HttpMethod.POST, jsonHeaders(), Map.of("email", "owner@example.test", "password", "123456789012345"));
    for (int attempt = 0; attempt < 10; attempt++) {
      ResponseEntity<String> anonymous = http.getForEntity(url("/session"), String.class);
      HttpHeaders login = jsonHeaders();
      login.set(HttpHeaders.COOKIE, cookie(anonymous, IdentitySessionService.LOGIN_CSRF_COOKIE));
      login.set("X-Login-CSRF-Token", anonymous.getHeaders().getFirst("X-Login-CSRF-Token"));
      ResponseEntity<String> rejected = call("/sign-in", HttpMethod.POST, login,
          Map.of("email", "nobody@example.test", "password", "wrong-password-value"));
      assertEquals(HttpStatus.UNAUTHORIZED, rejected.getStatusCode());
      assertFalse(rejected.getBody().contains("nobody@example.test"));
    }
    assertEquals(10, db.queryForObject("select failure_count from sign_in_throttles", Integer.class));
    assertTrue(db.queryForObject("select blocked_until > now() + interval '14 minutes' from sign_in_throttles", Boolean.class));
    ResponseEntity<String> anonymous = http.getForEntity(url("/session"), String.class);
    HttpHeaders login = jsonHeaders();
    login.set(HttpHeaders.COOKIE, cookie(anonymous, IdentitySessionService.LOGIN_CSRF_COOKIE));
    login.set("X-Login-CSRF-Token", anonymous.getHeaders().getFirst("X-Login-CSRF-Token"));
    assertEquals(HttpStatus.TOO_MANY_REQUESTS, call("/sign-in", HttpMethod.POST, login,
        Map.of("email", "nobody@example.test", "password", "wrong-password-value")).getStatusCode());
  }
}
