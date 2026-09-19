package com.kodeboxx.smartintake.contract;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class TimeZoneRegistryParityTests {
  @Test
  void matches_the_browser_pinned_registry_identity_and_representative_zones() {
    assertThat(TimeZoneRegistry.VERSION).isEqualTo("IANA-tzdb-2025b-m3-subset-1");
    assertThat(TimeZoneRegistry.size()).isEqualTo(32);
    assertThat(TimeZoneRegistry.contains("UTC")).isTrue();
    assertThat(TimeZoneRegistry.contains("America/Argentina/Buenos_Aires")).isTrue();
    assertThat(TimeZoneRegistry.contains("Asia/Tokyo")).isTrue();
    assertThat(TimeZoneRegistry.contains("Pacific/Auckland")).isTrue();
    assertThat(TimeZoneRegistry.contains("Europe/Berlin")).isTrue();
    assertThat(TimeZoneRegistry.contains("Etc/UTC")).isFalse();
    assertThat(TimeZoneRegistry.contains("America/Not_A_Zone")).isFalse();
    assertThat(TimeZoneRegistry.contains("GMT")).isFalse();
  }
}
