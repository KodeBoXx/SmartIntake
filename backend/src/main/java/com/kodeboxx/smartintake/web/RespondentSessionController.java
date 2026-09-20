package com.kodeboxx.smartintake.web;

import com.kodeboxx.smartintake.application.IntakeApplicationService;
import java.util.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1")
public class RespondentSessionController {
 private final IntakeApplicationService intake;
 public RespondentSessionController(IntakeApplicationService intake){this.intake=intake;}
 @PostMapping("/public/forms/{share}/sessions") public ResponseEntity<?> start(@PathVariable UUID share,@RequestBody(required=false) IntakeApplicationService.StartSession in){return intake.start(share,in);}
 @GetMapping("/sessions/{id}") public Map<String,Object> session(@PathVariable UUID id,@RequestHeader(value="X-Respondent-Session",required=false) String token){return intake.session(id,token);}
 @PatchMapping("/sessions/{id}") public Map<String,Object> patch(@PathVariable UUID id,@RequestHeader(value="X-Respondent-Session",required=false) String token,@RequestBody IntakeApplicationService.PatchSession in){return intake.patch(id,token,in);}
 @PostMapping("/sessions/{id}/validate") public Map<String,Object> validate(@PathVariable UUID id,@RequestHeader(value="X-Respondent-Session",required=false) String token){return intake.validate(id,token);}
 @PostMapping("/sessions/{id}/submissions") public ResponseEntity<?> submit(@PathVariable UUID id,@RequestHeader(value="X-Respondent-Session",required=false) String token,@RequestBody IntakeApplicationService.Submit in){try{return intake.submit(id,token,in);}catch(RuntimeException failure){intake.submissionFailed(id,in.attemptId(),failure instanceof org.springframework.web.server.ResponseStatusException status&&status.getReason()!=null?status.getReason():"SUBMISSION_FAILED");throw failure;}}
 @GetMapping("/sessions/{id}/submission-operation") public Map<String,Object> submissionOperation(@PathVariable UUID id,@RequestHeader(value="X-Respondent-Session",required=false) String token,@RequestParam String attemptId){return intake.submissionOperation(id,token,attemptId);}
}
