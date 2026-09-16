package com.kodeboxx.smartintake.web;

import com.kodeboxx.smartintake.application.IntakeApplicationService;
import java.util.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/workspaces/{workspace}")
public class SubmissionController {
 private final IntakeApplicationService intake;
 public SubmissionController(IntakeApplicationService intake){this.intake=intake;}
 @GetMapping(value="/submissions",produces=MediaType.APPLICATION_JSON_VALUE) public List<Map<String,Object>> submissions(@PathVariable String workspace,@RequestHeader(value="X-Staff-Session",required=false) String token){return intake.submissions(workspace,token);}
 @GetMapping("/submissions/{id}") public Object submission(@PathVariable String workspace,@PathVariable UUID id,@RequestHeader(value="X-Staff-Session",required=false) String token){return intake.submission(workspace,id,token);}
 @GetMapping("/exports.json") public List<Map<String,Object>> jsonExport(@PathVariable String workspace,@RequestHeader(value="X-Staff-Session",required=false) String token){return intake.jsonExport(workspace,token);}
 @GetMapping(value="/exports.csv",produces="text/csv") public String csv(@PathVariable String workspace,@RequestHeader(value="X-Staff-Session",required=false) String token){return intake.csv(workspace,token);}
}
