package com.kodeboxx.smartintake.web;

import com.kodeboxx.smartintake.authoring.AuthoringApplicationService;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/workspaces/{workspace}/reusable-components")
public class ReusableComponentController {
  private final AuthoringApplicationService authoring;
  public ReusableComponentController(AuthoringApplicationService authoring) { this.authoring = authoring; }
  @GetMapping public List<Map<String,Object>> list(@PathVariable String workspace,@RequestHeader(value="X-Staff-Session",required=false) String token) { return authoring.components(workspace,token); }
  @PostMapping public ResponseEntity<?> create(@PathVariable String workspace,@RequestHeader(value="X-Staff-Session",required=false) String token,@RequestBody Map<String,Object> body) { return authoring.component(workspace,token,body); }
}
