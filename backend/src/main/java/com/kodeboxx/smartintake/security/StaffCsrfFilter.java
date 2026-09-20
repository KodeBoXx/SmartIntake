package com.kodeboxx.smartintake.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Enforces double-submit CSRF and Origin checks for every cookie-authenticated staff mutation. */
@Component
public class StaffCsrfFilter extends OncePerRequestFilter {
  private final IdentitySessionResolver sessions;
  private final IdentitySessionService identity;

  public StaffCsrfFilter(IdentitySessionResolver sessions, IdentitySessionService identity) {
    this.sessions = sessions;
    this.identity = identity;
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    String path = request.getRequestURI();
    if (!path.startsWith("/v1/") || "GET".equals(request.getMethod()) || "HEAD".equals(request.getMethod())
        || "OPTIONS".equals(request.getMethod())) return true;
    boolean anonymousBootstrap = path.equals("/v1/auth/bootstrap") || path.equals("/v1/auth/sign-in");
    return anonymousBootstrap && sessions.cookieSession(request).isEmpty();
  }

  private static boolean setupOnlyPath(String path) {
    return path.equals("/v1/auth/password-change") || path.equals("/v1/auth/activate")
        || path.equals("/v1/auth/sign-out") || path.equals("/v1/auth/logout");
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String token = sessions.cookieSession(request).orElse(null);
    if (token != null) {
      if (identity.setupOnly(token) && !setupOnlyPath(request.getRequestURI())) {
        response.sendError(HttpServletResponse.SC_FORBIDDEN, "Setup session restricted");
        return;
      }
      try {
        identity.requireOrigin(request);
      } catch (RuntimeException denied) {
        response.sendError(HttpServletResponse.SC_FORBIDDEN, "Origin denied");
        return;
      }
      String csrf = request.getHeader("X-CSRF-Token");
      String csrfCookie = java.util.Arrays.stream(java.util.Optional.ofNullable(request.getCookies()).orElse(new jakarta.servlet.http.Cookie[0]))
          .filter(cookie -> IdentitySessionService.CSRF_COOKIE.equals(cookie.getName()))
          .map(jakarta.servlet.http.Cookie::getValue).findFirst().orElse(null);
      if (csrfCookie == null || !java.security.MessageDigest.isEqual(csrfCookie.getBytes(java.nio.charset.StandardCharsets.UTF_8),
          (csrf == null ? "" : csrf).getBytes(java.nio.charset.StandardCharsets.UTF_8)) || !identity.validCsrf(token, csrf)) {
        response.sendError(HttpServletResponse.SC_FORBIDDEN, "CSRF denied");
        return;
      }
    }
    chain.doFilter(request, response);
    if (token != null) response.addHeader(HttpHeaders.SET_COOKIE, identity.renewStaffCookie(token).toString());
  }
}
