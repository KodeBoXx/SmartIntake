package com.kodeboxx.smartintake.contract;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.JsonMetaSchema;
import com.networknt.schema.SchemaValidatorsConfig;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;
import com.networknt.schema.format.AbstractFormat;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.math.BigInteger;
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
  public static final String API_VERSION = "4.1.0";
  private static final String ROOT = "contracts/smart-form-builder-lite/4.0.0/";
  private final ObjectMapper json;
  private final Map<String, PublishedSchema> schemas = new LinkedHashMap<>();
  private final PublishedDocument openApi;
  private final PublishedDocument m4OpenApi;
  private final PublishedDocument m4Capabilities;
  private final Map<String, Object> capabilities;

  private static final BigInteger INT64_MIN = BigInteger.valueOf(Long.MIN_VALUE);
  private static final BigInteger INT64_MAX = BigInteger.valueOf(Long.MAX_VALUE);
  private static final String LOCAL_TIME_PATTERN = "^(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]{1,9})?$";

  public ContractRegistry(ObjectMapper json) {
    this.json = json;
    try {
      Map<String, Object> published = json.readValue(
          bytes("contracts/smart-form-builder-lite/4.0.0/capabilities.registry.json"), new TypeReference<>() {});
      @SuppressWarnings("unchecked")
      List<Map<String, Object>> entries = (List<Map<String, Object>>) published.get("schemas");
      Map<String, String> schemaSources = new LinkedHashMap<>();
      Map<String, byte[]> schemaBytes = new LinkedHashMap<>();
      for (Map<String, Object> entry : entries) {
        String kind = String.valueOf(entry.get("kind"));
        byte[] content = bytes(String.valueOf(entry.get("resource")));
        schemaBytes.put(kind, content);
        schemaSources.put(String.valueOf(entry.get("id")), new String(content, StandardCharsets.UTF_8));
      }
      JsonMetaSchema metaSchema = JsonMetaSchema.builder(JsonMetaSchema.getV202012())
          .addFormat(format("canonical-int64", ContractRegistry::isCanonicalInt64))
          .addFormat(format("canonical-decimal", ContractRegistry::isCanonicalDecimal))
          .addFormat(format("stored-decimal", ContractRegistry::isStoredDecimal))
          .addFormat(format("expression-decimal-input", ContractRegistry::isExpressionDecimalInput))
          // Contract times are offset-free local wall-clock values, matching AJV.
          .addFormat(format("time", ContractRegistry::isLocalWallClockTime))
          .build();
      JsonSchemaFactory factory = JsonSchemaFactory.builder()
          .defaultMetaSchemaIri(metaSchema.getIri())
          .addMetaSchema(metaSchema)
          .schemaLoaders(loaders -> loaders.schemas(schemaSources)).build();
      SchemaValidatorsConfig validationConfig = SchemaValidatorsConfig.builder()
          .formatAssertionsEnabled(true)
          .build();
      for (Map<String, Object> entry : entries) {
        String kind = String.valueOf(entry.get("kind"));
        byte[] content = schemaBytes.get(kind);
        JsonSchema schema = factory.getSchema(json.readTree(content), validationConfig);
        schemas.put(kind, new PublishedSchema(kind, String.valueOf(entry.get("version")), content, sha256(content), schema));
      }
      byte[] apiBytes = bytes("contracts/openapi-4.0.0.yaml");
      openApi = new PublishedDocument(apiBytes, sha256(apiBytes));
      byte[] m4ApiBytes = bytes("contracts/openapi-4.1.0.yaml");
      m4OpenApi = new PublishedDocument(m4ApiBytes, sha256(m4ApiBytes));
      Map<String, Object> advertised = new LinkedHashMap<>(published);
      advertised.put("apiContractVersion", API_VERSION);
      advertised.put("schemaContractVersion", VERSION);
      advertised.put("openapi", Map.of(
          "version", "3.1.0", "file", "docs/api/openapi-4.1.0.yaml",
          "sha256", m4OpenApi.sha256(), "resource", "contracts/openapi-4.1.0.yaml"));
      advertised.put("apiContracts", List.of(
          Map.of("version", VERSION, "sha256", openApi.sha256(), "resource", "contracts/openapi-4.0.0.yaml"),
          Map.of("version", API_VERSION, "sha256", m4OpenApi.sha256(), "resource", "contracts/openapi-4.1.0.yaml")));
      capabilities = Map.copyOf(published);
      byte[] advertisedBytes = json.writeValueAsBytes(advertised);
      m4Capabilities = new PublishedDocument(advertisedBytes, sha256(advertisedBytes));
    } catch (IOException exception) {
      throw new IllegalStateException("M2 contract publication bundle is unavailable", exception);
    }
  }

  private static AbstractFormat format(String name, java.util.function.Predicate<String> predicate) {
    return new AbstractFormat(name, "Contract scalar format is invalid") {
      @Override public boolean matches(String value) { return predicate.test(value); }
    };
  }

  private static boolean isCanonicalInt64(String value) {
    if (!value.matches("^(0|-[1-9][0-9]*|[1-9][0-9]*)$")) return false;
    BigInteger number = new BigInteger(value);
    return number.compareTo(INT64_MIN) >= 0 && number.compareTo(INT64_MAX) <= 0;
  }

  private static boolean isCanonicalDecimal(String value) {
    if (!value.matches("^(?:0|[1-9][0-9]*(?:\\.[0-9]*[1-9])?|-[1-9][0-9]*(?:\\.[0-9]*[1-9])?|-0\\.[0-9]*[1-9])$")) return false;
    return decimalIsBounded(value);
  }

  private static boolean isStoredDecimal(String value) {
    if (!value.matches("^(?:0(?:\\.[0-9]+)?|[1-9][0-9]*(?:\\.[0-9]+)?|-[1-9][0-9]*(?:\\.[0-9]+)?|-0\\.[0-9]*[1-9][0-9]*)$")) return false;
    return decimalIsBounded(value);
  }

  private static boolean isLocalWallClockTime(String value) { return value.matches(LOCAL_TIME_PATTERN); }

  private static boolean isExpressionDecimalInput(String value) {
    if (!value.matches("^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$")) return false;
    return decimalIsBounded(value);
  }

  private static boolean decimalIsBounded(String value) {
    String unsigned = value.startsWith("-") ? value.substring(1) : value;
    String[] parts = unsigned.split("\\.", -1);
    String integer = parts[0];
    String fraction = parts.length == 2 ? parts[1] : "";
    String coefficient = (integer + fraction).replaceFirst("^0+", "");
    if (coefficient.isEmpty()) return true;
    if (coefficient.replaceFirst("0+$", "").length() > 34) return false;
    String integerWithoutLeadingZeroes = integer.replaceFirst("^0+", "");
    int adjustedExponent = !integerWithoutLeadingZeroes.isEmpty()
        ? integerWithoutLeadingZeroes.length() - 1
        : -(fraction.length() - fraction.replaceFirst("^0+", "").length() + 1);
    return adjustedExponent >= -6143 && adjustedExponent <= 6144;
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

  public PublishedDocument openApi(String version) {
    if (VERSION.equals(version)) return openApi;
    if (API_VERSION.equals(version)) return m4OpenApi;
    throw new UnknownContract("openapi", version);
  }

  public PublishedDocument capabilities(String version) {
    if (API_VERSION.equals(version)) return m4Capabilities;
    throw new UnknownContract("capabilities", version);
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

  /** Gate transport DTO deserialization behind the authoritative contract validator. */
  public JsonNode requireValid(String kind, String version, JsonNode instance) {
    ValidationResult result = validate(kind, version, instance);
    if (!result.valid()) throw new IllegalArgumentException("Contract validation failed for " + kind + "@" + version + ": " + result.diagnostics());
    return instance;
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
