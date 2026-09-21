package com.kodeboxx.smartintake.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Rejects oversized respondent and authoring mutation bodies before JSON decoding or canonical hashing. */
@Component
public final class RequestBodyLimitFilter extends OncePerRequestFilter {
  static final int MAX_MUTATION_BYTES = 1_048_576;

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    boolean mutation = ("PATCH".equals(request.getMethod())
        && request.getRequestURI().matches(".*/v1/sessions/[0-9a-fA-F-]+$"))
        || ("POST".equals(request.getMethod())
        && request.getRequestURI().matches(".*/v1/sessions/[0-9a-fA-F-]+/(validate|submissions)$"))
        || (request.getRequestURI().matches(".*/v1/workspaces/[^/]+/forms/[0-9a-fA-F-]+/authoring/[0-9a-fA-F-]+/.*")
        && ("POST".equals(request.getMethod()) || "PUT".equals(request.getMethod()) || "PATCH".equals(request.getMethod())));
    if (!mutation) {
      chain.doFilter(request, response);
      return;
    }
    if (request.getContentLengthLong() > MAX_MUTATION_BYTES) {
      reject(response);
      return;
    }
    byte[] body = request.getInputStream().readNBytes(MAX_MUTATION_BYTES + 1);
    if (body.length > MAX_MUTATION_BYTES) {
      reject(response);
      return;
    }
    chain.doFilter(new CachedRequest(request, body), response);
  }

  private static void reject(HttpServletResponse response) throws IOException {
    response.setStatus(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    response.getWriter().write("{\"code\":\"REQUEST_BODY_LIMIT\"}");
  }

  private static final class CachedRequest extends HttpServletRequestWrapper {
    private final byte[] body;

    private CachedRequest(HttpServletRequest request, byte[] body) {
      super(request);
      this.body = body;
    }

    @Override
    public ServletInputStream getInputStream() {
      ByteArrayInputStream input = new ByteArrayInputStream(body);
      return new ServletInputStream() {
        @Override public int read() { return input.read(); }
        @Override public boolean isFinished() { return input.available() == 0; }
        @Override public boolean isReady() { return true; }
        @Override public void setReadListener(ReadListener listener) {
          throw new UnsupportedOperationException("Synchronous request body");
        }
      };
    }
  }
}
