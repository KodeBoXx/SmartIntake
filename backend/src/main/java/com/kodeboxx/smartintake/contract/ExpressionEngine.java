package com.kodeboxx.smartintake.contract;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Typed, deterministic implementation of the Lite 4.0.0 expression contract.
 *
 * <p>The compiler only accepts the closed expression grammar. Evaluation receives an explicit frozen
 * context and never observes a machine clock or default time zone. The public result deliberately
 * contains only stable contract fields; callers add safe diagnostic pointers at their boundary.
 */
public final class ExpressionEngine {
  private static final Set<String> OPERATORS = Set.of(
      "and", "or", "not", "eq", "ne", "lt", "lte", "gt", "gte", "in", "contains",
      "containsAll", "exists", "isAnswered", "statusIs", "add", "subtract", "multiply",
      "divide", "round", "min", "max", "sum", "count", "any", "all", "concat", "length",
      "coalesce", "if", "dateDiffDays", "ageYears", "dateAddDays", "today");
  private static final Set<String> STATUSES = Set.of(
      "unanswered", "answered", "declined", "respondentNotApplicable", "notApplicable", "invalid");
  private static final Set<String> SCALAR_TYPES = Set.of(
      "text", "integer", "decimal", "boolean", "date", "time", "dateTime", "choice");
  private static final BigInteger MIN_INT64 = BigInteger.valueOf(Long.MIN_VALUE);
  private static final BigInteger MAX_INT64 = BigInteger.valueOf(Long.MAX_VALUE);

  public static Set<String> operators() {
    return OPERATORS;
  }

  /** Legacy constructor input remains supported for FormRuntime. Values are typed literal nodes. */
  public record Context(Map<String, JsonNode> fields, String sessionDate, String sessionTimeZone, int stepLimit) {
    public Context {
      fields = fields == null ? Map.of() : Map.copyOf(fields);
      sessionDate = sessionDate == null ? "2026-09-05" : sessionDate;
      sessionTimeZone = sessionTimeZone == null ? "UTC" : sessionTimeZone;
      stepLimit = stepLimit <= 0 ? 100_000 : stepLimit;
    }

    public static Context defaults() {
      return new Context(Map.of(), "2026-09-05", "UTC", 100_000);
    }
  }

  public record Result(String state, String type, JsonNode value, String reason, String code) {
    static Result available(String type, JsonNode value) {
      return new Result("available", type, value, null, null);
    }

    static Result unknown(String reason) {
      return new Result("unknown", null, null, reason, null);
    }

    static Result error(String code) {
      return new Result("error", null, null, null, code);
    }
  }

  /** Builds a strict evaluation context from the normative vector fixture projection. */
  public static EvaluationContext projection(JsonNode definitions, JsonNode answers, String sessionDate,
      String sessionTimeZone, int stepLimit) {
    Map<String, Field> fields = fields(definitions);
    return new EvaluationContext(fields, cells(answers), sessionDate, sessionTimeZone, stepLimit, true);
  }

  /** A typed compile result, useful to callers that compile against a package field registry. */
  public Result compile(JsonNode expression) {
    try {
      compileTop(expression, new CompileEnv(Map.of(), List.of(), false));
      return Result.available("compiled", null);
    } catch (ExpressionFailure failure) {
      return Result.error(failure.code);
    }
  }

  public Result compile(JsonNode expression, EvaluationContext context) {
    try {
      compileTop(expression, new CompileEnv(context.fields, List.of(), context.strict));
      return Result.available("compiled", null);
    } catch (ExpressionFailure failure) {
      return Result.error(failure.code);
    }
  }

  public Result evaluate(JsonNode expression, Context context) {
    EvaluationContext typed = legacy(context);
    return evaluate(expression, typed);
  }

  public Result evaluate(JsonNode expression, EvaluationContext context) {
    try {
      Expr compiled = compileTop(expression, new CompileEnv(context.fields, List.of(), context.strict));
      validateFrozenContext(context);
      Value value = evaluate(compiled, new RuntimeEnv(context.rootCells, List.of(), context), new Counter(context.stepLimit));
      return Result.available(value.type, value.node);
    } catch (UnknownValue unknown) {
      return Result.unknown(unknown.reason);
    } catch (ExpressionFailure failure) {
      return Result.error(failure.code);
    }
  }

  /** Full context is intentionally separate from the legacy Context shape. */
  public static final class EvaluationContext {
    private final Map<String, Field> fields;
    private final Map<String, Cell> rootCells;
    private final String sessionDate;
    private final String sessionTimeZone;
    private final int stepLimit;
    private final boolean strict;

    private EvaluationContext(Map<String, Field> fields, Map<String, Cell> rootCells, String sessionDate,
        String sessionTimeZone, int stepLimit, boolean strict) {
      this.fields = Map.copyOf(fields);
      this.rootCells = Map.copyOf(rootCells);
      this.sessionDate = sessionDate == null ? "2026-09-05" : sessionDate;
      this.sessionTimeZone = sessionTimeZone == null ? "UTC" : sessionTimeZone;
      this.stepLimit = stepLimit <= 0 ? 100_000 : stepLimit;
      this.strict = strict;
    }
  }

  private sealed interface Expr permits LiteralExpr, RefExpr, ContextExpr, OperationExpr {
    String type();
  }

  private record LiteralExpr(Value value) implements Expr {
    @Override public String type() { return value.type; }
  }

  private record RefExpr(String fieldId, String scope, int parentDepth, String type, Field field) implements Expr {}
  private record ContextExpr(String name, String type) implements Expr {}
  private record OperationExpr(String op, List<Expr> args, String type, Field aggregateList) implements Expr {}
  private record Value(String type, JsonNode node) {}
  private record Field(String id, String type, Map<String, Field> itemFields) {}
  private record Cell(String type, String status, boolean applicable, JsonNode value) {}
  private record CompileEnv(Map<String, Field> root, List<Map<String, Field>> itemScopes, boolean strict) {}
  private record RuntimeEnv(Map<String, Cell> root, List<Map<String, Cell>> itemScopes, EvaluationContext context) {}

  private static final class ExpressionFailure extends RuntimeException {
    private final String code;
    private ExpressionFailure(String code) { this.code = code; }
  }

  private static final class UnknownValue extends RuntimeException {
    private final String reason;
    private UnknownValue(String reason) { this.reason = reason; }
  }

  private static final class Counter {
    private int remaining;
    private Counter(int remaining) { this.remaining = remaining; }
    private void step() { if (remaining-- <= 0) throw fail("EVALUATION_BUDGET"); }
  }

  private Expr compileTop(JsonNode node, CompileEnv env) {
    Expr expression = compile(node, env);
    // Arrays are typed operand values in this profile; a bare array cannot be a calculated scalar result.
    // This keeps EXPR-056's declared homogeneous-array rejection distinct from membership/length arrays.
    if (expression instanceof LiteralExpr && expression.type().startsWith("array:")) throw fail("INVALID_LITERAL");
    return expression;
  }

  private Expr compile(JsonNode node, CompileEnv env) {
    if (node == null || !node.isObject()) throw fail("EXPR_SHAPE");
    if (node.has("literal")) return literal(node);
    if (node.has("ref")) return reference(node, env);
    if (node.has("context")) return context(node);
    if (!node.has("op") || !node.has("args") || node.size() != 2 || !node.path("op").isTextual()
        || !node.path("args").isArray()) throw fail("EXPR_SHAPE");
    String op = node.path("op").asText();
    if (!OPERATORS.contains(op)) throw fail("UNSUPPORTED_OPERATOR");
    if (node.path("args").size() > 100 || !arity(op, node.path("args").size())) throw fail("EXPR_ARITY");

    List<Expr> args = new ArrayList<>();
    if (Set.of("sum", "any", "all").contains(op)) {
      Expr list = compile(node.path("args").get(0), env);
      if (!"list".equals(list.type()) || !(list instanceof RefExpr listRef)) throw fail("EXPR_TYPE");
      Field aggregateList = listRef.field;
      args.add(list);
      args.add(compile(node.path("args").get(1), nested(env, aggregateList)));
      String itemType = args.get(1).type();
      if ("sum".equals(op) && !numeric(itemType)) throw fail("EXPR_TYPE");
      if (("any".equals(op) || "all".equals(op)) && !"boolean".equals(itemType)) throw fail("EXPR_TYPE");
      return new OperationExpr(op, List.copyOf(args), "sum".equals(op) ? "decimal" : "boolean", aggregateList);
    }
    for (JsonNode arg : node.path("args")) args.add(compile(arg, env));
    return new OperationExpr(op, List.copyOf(args), operatorType(op, args), null);
  }

  private static CompileEnv nested(CompileEnv env, Field list) {
    List<Map<String, Field>> scopes = new ArrayList<>(env.itemScopes);
    scopes.add(list.itemFields);
    return new CompileEnv(env.root, List.copyOf(scopes), env.strict);
  }

  private Expr literal(JsonNode node) {
    if (node.size() != 1 || !node.path("literal").isObject()) throw fail("EXPR_SHAPE");
    JsonNode literal = node.path("literal");
    String type = literal.path("type").asText(null);
    if ("array".equals(type)) {
      if (literal.size() != 3 || !literal.path("itemType").isTextual() || !literal.path("value").isArray()
          || !SCALAR_TYPES.contains(literal.path("itemType").asText())) throw fail("EXPR_SHAPE");
      String itemType = literal.path("itemType").asText();
      try {
        for (JsonNode value : literal.path("value")) validateLiteral(itemType, value);
      } catch (ExpressionFailure failure) {
        // Array members are a homogeneous aggregate; malformed members have no scalar wire-code.
        throw fail("INVALID_LITERAL");
      }
      return new LiteralExpr(new Value("array:" + itemType, literal.path("value").deepCopy()));
    }
    if (literal.size() != 2 || !SCALAR_TYPES.contains(type) || literal.path("value").isNull()) throw fail("EXPR_SHAPE");
    JsonNode value = literal.path("value");
    validateLiteral(type, value);
    return new LiteralExpr(new Value(type, canonical(type, value)));
  }

  private Expr reference(JsonNode node, CompileEnv env) {
    JsonNode ref = node.path("ref");
    if (node.size() != 1 || !ref.isObject() || ref.size() < 1 || ref.size() > 3 || !ref.path("fieldId").isTextual()) {
      throw fail("EXPR_SHAPE");
    }
    String scope = ref.path("scope").asText("root");
    int parentDepth = ref.has("parentDepth") ? ref.path("parentDepth").asInt(-1) : 1;
    if (!Set.of("root", "item", "parentItem").contains(scope)) throw fail("EXPR_SCOPE");
    if (("root".equals(scope) || "item".equals(scope)) && ref.has("parentDepth")) throw fail("EXPR_SCOPE");
    if ("parentItem".equals(scope) && (!ref.path("parentDepth").isIntegralNumber() || parentDepth < 1 || parentDepth > 3)) {
      throw fail("EXPR_SCOPE");
    }
    Map<String, Field> available = switch (scope) {
      case "root" -> env.root;
      case "item" -> env.itemScopes.isEmpty() ? Map.of() : env.itemScopes.get(env.itemScopes.size() - 1);
      default -> env.itemScopes.size() <= parentDepth ? Map.of()
          : env.itemScopes.get(env.itemScopes.size() - 1 - parentDepth);
    };
    Field field = available.get(ref.path("fieldId").asText());
    if (field == null) {
      if (env.strict || !env.root.isEmpty()) throw fail("EXPR_SCOPE");
      // Legacy FormRuntime has no field registry. Preserve prior dynamic references as unknown text.
      field = new Field(ref.path("fieldId").asText(), "text", Map.of());
    }
    return new RefExpr(field.id, scope, parentDepth, field.type, field);
  }

  private Expr context(JsonNode node) {
    if (node.size() != 1 || !node.path("context").isTextual()) throw fail("EXPR_SHAPE");
    return switch (node.path("context").asText()) {
      case "sessionDate" -> new ContextExpr("sessionDate", "date");
      case "sessionTimeZone" -> new ContextExpr("sessionTimeZone", "text");
      default -> throw fail("UNSUPPORTED_CONTEXT");
    };
  }

  private String operatorType(String op, List<Expr> a) {
    return switch (op) {
      case "and", "or" -> { requireAll(a, "boolean"); yield "boolean"; }
      case "not" -> { require(a.get(0), "boolean"); yield "boolean"; }
      case "eq", "ne" -> { if (!scalarComparable(a.get(0).type(), a.get(1).type(), true)) throw fail("EXPR_TYPE"); yield "boolean"; }
      case "lt", "lte", "gt", "gte" -> { if (!orderedComparable(a.get(0).type(), a.get(1).type())) throw fail("EXPR_TYPE"); yield "boolean"; }
      case "in" -> { if (!arrayContains(a.get(1).type(), a.get(0).type())) throw fail("EXPR_TYPE"); yield "boolean"; }
      case "contains" -> { if (!arrayContains(a.get(0).type(), a.get(1).type())) throw fail("EXPR_TYPE"); yield "boolean"; }
      case "containsAll" -> { if (!arrayCompatible(a.get(0).type(), a.get(1).type())) throw fail("EXPR_TYPE"); yield "boolean"; }
      case "exists", "isAnswered" -> { if (!(a.get(0) instanceof RefExpr)) throw fail("EXPR_TYPE"); yield "boolean"; }
      case "statusIs" -> {
        if (!(a.get(0) instanceof RefExpr) || !(a.get(1) instanceof LiteralExpr literal) || !"text".equals(a.get(1).type())
            || !STATUSES.contains(literal.value.node.textValue())) throw fail("INVALID_STATUS");
        yield "boolean";
      }
      case "add", "subtract", "multiply", "divide" -> {
        requireNumeric(a); if ("divide".equals(op) && literalZero(a.get(1))) throw fail("DIVIDE_BY_ZERO"); yield "decimal";
      }
      case "round" -> {
        require(a.get(0), "integer", "decimal"); require(a.get(1), "integer");
        if (a.get(1) instanceof LiteralExpr literal && scale(literal.value()) < 0) throw fail("INVALID_SCALE");
        yield "decimal";
      }
      case "min", "max" -> { requireNumeric(a); yield "decimal"; }
      case "count" -> { require(a.get(0), "list"); yield "integer"; }
      case "concat" -> { requireAll(a, "text"); yield "text"; }
      case "length" -> { if (!"text".equals(a.get(0).type()) && !a.get(0).type().startsWith("array:")) throw fail("EXPR_TYPE"); yield "integer"; }
      case "coalesce" -> unified(a);
      case "if" -> { require(a.get(0), "boolean"); yield unified(a.subList(1, 3)); }
      case "dateDiffDays", "ageYears" -> { require(a.get(0), "date"); require(a.get(1), "date"); yield "integer"; }
      case "dateAddDays" -> { require(a.get(0), "date"); require(a.get(1), "integer"); yield "date"; }
      case "today" -> "date";
      default -> throw fail("UNSUPPORTED_OPERATOR");
    };
  }

  private Value evaluate(Expr expression, RuntimeEnv environment, Counter counter) {
    counter.step();
    if (expression instanceof LiteralExpr literal) return literal.value;
    if (expression instanceof ContextExpr context) return contextValue(context, environment.context);
    if (expression instanceof RefExpr reference) return referenceValue(reference, environment);
    OperationExpr op = (OperationExpr) expression;
    return switch (op.op) {
      case "if" -> evaluateIf(op, environment, counter);
      case "coalesce" -> evaluateCoalesce(op, environment, counter);
      case "and", "or" -> evaluateBooleanFold(op, environment, counter);
      case "sum", "count", "any", "all" -> evaluateAggregate(op, environment, counter);
      default -> evaluateStrict(op, environment, counter);
    };
  }

  private Value evaluateIf(OperationExpr op, RuntimeEnv env, Counter counter) {
    try {
      Value condition = evaluate(op.args.get(0), env, counter);
      Value selected = evaluate(bool(condition) ? op.args.get(1) : op.args.get(2), env, counter);
      return promoted(selected, op.type);
    } catch (UnknownValue ignored) {
      throw unknown("UNKNOWN_CONDITION");
    }
  }

  private Value evaluateCoalesce(OperationExpr op, RuntimeEnv env, Counter counter) {
    for (Expr arg : op.args) {
      try { return promoted(evaluate(arg, env, counter), op.type); }
      catch (UnknownValue ignored) { /* next alternative */ }
    }
    throw unknown("UNAVAILABLE_OPERAND");
  }

  private Value evaluateBooleanFold(OperationExpr op, RuntimeEnv env, Counter counter) {
    boolean and = "and".equals(op.op);
    boolean unknown = false;
    for (Expr arg : op.args) {
      try {
        boolean current = bool(evaluate(arg, env, counter));
        if (and && !current) return booleanValue(false);
        if (!and && current) return booleanValue(true);
      } catch (UnknownValue ignored) { unknown = true; }
    }
    if (unknown) throw unknown("UNAVAILABLE_OPERAND");
    return booleanValue(and);
  }

  private Value evaluateAggregate(OperationExpr op, RuntimeEnv env, Counter counter) {
    Value listValue;
    try { listValue = evaluate(op.args.get(0), env, counter); }
    catch (UnknownValue unknown) { throw unknown("UNAVAILABLE_OPERAND"); }
    JsonNode items = listValue.node.path("items");
    if (!items.isArray()) throw fail("INVALID_LITERAL");
    if ("count".equals(op.op)) return integerValue(BigInteger.valueOf(items.size()));
    if ("sum".equals(op.op)) {
      BigDecimal total = BigDecimal.ZERO;
      boolean unavailable = false;
      for (JsonNode item : items) {
        try { total = total.add(decimal(evaluate(op.args.get(1), itemEnv(item, env), counter))); }
        catch (UnknownValue ignored) { unavailable = true; }
      }
      if (unavailable) throw unknown("UNAVAILABLE_AGGREGATE_ITEM");
      return decimalValue(total);
    }
    boolean any = "any".equals(op.op);
    boolean unavailable = false;
    for (JsonNode item : items) {
      try {
        boolean predicate = bool(evaluate(op.args.get(1), itemEnv(item, env), counter));
        if (any && predicate) return booleanValue(true);
        if (!any && !predicate) return booleanValue(false);
      } catch (UnknownValue ignored) { unavailable = true; }
    }
    if (unavailable) throw unknown("UNAVAILABLE_AGGREGATE_ITEM");
    return booleanValue(!any);
  }

  private RuntimeEnv itemEnv(JsonNode item, RuntimeEnv parent) {
    List<Map<String, Cell>> scopes = new ArrayList<>(parent.itemScopes);
    scopes.add(cells(item.path("fields")));
    return new RuntimeEnv(parent.root, List.copyOf(scopes), parent.context);
  }

  private Value evaluateStrict(OperationExpr op, RuntimeEnv env, Counter counter) {
    // Predicate operators inspect authoritative cell metadata; unavailable references are false/status,
    // not Unknown. Their reference AST still incurs exactly one evaluated step.
    if ("exists".equals(op.op) || "isAnswered".equals(op.op)) {
      counter.step();
      return booleanValue(answered((RefExpr) op.args.get(0), env));
    }
    if ("statusIs".equals(op.op)) {
      counter.step();
      counter.step();
      return booleanValue(status((RefExpr) op.args.get(0), env).equals(((LiteralExpr) op.args.get(1)).value.node.textValue()));
    }
    List<Value> values = new ArrayList<>();
    boolean unavailable = false;
    for (Expr arg : op.args) {
      try { values.add(evaluate(arg, env, counter)); }
      catch (UnknownValue ignored) { unavailable = true; values.add(null); }
    }
    // Strict operators evaluate every operand: a later evaluated error outranks an earlier Unknown.
    if (unavailable) throw unknown("UNAVAILABLE_OPERAND");
    try {
      return switch (op.op) {
        case "not" -> booleanValue(!bool(values.get(0)));
        case "eq" -> booleanValue(equal(values.get(0), values.get(1)));
        case "ne" -> booleanValue(!equal(values.get(0), values.get(1)));
        case "lt", "lte", "gt", "gte" -> comparison(op.op, values.get(0), values.get(1));
        case "in" -> booleanValue(contains(values.get(1), values.get(0)));
        case "contains" -> booleanValue(contains(values.get(0), values.get(1)));
        case "containsAll" -> containsAll(values.get(0), values.get(1));
        case "exists", "isAnswered" -> booleanValue(answered((RefExpr) op.args.get(0), env));
        case "statusIs" -> booleanValue(status((RefExpr) op.args.get(0), env).equals(values.get(1).node.textValue()));
        case "add" -> decimalValue(decimal(values.get(0)).add(decimal(values.get(1))));
        case "subtract" -> decimalValue(decimal(values.get(0)).subtract(decimal(values.get(1))));
        case "multiply" -> decimalValue(decimal(values.get(0)).multiply(decimal(values.get(1))));
        case "divide" -> divide(values.get(0), values.get(1));
        case "round" -> {
          int places = scale(values.get(1));
          if (places < 0) throw fail("INVALID_SCALE");
          yield decimalValue(decimal(values.get(0)).setScale(places, RoundingMode.HALF_EVEN));
        }
        case "min" -> extrema(values, true);
        case "max" -> extrema(values, false);
        case "concat" -> concat(values);
        case "length" -> length(values.get(0));
        case "dateDiffDays" -> integerValue(BigInteger.valueOf(ChronoUnit.DAYS.between(date(values.get(0)), date(values.get(1)))));
        case "ageYears" -> age(values.get(0), values.get(1));
        case "dateAddDays" -> dateAdd(values.get(0), values.get(1));
        case "today" -> contextValue(new ContextExpr("sessionDate", "date"), env.context);
        default -> throw fail("UNSUPPORTED_OPERATOR");
      };
    } catch (ExpressionFailure failure) { throw failure; }
      catch (ArithmeticException exception) { throw fail("CALC_PRECISION"); }
      catch (RuntimeException exception) { throw fail("INVALID_LITERAL"); }
  }

  private static Value contextValue(ContextExpr expression, EvaluationContext context) {
    return switch (expression.name) {
      case "sessionDate" -> new Value("date", JsonNodeFactory.instance.textNode(context.sessionDate));
      case "sessionTimeZone" -> new Value("text", JsonNodeFactory.instance.textNode(context.sessionTimeZone));
      default -> throw fail("UNSUPPORTED_CONTEXT");
    };
  }

  private static Value referenceValue(RefExpr expression, RuntimeEnv environment) {
    Cell cell = cell(expression, environment);
    if (!cell.applicable || !"answered".equals(cell.status) || cell.value == null || cell.value.isMissingNode()) {
      throw unknown("UNAVAILABLE_OPERAND");
    }
    return new Value(expression.type, canonical(expression.type, cell.value));
  }

  private static Cell cell(RefExpr expression, RuntimeEnv environment) {
    Map<String, Cell> values = switch (expression.scope) {
      case "root" -> environment.root;
      case "item" -> environment.itemScopes.isEmpty() ? Map.of() : environment.itemScopes.get(environment.itemScopes.size() - 1);
      default -> environment.itemScopes.size() <= expression.parentDepth ? Map.of()
          : environment.itemScopes.get(environment.itemScopes.size() - 1 - expression.parentDepth);
    };
    return values.getOrDefault(expression.fieldId, new Cell(expression.type, "unanswered", true, null));
  }

  private static boolean answered(RefExpr expression, RuntimeEnv environment) {
    Cell cell = cell(expression, environment);
    return cell.applicable && "answered".equals(cell.status) && cell.value != null;
  }

  private static String status(RefExpr expression, RuntimeEnv environment) {
    Cell cell = cell(expression, environment);
    return cell.applicable ? cell.status : "notApplicable";
  }

  private static Value divide(Value left, Value right) {
    BigDecimal divisor = decimal(right);
    if (divisor.signum() == 0) throw fail("DIVIDE_BY_ZERO");
    try { return decimalValue(decimal(left).divide(divisor)); }
    catch (ArithmeticException exception) { throw fail("CALC_PRECISION"); }
  }

  private static Value extrema(List<Value> values, boolean min) {
    BigDecimal selected = decimal(values.get(0));
    for (int index = 1; index < values.size(); index++) {
      BigDecimal next = decimal(values.get(index));
      if ((min && next.compareTo(selected) < 0) || (!min && next.compareTo(selected) > 0)) selected = next;
    }
    return decimalValue(selected);
  }

  private static Value concat(List<Value> values) {
    StringBuilder text = new StringBuilder();
    for (Value value : values) text.append(value.node.textValue());
    return new Value("text", JsonNodeFactory.instance.textNode(text.toString()));
  }

  private static Value length(Value value) {
    int length = value.node.isTextual()
        ? value.node.textValue().codePointCount(0, value.node.textValue().length()) : value.node.size();
    return integerValue(BigInteger.valueOf(length));
  }

  private static Value age(Value birth, Value asOf) {
    LocalDate start = date(birth), end = date(asOf);
    if (end.isBefore(start)) throw fail("DATE_RANGE");
    int years = end.getYear() - start.getYear();
    LocalDate anniversary = start.plusYears(years);
    // java.time selects February 28 for leap-day plusYears; the contract pins March 1 instead.
    if (start.getMonthValue() == 2 && start.getDayOfMonth() == 29 && !end.isLeapYear()) anniversary = LocalDate.of(end.getYear(), 3, 1);
    if (end.isBefore(anniversary)) years--;
    return integerValue(BigInteger.valueOf(years));
  }

  private static Value dateAdd(Value start, Value days) {
    try {
      LocalDate result = date(start).plusDays(integer(days).longValueExact());
      if (result.getYear() < 1 || result.getYear() > 9999) throw fail("DATE_RANGE");
      return new Value("date", JsonNodeFactory.instance.textNode(result.toString()));
    } catch (java.time.DateTimeException exception) { throw fail("DATE_RANGE"); }
  }

  private static Value comparison(String operation, Value left, Value right) {
    int compared;
    if (numeric(left.type)) compared = decimal(left).compareTo(decimal(right));
    else if ("dateTime".equals(left.type)) compared = instant(left).compareTo(instant(right));
    else if ("date".equals(left.type)) compared = date(left).compareTo(date(right));
    else compared = time(left).compareTo(time(right));
    return booleanValue(switch (operation) {
      case "lt" -> compared < 0;
      case "lte" -> compared <= 0;
      case "gt" -> compared > 0;
      default -> compared >= 0;
    });
  }

  private static boolean equal(Value left, Value right) {
    if (numeric(left.type)) return decimal(left).compareTo(decimal(right)) == 0;
    if ("dateTime".equals(left.type)) return instant(left).equals(instant(right));
    return left.node.equals(right.node);
  }

  private static boolean contains(Value array, Value item) {
    String itemType = array.type.substring("array:".length());
    for (JsonNode member : array.node) if (equal(new Value(itemType, canonical(itemType, member)), item)) return true;
    return false;
  }

  private static Value containsAll(Value left, Value right) {
    String itemType = right.type.substring("array:".length());
    for (JsonNode member : right.node) if (!contains(left, new Value(itemType, canonical(itemType, member)))) return booleanValue(false);
    return booleanValue(true);
  }

  private static String unified(List<Expr> expressions) {
    String type = expressions.get(0).type();
    for (int index = 1; index < expressions.size(); index++) {
      String next = expressions.get(index).type();
      if (type.equals(next)) continue;
      if (numeric(type) && numeric(next)) { type = "decimal"; continue; }
      if (arrayCompatible(type, next)) { type = "array:" + unifiedArrayItem(type.substring(6), next.substring(6)); continue; }
      throw fail("EXPR_TYPE");
    }
    return type;
  }

  private static String unifiedArrayItem(String left, String right) {
    if (left.equals(right)) return left;
    if (numeric(left) && numeric(right)) return "decimal";
    throw fail("EXPR_TYPE");
  }

  private static boolean arity(String op, int size) {
    return switch (op) {
      case "today" -> size == 0;
      case "not", "exists", "isAnswered", "count", "length" -> size == 1;
      case "eq", "ne", "lt", "lte", "gt", "gte", "in", "contains", "containsAll", "statusIs",
          "add", "subtract", "multiply", "divide", "round", "sum", "any", "all", "dateDiffDays",
          "ageYears", "dateAddDays" -> size == 2;
      case "if" -> size == 3;
      default -> size >= 2 && size <= 100;
    };
  }

  private static boolean numeric(String type) { return "integer".equals(type) || "decimal".equals(type); }
  private static boolean scalarComparable(String left, String right, boolean equality) {
    return SCALAR_TYPES.contains(left) && SCALAR_TYPES.contains(right)
        && ((numeric(left) && numeric(right)) || left.equals(right));
  }
  private static boolean orderedComparable(String left, String right) {
    return (numeric(left) && numeric(right)) || (left.equals(right) && Set.of("date", "time", "dateTime").contains(left));
  }
  private static boolean arrayContains(String array, String item) {
    return array.startsWith("array:") && scalarComparable(array.substring(6), item, true);
  }
  private static boolean arrayCompatible(String left, String right) {
    return left.startsWith("array:") && right.startsWith("array:")
        && scalarComparable(left.substring(6), right.substring(6), true);
  }
  private static void require(Expr expression, String... types) {
    for (String type : types) if (type.equals(expression.type())) return;
    throw fail("EXPR_TYPE");
  }
  private static void requireAll(List<Expr> expressions, String type) { for (Expr expression : expressions) require(expression, type); }
  private static void requireNumeric(List<Expr> expressions) { for (Expr expression : expressions) if (!numeric(expression.type())) throw fail("EXPR_TYPE"); }
  private static boolean literalZero(Expr expression) { return expression instanceof LiteralExpr literal && numeric(literal.type()) && decimal(literal.value()).signum() == 0; }
  private static Value promoted(Value value, String target) { return "decimal".equals(target) && "integer".equals(value.type) ? decimalValue(decimal(value)) : value; }
  private static boolean bool(Value value) { return value.node.booleanValue(); }
  private static BigDecimal decimal(Value value) { return new BigDecimal(value.node.textValue()); }
  private static BigInteger integer(Value value) { return new BigInteger(value.node.textValue()); }
  private static LocalDate date(Value value) { return LocalDate.parse(value.node.textValue()); }
  private static LocalTime time(Value value) { return LocalTime.parse(value.node.textValue()); }
  private static java.time.Instant instant(Value value) { return OffsetDateTime.parse(value.node.path("instant").textValue()).toInstant(); }
  private static int scale(Value value) {
    try {
      int scale = integer(value).intValueExact();
      return scale >= 0 && scale <= 12 ? scale : -1;
    } catch (ArithmeticException exception) { return -1; }
  }
  private static Value booleanValue(boolean value) { return new Value("boolean", JsonNodeFactory.instance.booleanNode(value)); }
  private static Value integerValue(BigInteger value) {
    if (value.compareTo(MIN_INT64) < 0 || value.compareTo(MAX_INT64) > 0) throw fail("INTEGER_RANGE");
    return new Value("integer", JsonNodeFactory.instance.textNode(value.toString()));
  }
  private static Value decimalValue(BigDecimal value) {
    try { ContractValue.validateDecimal(value); }
    catch (ContractValue.ContractException exception) { throw fail(exception.code()); }
    return new Value("decimal", JsonNodeFactory.instance.textNode(ContractValue.canonicalDecimal(value)));
  }

  private static void validateLiteral(String type, JsonNode value) {
    try {
      if ("dateTime".equals(type)) {
        if (!value.isObject() || value.size() != 2 || !value.path("instant").isTextual() || !value.path("timeZone").isTextual()
            || !value.path("instant").textValue().matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?Z")) throw fail("INVALID_LITERAL");
        OffsetDateTime.parse(value.path("instant").textValue());
        try { ZoneId.of(value.path("timeZone").textValue()); } catch (RuntimeException exception) { throw fail("INVALID_TIMEZONE"); }
      } else ContractValue.validate(type, value);
    } catch (ExpressionFailure failure) { throw failure; }
      catch (ContractValue.ContractException exception) { throw fail(exception.code()); }
      catch (RuntimeException exception) { throw fail("INVALID_LITERAL"); }
  }

  private static JsonNode canonical(String type, JsonNode value) {
    if ("integer".equals(type)) return JsonNodeFactory.instance.textNode(new BigInteger(value.textValue()).toString());
    if ("decimal".equals(type)) return JsonNodeFactory.instance.textNode(ContractValue.canonicalDecimal(new BigDecimal(value.textValue())));
    return value.deepCopy();
  }

  private static Map<String, Field> fields(JsonNode definitions) {
    Map<String, Field> result = new LinkedHashMap<>();
    if (!definitions.isArray()) return result;
    for (JsonNode definition : definitions) {
      String id = definition.path("id").asText();
      String type = definition.path("type").asText();
      if (id.isBlank() || type.isBlank()) continue;
      result.put(id, new Field(id, type, fields(definition.path("itemFields"))));
    }
    return result;
  }

  private static Map<String, Cell> cells(JsonNode input) {
    Map<String, Cell> result = new LinkedHashMap<>();
    if (!input.isObject()) return result;
    input.fields().forEachRemaining(entry -> {
      JsonNode answer = entry.getValue();
      if (answer.isObject() && answer.has("status")) {
        result.put(entry.getKey(), new Cell(answer.path("type").asText(), answer.path("status").asText("unanswered"),
            answer.path("applicable").asBoolean(true), answer.get("value")));
      }
    });
    return result;
  }

  private static EvaluationContext legacy(Context context) {
    Map<String, Field> fields = new LinkedHashMap<>();
    Map<String, Cell> cells = new LinkedHashMap<>();
    context.fields().forEach((id, expression) -> {
      try {
        JsonNode literal = expression.path("literal");
        String type = literal.path("type").asText("text");
        fields.put(id, new Field(id, type, Map.of()));
        cells.put(id, new Cell(type, "answered", true, literal.get("value")));
      } catch (RuntimeException ignored) { /* unavailable legacy value */ }
    });
    return new EvaluationContext(fields, cells, context.sessionDate(), context.sessionTimeZone(), context.stepLimit(), false);
  }

  private static void validateFrozenContext(EvaluationContext context) {
    try {
      LocalDate date = LocalDate.parse(context.sessionDate);
      if (date.getYear() < 1 || date.getYear() > 9999) throw fail("INVALID_LITERAL");
      ZoneId.of(context.sessionTimeZone);
    } catch (ExpressionFailure failure) { throw failure; }
      catch (RuntimeException exception) { throw fail("INVALID_TIMEZONE"); }
  }

  private static ExpressionFailure fail(String code) { return new ExpressionFailure(code); }
  private static UnknownValue unknown(String reason) { return new UnknownValue(reason); }
}
