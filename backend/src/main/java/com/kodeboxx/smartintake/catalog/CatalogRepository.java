package com.kodeboxx.smartintake.catalog;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

/** Database-only catalog reads and writes. All callers must provide an authorized workspace. */
@Repository
public class CatalogRepository {
  private final JdbcTemplate db;
  private final ObjectMapper json;

  public CatalogRepository(JdbcTemplate db, ObjectMapper json) {
    this.db = db;
    this.json = json;
  }

  public record Search(String query, String status, String owner, String folder, List<String> tags,
                       Boolean archived, int limit, String cursor) {}
  public record Page(List<Map<String, Object>> items, String nextCursor, long catalogRevision) {}

  public Page search(UUID workspaceId, Search search) {
    String fingerprint = fingerprint(workspaceId, search);
    long catalogRevision = revision(workspaceId);
    Cursor cursor = cursor(search.cursor(), fingerprint, catalogRevision);
    Instant snapshot = cursor == null ? Instant.now() : cursor.snapshot();
    StringBuilder sql = new StringBuilder("""
        select f.id, f.form_key, f.title, f.status, f.revision, f.updated_at,
               m.folder_id, m.owner_account_id, m.archived_at,
               coalesce(a.email, '') as owner_email
          from forms f
          left join form_catalog_metadata m on m.form_id=f.id
          left join accounts a on a.id=m.owner_account_id
         where f.workspace_id=? and f.updated_at <= ?
        """);
    List<Object> args = new ArrayList<>(List.of(workspaceId, java.sql.Timestamp.from(snapshot)));
    if (search.query() != null && !search.query().isBlank()) {
      sql.append(" and (lower(f.title) like ? or lower(f.form_key) like ?)");
      String term = "%" + search.query().trim().toLowerCase() + "%";
      args.add(term); args.add(term);
    }
    boolean archivedStatus = "ARCHIVED".equalsIgnoreCase(nullSafe(search.status()).trim());
    if (search.status() != null && !search.status().isBlank() && !archivedStatus) {
      sql.append(" and f.status=?"); args.add(search.status().trim().toUpperCase());
    }
    if (search.owner() != null && !search.owner().isBlank()) {
      sql.append(" and m.owner_account_id=?::uuid"); args.add(uuid(search.owner(), "owner"));
    }
    if (search.folder() != null && !search.folder().isBlank()) {
      sql.append(" and m.folder_id=?::uuid"); args.add(uuid(search.folder(), "folder"));
    }
    boolean archived = Boolean.TRUE.equals(search.archived()) || archivedStatus;
    sql.append(archived ? " and m.archived_at is not null" : " and m.archived_at is null");
    for (String tag : normalizedTags(search.tags())) {
      sql.append(" and exists (select 1 from form_catalog_tags ft join catalog_tags ct on ct.id=ft.tag_id"
          + " where ft.form_id=f.id and ct.workspace_id=? and (ct.id::text=? or lower(ct.name)=?))");
      args.add(workspaceId); args.add(tag); args.add(tag.toLowerCase());
    }
    if (cursor != null) {
      sql.append(" and (f.updated_at < ? or (f.updated_at = ? and f.id < ?::uuid))");
      args.add(java.sql.Timestamp.from(cursor.updatedAt()));
      args.add(java.sql.Timestamp.from(cursor.updatedAt()));
      args.add(cursor.id());
    }
    sql.append(" order by f.updated_at desc, f.id desc limit ?");
    args.add(search.limit() + 1);
    List<Map<String, Object>> rows = db.query(sql.toString(), (rs, ignored) -> {
      Map<String, Object> row = new LinkedHashMap<>();
      UUID id = rs.getObject("id", UUID.class);
      row.put("id", id.toString());
      row.put("formKey", rs.getString("form_key"));
      row.put("title", rs.getString("title"));
      row.put("status", rs.getTimestamp("archived_at") == null ? rs.getString("status") : "ARCHIVED");
      row.put("revision", rs.getLong("revision"));
      row.put("updatedAt", rs.getTimestamp("updated_at").toInstant().toString());
      UUID folderId = rs.getObject("folder_id", UUID.class);
      row.put("folderId", folderId == null ? null : folderId.toString());
      UUID ownerId = rs.getObject("owner_account_id", UUID.class);
      row.put("owner", ownerId == null ? null : Map.of("id", opaque("account", ownerId), "email", rs.getString("owner_email")));
      row.put("tags", formTags(id));
      return row;
    }, args.toArray());
    boolean hasNext = rows.size() > search.limit();
    if (hasNext) rows.remove(rows.size() - 1);
    String next = null;
    if (hasNext && !rows.isEmpty()) {
      Map<String, Object> last = rows.get(rows.size() - 1);
      next = encode(new Cursor(snapshot, Instant.parse((String) last.get("updatedAt")),
          UUID.fromString((String) last.get("id")), fingerprint, catalogRevision));
    }
    return new Page(List.copyOf(rows), next, catalogRevision);
  }

  public List<Map<String, Object>> folders(UUID workspaceId) {
    return db.query("select id,name,created_at,updated_at from catalog_folders where workspace_id=? order by lower(name), id",
        (rs, ignored) -> entity(rs.getObject("id", UUID.class), rs.getString("name"), null,
            rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant()), workspaceId);
  }

  public Map<String, Object> createFolder(UUID workspaceId, String name) {
    UUID id = UUID.randomUUID(); String valid = name(name, 160, "folder name");
    db.update("insert into catalog_folders(id,workspace_id,name) values(?,?,?)", id, workspaceId, valid);
    return folder(id);
  }
  public Map<String, Object> updateFolder(UUID workspaceId, UUID id, String name) {
    int changed = db.update("update catalog_folders set name=?, updated_at=now() where id=? and workspace_id=?",
        name(name, 160, "folder name"), id, workspaceId);
    if (changed != 1) throw notFound(); return folder(id);
  }
  public void deleteFolder(UUID workspaceId, UUID id) {
    if (db.update("delete from catalog_folders where id=? and workspace_id=?", id, workspaceId) != 1) throw notFound();
  }

  public List<Map<String, Object>> tags(UUID workspaceId) {
    return db.query("select id,name,color,created_at,updated_at from catalog_tags where workspace_id=? order by lower(name), id",
        (rs, ignored) -> tagEntity(rs.getObject("id", UUID.class), rs.getString("name"), rs.getString("color"),
            rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant()), workspaceId);
  }
  public Map<String, Object> createTag(UUID workspaceId, String name, String color) {
    UUID id = UUID.randomUUID();
    db.update("insert into catalog_tags(id,workspace_id,name,color) values(?,?,?,?)", id, workspaceId,
        name(name, 80, "tag name"), color(color));
    return tag(id);
  }
  public Map<String, Object> updateTag(UUID workspaceId, UUID id, String name, String color) {
    if (db.update("update catalog_tags set name=?, color=?, updated_at=now() where id=? and workspace_id=?",
        name(name, 80, "tag name"), color(color), id, workspaceId) != 1) throw notFound();
    return tag(id);
  }
  public void deleteTag(UUID workspaceId, UUID id) {
    if (db.update("delete from catalog_tags where id=? and workspace_id=?", id, workspaceId) != 1) throw notFound();
  }

  public Map<String, Object> duplicate(UUID workspaceId, UUID sourceId, UUID ownerId) {
    Map<String, Object> source = db.queryForMap("select form_key,title,definition::text,compatibility_profile_key from forms where id=? and workspace_id=?", sourceId, workspaceId);
    UUID copyId = UUID.randomUUID(); String key = duplicateKey(workspaceId, (String) source.get("form_key"));
    db.update("insert into forms(id,workspace_id,form_key,title,status,revision,definition,compatibility_profile_key) values(?,?,?,?, 'DRAFT',1,cast(? as jsonb),?)",
        copyId, workspaceId, key, source.get("title") + " (copy)", source.get("definition"), source.get("compatibility_profile_key"));
    db.update("insert into form_catalog_metadata(form_id,folder_id,owner_account_id) select ?,folder_id,? from form_catalog_metadata where form_id=? on conflict(form_id) do nothing",
        copyId, ownerId, sourceId);
    db.update("insert into form_catalog_metadata(form_id,owner_account_id) values(?,?) on conflict(form_id) do nothing", copyId, ownerId);
    db.update("insert into form_catalog_tags(form_id,tag_id) select ?,tag_id from form_catalog_tags where form_id=?", copyId, sourceId);
    return form(copyId);
  }

  public Map<String, Object> archive(UUID workspaceId, UUID formId, UUID actor) { return archive(workspaceId, formId, actor, true); }
  public Map<String, Object> restore(UUID workspaceId, UUID formId) { return archive(workspaceId, formId, null, false); }
  private Map<String, Object> archive(UUID workspaceId, UUID formId, UUID actor, boolean archive) {
    requireForm(workspaceId, formId);
    ensureMetadata(formId, actor);
    db.update("update form_catalog_metadata set archived_at=" + (archive ? "now()" : "null")
        + ", archived_by=" + (archive ? "?" : "null") + ", updated_at=now() where form_id=?", archive ? new Object[]{actor, formId} : new Object[]{formId});
    return form(formId);
  }
  public Map<String, Object> transfer(UUID workspaceId, UUID formId, UUID accountId) {
    requireForm(workspaceId, formId);
    if (db.queryForObject("select count(*) from memberships where workspace_id=? and account_id=?", Integer.class, workspaceId, accountId) < 1) throw bad("TRANSFER_TARGET_INVALID", "Transfer target must be a workspace member");
    ensureMetadata(formId, accountId);
    db.update("update form_catalog_metadata set owner_account_id=?, updated_at=now() where form_id=?", accountId, formId);
    return form(formId);
  }
  public void setFolder(UUID workspaceId, UUID formId, UUID folderId, UUID actor) {
    requireForm(workspaceId, formId); ensureMetadata(formId, actor);
    if (folderId != null && db.queryForObject("select count(*) from catalog_folders where id=? and workspace_id=?", Integer.class, folderId, workspaceId) != 1) throw notFound();
    db.update("update form_catalog_metadata set folder_id=?, updated_at=now() where form_id=?", folderId, formId);
  }
  public void setTags(UUID workspaceId, UUID formId, Collection<UUID> tagIds, UUID actor) {
    requireForm(workspaceId, formId); ensureMetadata(formId, actor);
    for (UUID tag : tagIds) if (db.queryForObject("select count(*) from catalog_tags where id=? and workspace_id=?", Integer.class, tag, workspaceId) != 1) throw notFound();
    db.update("delete from form_catalog_tags where form_id=?", formId);
    for (UUID tag : tagIds) db.update("insert into form_catalog_tags(form_id,tag_id) values(?,?)", formId, tag);
  }

  public Map<String, Object> effectiveSettings(UUID workspaceId) {
    Map<String, Object> row = db.queryForMap("select w.organization_id, coalesce(os.policy_settings,'{}'::jsonb)::text op, coalesce(os.provider_settings,'{}'::jsonb)::text orv, coalesce(ws.policy_settings,'{}'::jsonb)::text wp, coalesce(ws.provider_settings,'{}'::jsonb)::text wpr from workspaces w left join catalog_organization_settings os on os.organization_id=w.organization_id left join catalog_workspace_settings ws on ws.workspace_id=w.id where w.id=?", workspaceId);
    Map<String, Object> policyOverride = map((String) row.get("wp"));
    Map<String, Object> providerOverride = map((String) row.get("wpr"));
    return Map.of("workspaceId", opaque("workspace", workspaceId),
        "effective", Map.of("policy", merge(map((String) row.get("op")), policyOverride),
            "providers", merge(map((String) row.get("orv")), providerOverride)),
        "overrides", Map.of("policy", policyOverride, "providers", providerOverride));
  }
  public Map<String, Object> updateSettings(UUID workspaceId, Map<String, Object> policy, Map<String, Object> providers) {
    db.update("insert into catalog_workspace_settings(workspace_id,policy_settings,provider_settings) values(?,cast(? as jsonb),cast(? as jsonb)) on conflict(workspace_id) do update set policy_settings=excluded.policy_settings, provider_settings=excluded.provider_settings, updated_at=now()", workspaceId, stringify(policy), stringify(providers));
    return effectiveSettings(workspaceId);
  }

  private List<Map<String, Object>> formTags(UUID form) { return db.query("select t.id,t.name,t.color from form_catalog_tags ft join catalog_tags t on t.id=ft.tag_id where ft.form_id=? order by lower(t.name),t.id", (rs, ignored) -> {
    Map<String, Object> tag = new LinkedHashMap<>();
    tag.put("id", rs.getObject("id", UUID.class).toString());
    tag.put("name", rs.getString("name"));
    tag.put("color", rs.getString("color"));
    return tag;
  }, form); }
  private Map<String, Object> folder(UUID id) { return db.queryForObject("select id,name,created_at,updated_at from catalog_folders where id=?", (rs, ignored) -> entity(rs.getObject("id", UUID.class), rs.getString("name"), null, rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant()), id); }
  private Map<String, Object> tag(UUID id) { return db.queryForObject("select id,name,color,created_at,updated_at from catalog_tags where id=?", (rs, ignored) -> tagEntity(rs.getObject("id", UUID.class), rs.getString("name"), rs.getString("color"), rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant()), id); }
  private Map<String, Object> form(UUID id) {
    return db.queryForObject("""
        select f.id,f.form_key,f.title,f.status,f.revision,f.updated_at,m.folder_id,m.owner_account_id,m.archived_at,
               coalesce(a.email,'') owner_email
          from forms f left join form_catalog_metadata m on m.form_id=f.id left join accounts a on a.id=m.owner_account_id
         where f.id=?
        """, (rs, ignored) -> {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("id", rs.getObject("id", UUID.class).toString());
      row.put("formKey", rs.getString("form_key")); row.put("title", rs.getString("title"));
      row.put("status", rs.getTimestamp("archived_at") == null ? rs.getString("status") : "ARCHIVED");
      row.put("revision", rs.getLong("revision")); row.put("updatedAt", rs.getTimestamp("updated_at").toInstant().toString());
      UUID folder = rs.getObject("folder_id", UUID.class); UUID owner = rs.getObject("owner_account_id", UUID.class);
      row.put("folderId", folder == null ? null : folder.toString());
      row.put("owner", owner == null ? null : Map.of("id", opaque("account", owner), "email", rs.getString("owner_email")));
      row.put("tags", formTags(id));
      return row;
    }, id);
  }
  private void requireForm(UUID workspace, UUID form) { if (db.queryForObject("select count(*) from forms where id=? and workspace_id=?", Integer.class, form, workspace) != 1) throw notFound(); }
  private void ensureMetadata(UUID form, UUID owner) { db.update("insert into form_catalog_metadata(form_id,owner_account_id) values(?,?) on conflict(form_id) do nothing", form, owner); }
  private Map<String, Object> entity(UUID id, String name, String color, Instant created, Instant updated) { Map<String,Object> value = new LinkedHashMap<>(); value.put("id",id.toString()); value.put("name",name); if(color!=null)value.put("color",color); value.put("createdAt",created.toString()); value.put("updatedAt",updated.toString()); return value; }
  private Map<String, Object> tagEntity(UUID id, String name, String color, Instant created, Instant updated) { Map<String,Object> value = entity(id, name, null, created, updated); value.put("color", color); return value; }
  private String duplicateKey(UUID workspace, String original) { String base = original.length() > 90 ? original.substring(0, 90) : original; for (int n=2;n<10000;n++) { String key=base+"-copy-"+n; if (db.queryForObject("select count(*) from forms where workspace_id=? and form_key=?", Integer.class, workspace,key)==0) return key; } throw bad("DUPLICATE_KEY_EXHAUSTED", "Unable to allocate duplicate key"); }
  private List<String> normalizedTags(List<String> tags) { return tags == null ? List.of() : tags.stream().filter(value -> value != null && !value.isBlank()).map(String::trim).sorted().distinct().toList(); }
  private String fingerprint(UUID workspace, Search search) { return sha(workspace + "|" + nullSafe(search.query()).toLowerCase() + "|" + nullSafe(search.status()).toUpperCase() + "|" + nullSafe(search.owner()) + "|" + nullSafe(search.folder()) + "|" + normalizedTags(search.tags()) + "|" + Boolean.TRUE.equals(search.archived())); }
  private long revision(UUID workspace) { return db.queryForObject("select coalesce((select revision from catalog_workspace_revisions where workspace_id=?), 0)", Long.class, workspace); }
  private Cursor cursor(String encoded, String fingerprint, long currentRevision) { if(encoded==null||encoded.isBlank()) return null; try { String[] p=new String(Base64.getUrlDecoder().decode(encoded),StandardCharsets.UTF_8).split("\\|",-1); if(p.length!=5 || !MessageDigest.isEqual(p[3].getBytes(StandardCharsets.UTF_8),fingerprint.getBytes(StandardCharsets.UTF_8))) throw new IllegalArgumentException(); long revision=Long.parseLong(p[4]); if(revision != currentRevision) throw new ResponseStatusException(HttpStatus.CONFLICT,"CATALOG_CURSOR_STALE"); return new Cursor(Instant.ofEpochMilli(Long.parseLong(p[0])),Instant.ofEpochMilli(Long.parseLong(p[1])),UUID.fromString(p[2]),p[3],revision); } catch(ResponseStatusException e){throw e;} catch(Exception e){throw bad("CATALOG_CURSOR_INVALID","Cursor does not match this catalog query");} }
  private String encode(Cursor cursor) { return Base64.getUrlEncoder().withoutPadding().encodeToString((cursor.snapshot().toEpochMilli()+"|"+cursor.updatedAt().toEpochMilli()+"|"+cursor.id()+"|"+cursor.fingerprint()+"|"+cursor.revision()).getBytes(StandardCharsets.UTF_8)); }
  private record Cursor(Instant snapshot, Instant updatedAt, UUID id, String fingerprint, long revision) {}
  private String opaque(String kind, UUID id) { return kind + "-" + id; }
  private Map<String,Object> map(String value) { try { return value == null ? Map.of() : json.readValue(value,new TypeReference<>(){}); } catch(Exception e){throw new IllegalStateException(e);} }
  @SuppressWarnings("unchecked") private Map<String,Object> merge(Map<String,Object> base,Map<String,Object> override){Map<String,Object> out=new LinkedHashMap<>(base); override.forEach((key,value)->out.put(key,value instanceof Map<?,?> child && out.get(key) instanceof Map<?,?> parent ? merge((Map<String,Object>)parent,(Map<String,Object>)child):value));return out;}
  private String stringify(Object value){try{return json.writeValueAsString(value==null?Map.of():value);}catch(Exception e){throw new IllegalArgumentException(e);}}
  private String name(String value,int max,String label){if(value==null||value.trim().isEmpty()||value.trim().length()>max)throw bad("CATALOG_INPUT_INVALID","Valid "+label+" required");return value.trim();}
  private String color(String value){if(value==null||value.isBlank())return null; if(!value.matches("#[0-9A-Fa-f]{6}"))throw bad("CATALOG_INPUT_INVALID","Color must be #RRGGBB");return value;}
  private UUID uuid(String value,String label){try{String prefix=label.equals("owner")?"account-":""; return UUID.fromString(!prefix.isEmpty() && value.startsWith(prefix) ? value.substring(prefix.length()) : value);}catch(Exception e){throw bad("CATALOG_INPUT_INVALID","Invalid "+label);}}
  private String nullSafe(String value){return value==null?"":value;}
  private String sha(String value){try{return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}catch(Exception e){throw new IllegalStateException(e);}}
  private ResponseStatusException notFound(){return new ResponseStatusException(HttpStatus.NOT_FOUND,"Resource not found");}
  private ResponseStatusException bad(String code,String message){return new ResponseStatusException(HttpStatus.BAD_REQUEST,code+": "+message);}
}
