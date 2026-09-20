package com.kodeboxx.smartintake.web;

import static org.junit.jupiter.api.Assertions.*;

import jakarta.servlet.FilterChain;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class RequestBodyLimitFilterTests {
  @Test
  void rejectsOversizedMutationBeforeControllerDispatch() throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest(
        "PATCH", "/v1/sessions/00000000-0000-0000-0000-000000000001");
    request.setContent(new byte[RequestBodyLimitFilter.MAX_MUTATION_BYTES + 1]);
    MockHttpServletResponse response = new MockHttpServletResponse();
    AtomicBoolean called = new AtomicBoolean();
    FilterChain chain = (incoming, outgoing) -> called.set(true);

    new RequestBodyLimitFilter().doFilter(request, response, chain);

    assertEquals(413, response.getStatus());
    assertFalse(called.get());
    assertEquals("{\"code\":\"REQUEST_BODY_LIMIT\"}", response.getContentAsString());
  }
}
