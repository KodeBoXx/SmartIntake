package com.kodeboxx.smartintake.web;

import com.kodeboxx.smartintake.application.IntakeApplicationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/auth")
public class AuthenticationController {
 private final IntakeApplicationService intake;
 public AuthenticationController(IntakeApplicationService intake){this.intake=intake;}
 @PostMapping("/bootstrap") public ResponseEntity<?> bootstrap(@RequestBody IntakeApplicationService.Bootstrap in){return intake.bootstrap(in);}
 @PostMapping("/sign-in") public ResponseEntity<?> signIn(@RequestBody IntakeApplicationService.Bootstrap in){return intake.signIn(in);}
 @PostMapping("/logout") public ResponseEntity<?> logout(@RequestHeader(value="X-Staff-Session",required=false) String token){return intake.logout(token);}
}
