package com.kodeboxx.smartintake.contract;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class ContractFoundationTests {
  private final ObjectMapper json = new ObjectMapper();

  @Test void validates_exact_signed_int64_strings() throws Exception {
    assertThat(ContractValue.integer(json.readTree("\"9223372036854775807\""))).isEqualTo("9223372036854775807");
    assertThat(ContractValue.integer(json.readTree("\"-9223372036854775808\""))).isEqualTo("-9223372036854775808");
    assertThatThrownBy(() -> ContractValue.integer(json.readTree("9007199254740993"))).hasMessage("INTEGER_ENCODING");
    assertThatThrownBy(() -> ContractValue.integer(json.readTree("\"-0\""))).hasMessage("INTEGER_ENCODING");
    assertThatThrownBy(() -> ContractValue.integer(json.readTree("\"9223372036854775808\""))).hasMessage("INTEGER_RANGE");
  }

  @Test void canonicalizes_decimals_without_binary_rounding() throws Exception {
    assertThat(ContractValue.decimal(json.readTree("\"2.3400\""))).isEqualTo("2.34");
    assertThat(ContractValue.decimal(json.readTree("\"-0.000\""))).isEqualTo("0");
    assertThatThrownBy(() -> ContractValue.decimal(json.readTree("\"1e3\""))).hasMessage("INVALID_LITERAL");
  }

  @Test void package_hash_is_key_order_independent_and_detects_tampering() throws Exception {
    ObjectNode one = (ObjectNode) json.readTree("{\"contractVersion\":\"4.0.0\",\"pages\":[],\"title\":\"A\"}");
    ObjectNode two = (ObjectNode) json.readTree("{\"title\":\"A\",\"pages\":[],\"contractVersion\":\"4.0.0\"}");
    assertThat(PackageStamp.stamp(one, PackageStamp.EVALUATOR_CONTRACT, TimeZoneRegistry.VERSION).canonicalSha256()).isEqualTo(PackageStamp.stamp(two, PackageStamp.EVALUATOR_CONTRACT, TimeZoneRegistry.VERSION).canonicalSha256());
    ObjectNode stamped = (ObjectNode) PackageStamp.attach(one, PackageStamp.EVALUATOR_CONTRACT, TimeZoneRegistry.VERSION);
    PackageStamp.verify(stamped);
    stamped.put("title", "changed");
    assertThatThrownBy(() -> PackageStamp.verify(stamped)).hasMessage("PACKAGE_HASH_MISMATCH");
  }

  @Test void evaluator_is_closed_and_exact_for_scalar_arithmetic() throws Exception {
    ExpressionEngine engine = new ExpressionEngine();
    var result = engine.evaluate(json.readTree("{\"op\":\"divide\",\"args\":[{\"literal\":{\"type\":\"integer\",\"value\":\"1\"}},{\"literal\":{\"type\":\"integer\",\"value\":\"8\"}}]}"), ExpressionEngine.Context.defaults());
    assertThat(result.state()).isEqualTo("available");
    assertThat(result.type()).isEqualTo("decimal");
    assertThat(result.value().asText()).isEqualTo("0.125");
    assertThat(engine.compile(json.readTree("{\"op\":\"eval\",\"args\":[]}")).code()).isEqualTo("UNSUPPORTED_OPERATOR");
  }
}
