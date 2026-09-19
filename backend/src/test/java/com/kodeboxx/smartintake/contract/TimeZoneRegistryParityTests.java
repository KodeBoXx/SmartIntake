package com.kodeboxx.smartintake.contract;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class TimeZoneRegistryParityTests {
  @Test
  void loads_the_exact_shared_iana_registry_with_aliases() {
    assertThat(TimeZoneRegistry.VERSION).isEqualTo("IANA-tzdb-2025b-m3-complete-1");
    assertThat(TimeZoneRegistry.SHA256).isEqualTo("8725722643bf1f4ff4fc4b22268ade98b6fae047a86897219c3a13d4c4ced93d");
    assertThat(TimeZoneRegistry.size()).isEqualTo(598);
    assertThat(TimeZoneRegistry.contains("UTC")).isTrue();
    assertThat(TimeZoneRegistry.contains("America/Argentina/Buenos_Aires")).isTrue();
    assertThat(TimeZoneRegistry.contains("Asia/Kathmandu")).isTrue();
    assertThat(TimeZoneRegistry.contains("Asia/Katmandu")).isTrue();
    assertThat(TimeZoneRegistry.contains("US/Eastern")).isTrue();
    assertThat(TimeZoneRegistry.contains("Pacific/Auckland")).isTrue();
    assertThat(TimeZoneRegistry.contains("Europe/Berlin")).isTrue();
    assertThat(TimeZoneRegistry.contains("Etc/UTC")).isTrue();
    assertThat(TimeZoneRegistry.contains("America/Not_A_Zone")).isFalse();
    assertThat(TimeZoneRegistry.contains("GMT")).isTrue();
  }
}
