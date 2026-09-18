package com.kodeboxx.smartintake.contract;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * Loads the immutable M2 publication bundle. The checked-in capability registry
 * is the single source exposed to callers; schemas and OpenAPI are served as
 * their exact packaged bytes rather than re-serialized JSON/YAML.
 */
@Component
public final class ContractRegistry {
  public static final String VERSION = "4.0.0";
  private static final String ROOT = "contracts/smart-form-builder-lite/4.0.0/";
  private final ObjectMapper json;
  private final Map<String, PublishedSchema> schemas = new LinkedHashMap<>();
  private final PublishedDocument openApi;
  private final Map<String, Object> capabilities;

  public ContractRegistry(ObjectMapper json) {
    this.json = json;
    try {
      capabilities = json.readValue(bytes("contracts/smart-form-builder-lite/4.0.0/capabilities.registry.json"), new TypeReference<>() {});
      @SuppressWarnings("unchecked")
      List<Map<String, Object>> entries = (List<Map<String, Object>>) capabilities.get("schemas");
      Map<String, String> schemaSources = new LinkedHashMap<>();
      Map<String, byte[]> schemaBytes = new LinkedHashMap<>();
      for (Map<String, Object> entry : entries) {
        String kind = String.valueOf(entry.get("kind"));
        byte[] content = bytes(String.valueOf(entry.get("resource")));
        schemaBytes.put(kind, content);
        schemaSources.put(String.valueOf(entry.get("id")), new String(content, StandardCharsets.UTF_8));
      }
      JsonSchemaFactory factory = JsonSchemaFactory.builder(JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012))
          .schemaLoaders(loaders -> loaders.schemas(schemaSources)).build();
      for (Map<String, Object> entry : entries) {
        String kind = String.valueOf(entry.get("kind"));
        byte[] content = schemaBytes.get(kind);
        JsonSchema schema = factory.getSchema(json.readTree(content));
        schemas.put(kind, new PublishedSchema(kind, String.valueOf(entry.get("version")), content, sha256(content), schema));
      }
      byte[] apiBytes = bytes("contracts/openapi-4.0.0.yaml");
      openApi = new PublishedDocument(apiBytes, sha256(apiBytes));
    } catch (IOException exception) {
      throw new IllegalStateException("M2 contract publication bundle is unavailable", exception);
    }
  }

  public Map<String, Object> capabilities() {
    return capabilities;
  }

  public PublishedSchema schema(String kind, String version) {
    if (!VERSION.equals(version)) throw new UnknownContract(kind, version);
    PublishedSchema schema = schemas.get(kind);
    if (schema == null) throw new UnknownContract(kind, version);
    return schema;
  }

  public PublishedDocument openApi() {
    return openApi;
  }

  public ValidationResult validate(String kind, String version, JsonNode instance) {
    PublishedSchema schema = schema(kind, version);
    Set<ValidationMessage> messages = schema.schema().validate(instance);
    List<Diagnostic> diagnostics = messages.stream()
        .map(message -> new Diagnostic(pointer(message.getInstanceLocation().toString()), message.getMessage(), message.getCode()))
        .sorted(Comparator.comparing(Diagnostic::pointer).thenComparing(Diagnostic::message))
        .toList();
    return new ValidationResult(kind, version, schema.sha256(), diagnostics.isEmpty(), diagnostics);
  }

  private byte[] bytes(String resource) throws IOException {
    ClassPathResource path = new ClassPathResource(resource);
    try (InputStream input = path.getInputStream()) { return input.readAllBytes(); }
  }

  private static String sha256(byte[] bytes) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
      StringBuilder value = new StringBuilder(64);
      for (byte item : digest) value.append(String.format("%02x", item));
      return value.toString();
    } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
  }

  private static String pointer(String path) {
    if (path == null || path.isBlank() || "$".equals(path)) return "";
    if (path.startsWith("$")) return path.substring(1).replace(".", "/").replace("[", "/").replace("]", "");
    return path;
  }

  public record PublishedDocument(byte[] bytes, String sha256) {
    public String digestHeader() { return "SHA-256=" + Base64.getEncoder().encodeToString(hexToBytes(sha256)); }
    private static byte[] hexToBytes(String value) {
      byte[] bytes = new byte[value.length() / 2];
      for (int index = 0; index < bytes.length; index++) bytes[index] = (byte) Integer.parseInt(value.substring(index * 2, index * 2 + 2), 16);
      return bytes;
    }
  }
  public record PublishedSchema(String kind, String version, byte[] bytes, String sha256, JsonSchema schema) {
    public PublishedDocument document() { return new PublishedDocument(bytes, sha256); }
  }
  public record Diagnostic(String pointer, String message, String code) {}
  public record ValidationResult(String kind, String version, String schemaSha256, boolean valid, List<Diagnostic> diagnostics) {}
  public static final class UnknownContract extends RuntimeException {
    public UnknownContract(String kind, String version) { super("Unknown published schema " + kind + "@" + version); }
  }
}
