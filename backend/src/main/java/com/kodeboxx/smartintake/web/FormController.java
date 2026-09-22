package com.kodeboxx.smartintake.web;

import com.kodeboxx.smartintake.application.IntakeApplicationService;
import com.kodeboxx.smartintake.publication.GovernedPublicationService;
import java.util.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/workspaces/{workspace}/forms")
public class FormController {
 private final IntakeApplicationService intake;
 private final GovernedPublicationService governed;
 public FormController(IntakeApplicationService intake, GovernedPublicationService governed){this.intake=intake;this.governed=governed;}
 @GetMapping public List<Map<String,Object>> forms(@PathVariable String workspace,@RequestHeader(value="X-Staff-Session",required=false) String token){return intake.forms(workspace,token);}
 @PostMapping public ResponseEntity<?> create(@PathVariable String workspace,@RequestHeader(value="X-Staff-Session",required=false) String token,@RequestBody IntakeApplicationService.CreateForm in){return intake.create(workspace,token,in);}
 @GetMapping("/{form}/drafts/{draft}") public ResponseEntity<?> draft(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token){return intake.draft(workspace,form,draft,token);}
 @PutMapping("/{form}/drafts/{draft}") public ResponseEntity<?> save(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token,@RequestHeader(value="If-Match",required=false) String match,@RequestBody IntakeApplicationService.Draft in){return intake.save(workspace,form,draft,token,match,in);}
 @GetMapping("/{form}/definition-export") public Map<String,Object> definitionExport(@PathVariable String workspace,@PathVariable UUID form,@RequestHeader(value="X-Staff-Session",required=false) String token){return intake.definitionExport(workspace,form,token);}
 @PutMapping("/{form}/definition-import") public ResponseEntity<?> definitionImport(@PathVariable String workspace,@PathVariable UUID form,@RequestHeader(value="X-Staff-Session",required=false) String token,@RequestHeader(value="If-Match",required=false) String match,@RequestBody Map<String,Object> candidate){return intake.definitionImport(workspace,form,token,match,candidate);}
 @PostMapping("/{form}/releases") public ResponseEntity<?> publish(@PathVariable String workspace,@PathVariable UUID form,@RequestParam(required=false) UUID reviewRequestId,@RequestHeader(value="X-Staff-Session",required=false) String token){return governed.publish(workspace,form,reviewRequestId,token);}
}
