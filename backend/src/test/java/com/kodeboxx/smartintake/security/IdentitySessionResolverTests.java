package com.kodeboxx.smartintake.security;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;

class IdentitySessionResolverTests {
  @Test
  void developmentHeaderIsIgnoredOutsideTestProfile() {
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("X-Staff-Session", "header-only-session");
    assertTrue(new IdentitySessionResolver(new MockEnvironment()).session(request, "header-only-session").isEmpty());
  }

  @Test
  void developmentHeaderIsAvailableOnlyToTestProfile() {
    MockHttpServletRequest request = new MockHttpServletRequest();
    MockEnvironment environment = new MockEnvironment();
    environment.setActiveProfiles("test");
    assertEquals("header-only-session", new IdentitySessionResolver(environment)
        .session(request, "header-only-session").orElseThrow());
  }
}
