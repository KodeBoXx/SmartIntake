package com.kodeboxx.smartintake.contract;

import java.util.Set;

/** Versioned, evaluator-owned zone identity; never consults the host default zone database. */
public final class TimeZoneRegistry {
  public static final String VERSION = "IANA-tzdb-2025b-m3-subset-1";
  private static final Set<String> ZONES = Set.of(
      "UTC", "Africa/Cairo", "Africa/Johannesburg", "America/Anchorage",
      "America/Argentina/Buenos_Aires", "America/Chicago", "America/Denver",
      "America/Los_Angeles", "America/New_York", "America/Phoenix", "America/Sao_Paulo",
      "America/Toronto", "Asia/Dubai", "Asia/Hong_Kong", "Asia/Kolkata", "Asia/Seoul",
      "Asia/Singapore", "Asia/Tokyo", "Australia/Adelaide", "Australia/Brisbane",
      "Australia/Melbourne", "Australia/Perth", "Australia/Sydney", "Europe/Amsterdam",
      "Europe/Berlin", "Europe/London", "Europe/Madrid", "Europe/Paris", "Europe/Rome",
      "Europe/Stockholm", "Pacific/Auckland", "Pacific/Honolulu");

  private TimeZoneRegistry() {}

  public static boolean contains(String zone) { return ZONES.contains(zone); }
  public static int size() { return ZONES.size(); }
}
