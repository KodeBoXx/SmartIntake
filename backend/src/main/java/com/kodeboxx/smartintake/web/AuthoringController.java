package com.kodeboxx.smartintake.web;

import com.kodeboxx.smartintake.authoring.AuthoringApplicationService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** M7 staff-only canonical authoring routes. */
@RestController
@RequestMapping("/v1/workspaces/{workspace}/forms/{form}/authoring/{draft}")
public class AuthoringController {
  private final AuthoringApplicationService authoring;
  public AuthoringController(AuthoringApplicationService authoring) { this.authoring = authoring; }
  private String token(String token) { return token; }

  @GetMapping public ResponseEntity<?> document(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token) { return authoring.document(workspace,form,draft,token(token)); }
  @PostMapping("/commands") public ResponseEntity<?> commands(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token,@RequestHeader(value="If-Match",required=false) String match,@RequestHeader(value="Idempotency-Key",required=false) String idempotencyKey,@RequestBody Map<String,Object> body) { return authoring.commands(workspace,form,draft,token(token),match,idempotencyKey,body); }
  @GetMapping("/history") public List<Map<String,Object>> history(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token) { return authoring.history(workspace,form,draft,token(token)); }
  @PostMapping("/undo") public ResponseEntity<?> undo(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token,@RequestHeader(value="If-Match",required=false) String match) { return authoring.undo(workspace,form,draft,token(token),match); }
  @PostMapping("/redo") public ResponseEntity<?> redo(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token,@RequestHeader(value="If-Match",required=false) String match) { return authoring.redo(workspace,form,draft,token(token),match); }
  @PostMapping("/resolve") public ResponseEntity<?> resolve(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token,@RequestHeader(value="If-Match",required=false) String match,@RequestBody Map<String,Object> body) { return authoring.resolve(workspace,form,draft,token(token),match,body); }
  @PostMapping("/imports/validate") public Map<String,Object> validateImport(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token,@RequestBody Map<String,Object> body) { return authoring.validateImport(workspace,form,draft,token(token),body); }
  @PostMapping("/imports/commit") public ResponseEntity<?> commitImport(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token,@RequestHeader(value="If-Match",required=false) String match,@RequestHeader(value="Idempotency-Key",required=false) String idempotencyKey,@RequestBody Map<String,Object> body) { return authoring.commitImport(workspace,form,draft,token(token),match,idempotencyKey,body); }
  @PostMapping("/components/{componentKey}/insert") public ResponseEntity<?> insertComponent(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@PathVariable String componentKey,@RequestHeader(value="X-Staff-Session",required=false) String token,@RequestHeader(value="If-Match",required=false) String match,@RequestHeader(value="Idempotency-Key",required=false) String idempotencyKey,@RequestBody Map<String,Object> body) { return authoring.insertComponent(workspace,form,draft,token(token),match,idempotencyKey,componentKey,body); }
  @GetMapping("/theme") public ResponseEntity<?> theme(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token) { return authoring.theme(workspace,form,draft,token(token)); }
  @PutMapping("/theme") public ResponseEntity<?> theme(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token,@RequestHeader(value="If-Match",required=false) String match,@RequestBody Map<String,Object> body) { return authoring.updateTheme(workspace,form,draft,token(token),match,body); }
  @GetMapping("/content") public ResponseEntity<?> content(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token) { return authoring.content(workspace,form,draft,token(token)); }
  @PutMapping("/content") public ResponseEntity<?> content(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token,@RequestHeader(value="If-Match",required=false) String match,@RequestBody Map<String,Object> body) { return authoring.updateContent(workspace,form,draft,token(token),match,body); }
  @GetMapping("/comments") public List<Map<String,Object>> comments(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token) { return authoring.comments(workspace,form,draft,token(token)); }
  @PostMapping("/comments") public Map<String,Object> comment(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token,@RequestBody Map<String,Object> body) { return authoring.comment(workspace,form,draft,token(token),body); }
  @GetMapping("/presence") public List<Map<String,Object>> presence(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token) { return authoring.presence(workspace,form,draft,token(token)); }
  @PatchMapping("/presence") public ResponseEntity<?> presence(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token,@RequestBody Map<String,Object> body) { return authoring.presence(workspace,form,draft,token(token),body); }
  @PostMapping("/preview") public Map<String,Object> preview(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token,@RequestBody(required=false) Map<String,Object> body) { return authoring.preview(workspace,form,draft,token(token),body == null ? Map.of() : body); }
  @PostMapping("/speech") public Map<String,Object> speech(@PathVariable String workspace,@PathVariable UUID form,@PathVariable String draft,@RequestHeader(value="X-Staff-Session",required=false) String token,@RequestBody Map<String,Object> body) { return authoring.speech(workspace,form,draft,token(token),body); }
}
