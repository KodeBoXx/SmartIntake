package com.kodeboxx.smartintake.security;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Arrays;
import java.util.Optional;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/** Resolves the opaque staff session without permitting a request header in non-test deployments. */
@Component
public class IdentitySessionResolver {
  public static final String STAFF_COOKIE = "SI_STAFF_SESSION";
  private final Environment environment;

  public IdentitySessionResolver(Environment environment) {
    this.environment = environment;
  }

  public Optional<String> session(HttpServletRequest request, String developmentHeader) {
    if (environment.matchesProfiles("test") && developmentHeader != null && !developmentHeader.isBlank()) {
      return Optional.of(developmentHeader);
    }
    return cookieSession(request);
  }

  public Optional<String> cookieSession(HttpServletRequest request) {
    return Arrays.stream(Optional.ofNullable(request.getCookies()).orElseGet(() -> new Cookie[0]))
        .filter(cookie -> STAFF_COOKIE.equals(cookie.getName()))
        .map(Cookie::getValue)
        .filter(value -> value != null && !value.isBlank())
        .findFirst();
  }

  public boolean isTestProfile() {
    return environment.matchesProfiles("test");
  }
}
