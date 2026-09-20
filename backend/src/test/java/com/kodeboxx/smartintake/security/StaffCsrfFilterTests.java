package com.kodeboxx.smartintake.security;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseCookie;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class StaffCsrfFilterTests {
  @Test
  void authenticatedSignOutIsCheckedOnceByTheFilter() throws Exception {
    IdentitySessionService identity = mock(IdentitySessionService.class);
    ExposedFilter filter = new ExposedFilter(new IdentitySessionResolver(new MockEnvironment()), identity);
    MockHttpServletRequest request = authenticatedRequest("/v1/auth/sign-out");
    MockHttpServletResponse response = new MockHttpServletResponse();
    when(identity.validCsrf("opaque-session", "csrf-value")).thenReturn(true);
    when(identity.renewStaffCookie("opaque-session")).thenReturn(ResponseCookie.from("SI_STAFF_SESSION", "opaque-session").build());

    assertFalse(filter.skip(request));
    filter.doFilter(request, response, (ignoredRequest, ignoredResponse) -> {});

    verify(identity, times(1)).requireOrigin(request);
    verify(identity, times(1)).validCsrf("opaque-session", "csrf-value");
  }

  @Test
  void authenticatedSignInIsNotExemptButAnonymousBootstrapIs() {
    ExposedFilter filter = new ExposedFilter(new IdentitySessionResolver(new MockEnvironment()), mock(IdentitySessionService.class));
    MockHttpServletRequest anonymous = new MockHttpServletRequest("POST", "/v1/auth/sign-in");
    MockHttpServletRequest authenticated = authenticatedRequest("/v1/auth/sign-in");

    assertTrue(filter.skip(anonymous));
    assertFalse(filter.skip(authenticated));
  }

  @Test
  void authenticatedSignOutWithMissingCsrfIsDeniedBeforeRevocation() throws Exception {
    IdentitySessionService identity = mock(IdentitySessionService.class);
    ExposedFilter filter = new ExposedFilter(new IdentitySessionResolver(new MockEnvironment()), identity);
    MockHttpServletRequest request = authenticatedRequest("/v1/auth/sign-out");
    request.removeHeader("X-CSRF-Token");
    MockHttpServletResponse response = new MockHttpServletResponse();
    boolean[] invoked = {false};

    filter.doFilter(request, response, (ignoredRequest, ignoredResponse) -> invoked[0] = true);

    assertFalse(invoked[0]);
    assertEquals(403, response.getStatus());
    verify(identity).requireOrigin(request);
    verify(identity, never()).validCsrf(anyString(), anyString());
  }

  private static MockHttpServletRequest authenticatedRequest(String path) {
    MockHttpServletRequest request = new MockHttpServletRequest("POST", path);
    request.setCookies(new Cookie(IdentitySessionResolver.STAFF_COOKIE, "opaque-session"),
        new Cookie(IdentitySessionService.CSRF_COOKIE, "csrf-value"));
    request.addHeader("X-CSRF-Token", "csrf-value");
    return request;
  }

  private static final class ExposedFilter extends StaffCsrfFilter {
    ExposedFilter(IdentitySessionResolver sessions, IdentitySessionService identity) { super(sessions, identity); }
    boolean skip(MockHttpServletRequest request) { return shouldNotFilter(request); }
  }
}
