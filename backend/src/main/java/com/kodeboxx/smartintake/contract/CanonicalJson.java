package com.kodeboxx.smartintake.contract;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/** RFC-agnostic deterministic JSON encoding: recursively sorted object keys, untouched array order. */
public final class CanonicalJson {
  private static final ObjectMapper MAPPER = new ObjectMapper();
  private CanonicalJson() {}

  public static JsonNode normalize(JsonNode source) {
    if (source.isObject()) {
      ObjectNode target = MAPPER.createObjectNode();
      List<Map.Entry<String, JsonNode>> fields = new ArrayList<>();
      source.fields().forEachRemaining(fields::add);
      fields.sort(Comparator.comparing(Map.Entry::getKey));
      for (Map.Entry<String, JsonNode> field : fields) target.set(field.getKey(), normalize(field.getValue()));
      return target;
    }
    if (source.isArray()) {
      ArrayNode target = MAPPER.createArrayNode();
      source.forEach(value -> target.add(normalize(value)));
      return target;
    }
    return source.deepCopy();
  }

  public static String string(JsonNode source) {
    try { return MAPPER.writeValueAsString(normalize(source)); }
    catch (JsonProcessingException exception) { throw new IllegalArgumentException("Cannot serialize canonical JSON", exception); }
  }

  public static String sha256(JsonNode source) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(string(source).getBytes(StandardCharsets.UTF_8));
      StringBuilder result = new StringBuilder("sha256:");
      for (byte b : digest) result.append(String.format("%02x", b));
      return result.toString();
    } catch (NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
  }
}
