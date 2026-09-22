package com.kodeboxx.smartintake.web;

import com.kodeboxx.smartintake.publication.GovernedPublicationService;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Additive M8 endpoints.  The established /releases endpoint remains compatible. */
@RestController
@RequestMapping("/v1/workspaces/{workspace}/forms/{form}")
public class GovernedPublicationController {
  private final GovernedPublicationService publications;
  public GovernedPublicationController(GovernedPublicationService publications) { this.publications = publications; }

  @PostMapping("/review-requests")
  public Map<String, Object> request(@PathVariable String workspace, @PathVariable UUID form,
      @RequestHeader(value = "X-Staff-Session", required = false) String token) {
    return publications.requestReview(workspace, form, token);
  }
  @PostMapping("/review-requests/{request}/approvals")
  public Map<String, Object> approve(@PathVariable String workspace, @PathVariable UUID form,
      @PathVariable UUID request, @RequestHeader(value = "X-Staff-Session", required = false) String token) {
    return publications.approve(workspace, form, request, token);
  }
  @PostMapping("/governed-releases")
  public ResponseEntity<?> publish(@PathVariable String workspace, @PathVariable UUID form,
      @RequestParam UUID reviewRequestId, @RequestHeader(value = "X-Staff-Session", required = false) String token) {
    return publications.publish(workspace, form, reviewRequestId, token);
  }
  @PostMapping("/releases/{release}/{action:activate|rollback|retire|emergency-close}")
  public Map<String, Object> transition(@PathVariable String workspace, @PathVariable UUID form,
      @PathVariable UUID release, @PathVariable String action,
      @RequestHeader(value = "X-Staff-Session", required = false) String token) {
    return publications.transition(workspace, form, release, action, token);
  }
  @PostMapping("/share-channels")
  public Map<String, Object> channel(@PathVariable String workspace, @PathVariable UUID form,
      @RequestParam UUID releaseId, @RequestBody Map<String, Object> request,
      @RequestHeader(value = "X-Staff-Session", required = false) String token) {
    return publications.createChannel(workspace, form, releaseId, request, token);
  }
}
