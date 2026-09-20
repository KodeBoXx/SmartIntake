package com.kodeboxx.smartintake.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Arrays;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Browser trust configuration is deployment supplied; localhost defaults are development-only. */
@Configuration
public class BrowserSecurityConfiguration implements WebMvcConfigurer {
  private final String[] allowedOrigins;

  public BrowserSecurityConfiguration(@Value("${smartintake.security.allowed-origins:http://localhost:4200,http://127.0.0.1:4200}") String origins) {
    allowedOrigins = Arrays.stream(origins.split(",")).map(String::trim).filter(value -> !value.isEmpty()).toArray(String[]::new);
  }

  @Override
  public void addCorsMappings(CorsRegistry registry) {
    registry.addMapping("/v1/**").allowedOrigins(allowedOrigins).allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE")
        .allowedHeaders("Content-Type", "X-CSRF-Token", "X-Login-CSRF-Token", "X-Bootstrap-Token", "Idempotency-Key", "If-Match").allowCredentials(true);
  }

  @Configuration
  static class SecurityHeaders extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
        throws ServletException, IOException {
      response.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "same-origin");
      response.setHeader("X-Frame-Options", "DENY");
      chain.doFilter(request, response);
    }
  }
}
