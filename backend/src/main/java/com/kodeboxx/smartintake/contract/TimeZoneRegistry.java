package com.kodeboxx.smartintake.contract;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** Versioned, evaluator-owned zone identity; never consults the host default zone database. */
public final class TimeZoneRegistry {
  private static final String RESOURCE = "/contracts/m3-timezone-registry.json";
  private static final Registry REGISTRY = load();
  public static final String VERSION = REGISTRY.version();
  public static final String SHA256 = REGISTRY.sha256();
  private static final Set<String> ZONES = REGISTRY.zones();

  private TimeZoneRegistry() {}

  public static boolean contains(String zone) { return ZONES.contains(zone); }
  public static int size() { return ZONES.size(); }

  private static Registry load() {
    try (InputStream stream = TimeZoneRegistry.class.getResourceAsStream(RESOURCE)) {
      if (stream == null) throw new IllegalStateException("missing pinned timezone registry");
      JsonNode root = new ObjectMapper().readTree(stream);
      if (!"smart-intake.pinned-timezone-registry.v1".equals(root.path("format").asText())) {
        throw new IllegalStateException("invalid pinned timezone registry format");
      }
      List<String> identifiers = new java.util.ArrayList<>();
      root.path("zoneIdentifiers").forEach(zone -> identifiers.add(zone.asText()));
      if (identifiers.isEmpty() || !identifiers.equals(identifiers.stream().sorted().toList())
          || identifiers.size() != new LinkedHashSet<>(identifiers).size()) {
        throw new IllegalStateException("invalid pinned timezone registry identifiers");
      }
      String digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
          .digest((String.join("\n", identifiers) + "\n").getBytes(StandardCharsets.UTF_8)));
      if (!digest.equals(root.path("zoneIdentifiersSha256").asText())) {
        throw new IllegalStateException("pinned timezone registry digest mismatch");
      }
      return new Registry(root.path("version").asText(), digest, Set.copyOf(identifiers));
    } catch (Exception exception) {
      throw new IllegalStateException("cannot load pinned timezone registry", exception);
    }
  }

  private record Registry(String version, String sha256, Set<String> zones) {}
}
