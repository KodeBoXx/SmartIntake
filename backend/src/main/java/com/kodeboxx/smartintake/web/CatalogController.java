package com.kodeboxx.smartintake.web;

import com.kodeboxx.smartintake.catalog.CatalogApplicationService;
import com.kodeboxx.smartintake.catalog.CatalogRepository;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Additive M6 catalog routes; the legacy /forms collection remains unchanged. */
@RestController
@RequestMapping("/v1/workspaces/{workspace}")
public class CatalogController {
  private final CatalogApplicationService catalog;
  public CatalogController(CatalogApplicationService catalog) { this.catalog = catalog; }

  @GetMapping("/catalog/forms")
  public Map<String, Object> forms(@PathVariable String workspace,
      @RequestHeader(value = "X-Staff-Session", required = false) String token, HttpServletRequest request,
      @RequestParam(required = false) String q, @RequestParam(required = false) String status,
      @RequestParam(required = false) String owner, @RequestParam(required = false) String folder,
      @RequestParam(required = false) List<String> tag, @RequestParam(required = false) Boolean archived,
      @RequestParam(required = false, defaultValue = "50") int limit, @RequestParam(required = false) String cursor) {
    if (limit < 1 || limit > 100) throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST, "CATALOG_LIMIT_INVALID");
    return catalog.search(workspace, token, request, new CatalogRepository.Search(q, status, owner, folder, tag, archived, limit, cursor));
  }

  @GetMapping("/folders") public List<Map<String, Object>> folders(@PathVariable String workspace, @RequestHeader(value="X-Staff-Session",required=false) String token, HttpServletRequest request) { return catalog.folders(workspace, token, request); }
  @PostMapping("/folders") public ResponseEntity<?> createFolder(@PathVariable String workspace, @RequestHeader(value="X-Staff-Session",required=false) String token, HttpServletRequest request, @RequestBody CatalogApplicationService.Named input) { return ResponseEntity.status(201).body(catalog.createFolder(workspace, token, request, input)); }
  @PatchMapping("/folders/{folder}") public Map<String,Object> updateFolder(@PathVariable String workspace,@PathVariable UUID folder,@RequestHeader(value="X-Staff-Session",required=false) String token,HttpServletRequest request,@RequestBody CatalogApplicationService.Named input){return catalog.updateFolder(workspace,token,request,folder,input);}
  @DeleteMapping("/folders/{folder}") public ResponseEntity<Void> deleteFolder(@PathVariable String workspace,@PathVariable UUID folder,@RequestHeader(value="X-Staff-Session",required=false) String token,HttpServletRequest request){catalog.deleteFolder(workspace,token,request,folder);return ResponseEntity.noContent().build();}

  @GetMapping("/tags") public List<Map<String,Object>> tags(@PathVariable String workspace,@RequestHeader(value="X-Staff-Session",required=false) String token,HttpServletRequest request){return catalog.tags(workspace,token,request);}
  @PostMapping("/tags") public ResponseEntity<?> createTag(@PathVariable String workspace,@RequestHeader(value="X-Staff-Session",required=false) String token,HttpServletRequest request,@RequestBody CatalogApplicationService.TagInput input){return ResponseEntity.status(201).body(catalog.createTag(workspace,token,request,input));}
  @PatchMapping("/tags/{tag}") public Map<String,Object> updateTag(@PathVariable String workspace,@PathVariable UUID tag,@RequestHeader(value="X-Staff-Session",required=false) String token,HttpServletRequest request,@RequestBody CatalogApplicationService.TagInput input){return catalog.updateTag(workspace,token,request,tag,input);}
  @DeleteMapping("/tags/{tag}") public ResponseEntity<Void> deleteTag(@PathVariable String workspace,@PathVariable UUID tag,@RequestHeader(value="X-Staff-Session",required=false) String token,HttpServletRequest request){catalog.deleteTag(workspace,token,request,tag);return ResponseEntity.noContent().build();}

  @PostMapping("/catalog/forms/{form}/duplicate") public ResponseEntity<?> duplicate(@PathVariable String workspace,@PathVariable UUID form,@RequestHeader(value="X-Staff-Session",required=false) String token,HttpServletRequest request){return ResponseEntity.status(201).body(catalog.duplicate(workspace,token,request,form));}
  @PostMapping("/catalog/forms/{form}/archive") public Map<String,Object> archive(@PathVariable String workspace,@PathVariable UUID form,@RequestHeader(value="X-Staff-Session",required=false) String token,HttpServletRequest request){return catalog.archive(workspace,token,request,form);}
  @PostMapping("/catalog/forms/{form}/restore") public Map<String,Object> restore(@PathVariable String workspace,@PathVariable UUID form,@RequestHeader(value="X-Staff-Session",required=false) String token,HttpServletRequest request){return catalog.restore(workspace,token,request,form);}
  @PutMapping("/catalog/forms/{form}/ownership") public Map<String,Object> transfer(@PathVariable String workspace,@PathVariable UUID form,@RequestHeader(value="X-Staff-Session",required=false) String token,HttpServletRequest request,@RequestBody CatalogApplicationService.Transfer input){return catalog.transfer(workspace,token,request,form,input);}
  @PutMapping("/catalog/forms/{form}/classification") public ResponseEntity<Void> classify(@PathVariable String workspace,@PathVariable UUID form,@RequestHeader(value="X-Staff-Session",required=false) String token,HttpServletRequest request,@RequestBody CatalogApplicationService.FormClassification input){catalog.classify(workspace,token,request,form,input);return ResponseEntity.noContent().build();}

  @GetMapping("/catalog/settings") public Map<String,Object> settings(@PathVariable String workspace,@RequestHeader(value="X-Staff-Session",required=false) String token,HttpServletRequest request){return catalog.settings(workspace,token,request);}
  @PutMapping("/catalog/settings") public Map<String,Object> updateSettings(@PathVariable String workspace,@RequestHeader(value="X-Staff-Session",required=false) String token,HttpServletRequest request,@RequestBody CatalogApplicationService.Settings input){return catalog.updateSettings(workspace,token,request,input);}
}
