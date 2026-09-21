package com.kodeboxx.smartintake.security;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.security.MessageDigest;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Durable, transaction-bound replay for staff administration mutations.
 *
 * <p>Only a response body and strong ETag are persisted. Capability-copy headers are deliberately
 * excluded: a retried request can replay its resource result but never disclose a raw secret again.
 */
@Component
public class AdministrationMutationExecutor {
  private final JdbcTemplate db;
  private final ObjectMapper json;

  public AdministrationMutationExecutor(JdbcTemplate db, ObjectMapper objectMapper) {
    this.db = db;
    this.json = objectMapper.copy().configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);
  }

  public ResponseEntity<?> execute(UUID actor, String scope, String operation, String idempotencyKey,
                                   Object canonicalRequest, Supplier<ResponseEntity<?>> mutation) {
    if (idempotencyKey == null || idempotencyKey.isBlank() || idempotencyKey.length() > 200) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Idempotency-Key required");
    }
    String digest = digest(canonicalRequest);
    db.update("delete from administration_mutation_replays where expires_at < now()");
    int claimed = db.update("insert into administration_mutation_replays(actor_id,scope_id,operation,idempotency_key,request_digest,response_status) "
            + "values(?,?,?,?,?,0) on conflict do nothing",
        actor, scope, operation, idempotencyKey, digest);
    if (claimed == 0) return replay(actor, scope, operation, idempotencyKey, digest);

    ResponseEntity<?> response = mutation.get();
    String etag = response.getHeaders().getETag();
    if (etag == null) etag = strongEtag(response.getBody());
    String body = response.getBody() == null ? null : write(response.getBody());
    db.update("update administration_mutation_replays set response_status=?,response_body=?,response_etag=? "
            + "where actor_id=? and scope_id=? and operation=? and idempotency_key=?",
        response.getStatusCode().value(), body, etag, actor, scope, operation, idempotencyKey);
    ResponseEntity.BodyBuilder result = ResponseEntity.status(response.getStatusCode());
    if (etag != null) result.eTag(etag);
    response.getHeaders().forEach((name, values) -> {
      if (!name.equalsIgnoreCase("ETag")) values.forEach(value -> result.header(name, value));
    });
    return body == null ? result.build() : result.body(read(body));
  }

  private ResponseEntity<?> replay(UUID actor, String scope, String operation, String key, String digest) {
    Map<String, Object> record = db.queryForMap("select request_digest,response_status,response_body,response_etag from administration_mutation_replays "
        + "where actor_id=? and scope_id=? and operation=? and idempotency_key=?", actor, scope, operation, key);
    if (!digest.equals(record.get("request_digest"))) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Idempotency-Key request mismatch");
    }
    int status = ((Number) record.get("response_status")).intValue();
    if (status == 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "Idempotency-Key request in progress");
    ResponseEntity.BodyBuilder result = ResponseEntity.status(status);
    String etag = (String) record.get("response_etag");
    if (etag != null) result.eTag(etag);
    String body = (String) record.get("response_body");
    return body == null ? result.build() : result.body(read(body));
  }

  private String digest(Object request) {
    try {
      return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
          .digest(json.writeValueAsBytes(request)));
    } catch (Exception ex) {
      throw new IllegalStateException("Unable to canonicalize administration request", ex);
    }
  }

  private String write(Object body) {
    try { return json.writeValueAsString(body); }
    catch (JsonProcessingException ex) { throw new IllegalStateException("Unable to store administration response", ex); }
  }

  private Object read(String body) {
    try { return json.readValue(body, Object.class); }
    catch (JsonProcessingException ex) { throw new IllegalStateException("Unable to replay administration response", ex); }
  }

  @SuppressWarnings("unchecked")
  private static String strongEtag(Object body) {
    if (body instanceof Map<?, ?> map) {
      for (Object value : map.values()) {
        if (value instanceof Map<?, ?> resource && resource.get("revision") instanceof Number revision) {
          return "\"rev-" + revision.longValue() + "\"";
        }
      }
    }
    return "\"rev-0\"";
  }
}
