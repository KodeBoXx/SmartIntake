package com.kodeboxx.smartintake.contract;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.Objects;

/** Immutable package identity. The digest excludes packageStamp itself to avoid recursion. */
public record PackageStamp(String contractVersion, String evaluatorContract, String canonicalSha256, String timeZoneDatabaseVersion) {
  private static final ObjectMapper MAPPER = new ObjectMapper();
  public static final String EVALUATOR_CONTRACT = "lite-expression-1";

  public static PackageStamp stamp(JsonNode packageBody, String evaluatorContract, String timeZoneDatabaseVersion) {
    requirePackage(packageBody);
    if (!EVALUATOR_CONTRACT.equals(evaluatorContract) || !TimeZoneRegistry.VERSION.equals(timeZoneDatabaseVersion))
      throw new IllegalArgumentException("PACKAGE_EVALUATOR_BINDING");
    return new PackageStamp(ContractValue.VERSION, evaluatorContract, CanonicalJson.sha256(bodyWithoutStamp(packageBody)), timeZoneDatabaseVersion);
  }

  public static JsonNode attach(JsonNode packageBody, String evaluatorContract, String tzdbVersion) {
    ObjectNode target = (ObjectNode) bodyWithoutStamp(packageBody);
    PackageStamp stamp = stamp(target, evaluatorContract, tzdbVersion);
    ObjectNode node = MAPPER.createObjectNode();
    node.put("contractVersion", stamp.contractVersion());
    node.put("evaluatorContract", stamp.evaluatorContract());
    node.put("canonicalSha256", stamp.canonicalSha256());
    if (stamp.timeZoneDatabaseVersion() != null) node.put("timeZoneDatabaseVersion", stamp.timeZoneDatabaseVersion());
    target.set("packageStamp", node);
    return target;
  }

  public static void verify(JsonNode stampedPackage) {
    requirePackage(stampedPackage);
    JsonNode raw = stampedPackage.path("packageStamp");
    if (!raw.isObject()) throw new IllegalArgumentException("packageStamp is required");
    if (raw.size() != 4 || !raw.has("contractVersion") || !raw.has("evaluatorContract")
        || !raw.has("canonicalSha256") || !raw.has("timeZoneDatabaseVersion")) {
      throw new IllegalArgumentException("PACKAGE_STAMP_SHAPE");
    }
    PackageStamp expected = stamp(stampedPackage, raw.path("evaluatorContract").asText(null), raw.path("timeZoneDatabaseVersion").asText(null));
    if (!Objects.equals(raw.path("contractVersion").asText(), expected.contractVersion())
        || !Objects.equals(raw.path("canonicalSha256").asText(), expected.canonicalSha256())) throw new IllegalArgumentException("PACKAGE_HASH_MISMATCH");
  }

  private static ObjectNode bodyWithoutStamp(JsonNode packageBody) {
    requirePackage(packageBody);
    ObjectNode copy = ((ObjectNode) packageBody).deepCopy();
    copy.remove("packageStamp");
    return copy;
  }

  private static void requirePackage(JsonNode value) {
    if (value == null || !value.isObject() || !ContractValue.VERSION.equals(value.path("contractVersion").asText()))
      throw new IllegalArgumentException("PACKAGE_CONTRACT_VERSION");
  }
}
