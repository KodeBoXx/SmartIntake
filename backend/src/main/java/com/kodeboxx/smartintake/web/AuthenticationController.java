package com.kodeboxx.smartintake.web;

import com.kodeboxx.smartintake.security.IdentitySessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/auth")
public class AuthenticationController {
  private final IdentitySessionService identity;

  public AuthenticationController(IdentitySessionService identity) {
    this.identity = identity;
  }

  @PostMapping("/bootstrap")
  public ResponseEntity<?> bootstrap(@RequestBody IdentitySessionService.BootstrapRequest input,
      @RequestHeader(value = "X-Bootstrap-Token", required = false) String bootstrapToken, HttpServletRequest request) {
    return identity.bootstrap(input, bootstrapToken, request);
  }

  @GetMapping("/session")
  public ResponseEntity<?> session(HttpServletRequest request) {
    return identity.currentSession(request);
  }

  @PostMapping("/sign-in")
  public ResponseEntity<?> signIn(@RequestBody IdentitySessionService.Credentials input,
      @RequestHeader(value = "X-Login-CSRF-Token", required = false) String loginCsrf,
      HttpServletRequest request) {
    return identity.signIn(input, loginCsrf, request);
  }

  @PostMapping({"/sign-out", "/logout"})
  public ResponseEntity<?> signOut(HttpServletRequest request) {
    return identity.signOut(request);
  }
}
