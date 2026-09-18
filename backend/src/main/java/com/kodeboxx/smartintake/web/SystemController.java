package com.kodeboxx.smartintake.web;

import com.kodeboxx.smartintake.application.IntakeApplicationService;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1")
public class SystemController {
 private final IntakeApplicationService intake;
 public SystemController(IntakeApplicationService intake){this.intake=intake;}
 @GetMapping("/health") public Map<String,Object> health(){return intake.health();}
 @GetMapping("/capabilities") public Map<String,Object> capabilities(){return intake.capabilities();}
}
