package com.kodeboxx.smartintake.contract;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.regex.Pattern;

/** Strict wire-value validation for the Lite 4.0.0 contract. */
public final class ContractValue {
  public static final String VERSION = "4.0.0";
  private static final Pattern INTEGER = Pattern.compile("0|-?[1-9][0-9]*");
  private static final Pattern DECIMAL = Pattern.compile("-?(0|[1-9][0-9]*)(\\.[0-9]+)?");
  private static final BigInteger MIN_INT64 = BigInteger.valueOf(Long.MIN_VALUE);
  private static final BigInteger MAX_INT64 = BigInteger.valueOf(Long.MAX_VALUE);

  private ContractValue() {}

  public static String integer(JsonNode value) {
    if (!value.isTextual() || !INTEGER.matcher(value.textValue()).matches()) throw error("INTEGER_ENCODING");
    BigInteger parsed = new BigInteger(value.textValue());
    if (parsed.compareTo(MIN_INT64) < 0 || parsed.compareTo(MAX_INT64) > 0) throw error("INTEGER_RANGE");
    return value.textValue();
  }

  public static String decimal(JsonNode value) {
    if (!value.isTextual() || !DECIMAL.matcher(value.textValue()).matches()) throw error("INVALID_LITERAL");
    BigDecimal parsed = new BigDecimal(value.textValue());
    validateDecimal(parsed);
    return canonicalDecimal(parsed);
  }

  public static void validate(String type, JsonNode value) {
    switch (type) {
      case "integer" -> integer(value);
      case "decimal" -> decimal(value);
      case "text", "choice" -> { if (!value.isTextual()) throw error("INVALID_LITERAL"); }
      case "boolean" -> { if (!value.isBoolean()) throw error("INVALID_LITERAL"); }
      case "date" -> { try { if (!value.isTextual()) throw error("INVALID_LITERAL"); LocalDate.parse(value.textValue()); } catch (RuntimeException e) { throw error("INVALID_LITERAL"); } }
      case "time" -> { try { if (!value.isTextual() || !value.textValue().matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]{1,9})?")) throw error("INVALID_LITERAL"); LocalTime.parse(value.textValue()); } catch (RuntimeException e) { throw error("INVALID_LITERAL"); } }
      default -> throw error("EXPR_TYPE");
    }
  }

  public static void validateDecimal(BigDecimal value) {
    if (value.signum() == 0) return;
    BigDecimal stripped = value.stripTrailingZeros();
    if (stripped.precision() > 34) throw error("CALC_PRECISION");
    int adjustedExponent = stripped.precision() - 1 - stripped.scale();
    if (adjustedExponent < -6143 || adjustedExponent > 6144) throw error("CALC_OVERFLOW");
  }

  public static String canonicalDecimal(BigDecimal value) {
    if (value.signum() == 0) return "0";
    BigDecimal normalized = value.stripTrailingZeros();
    return normalized.toPlainString();
  }

  public static JsonNode canonicalNode(String type, Object value) {
    return switch (type) {
      case "integer" -> JsonNodeFactory.instance.textNode(new BigInteger(value.toString()).toString());
      case "decimal" -> JsonNodeFactory.instance.textNode(canonicalDecimal(new BigDecimal(value.toString())));
      default -> {
        if (value instanceof Boolean booleanValue) yield JsonNodeFactory.instance.booleanNode(booleanValue);
        if (value instanceof String stringValue) yield JsonNodeFactory.instance.textNode(stringValue);
        if (value instanceof Integer integerValue) yield JsonNodeFactory.instance.numberNode(integerValue);
        if (value instanceof Long longValue) yield JsonNodeFactory.instance.numberNode(longValue);
        yield JsonNodeFactory.instance.pojoNode(value);
      }
    };
  }

  public static ContractException error(String code) { return new ContractException(code); }

  public static final class ContractException extends IllegalArgumentException {
    private final String code;
    public ContractException(String code) { super(code); this.code = code; }
    public String code() { return code; }
  }
}
