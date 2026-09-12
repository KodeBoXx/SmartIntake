package com.kodeboxx.smartintake.contract;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.Period;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Closed, side-effect-free evaluator for the scalar Lite expression subset.
 * It never reads wall-clock, network, host timezone, or executable code.
 */
public final class ExpressionEngine {
  private static final MathContext DECIMAL_CONTEXT = new MathContext(34, RoundingMode.HALF_EVEN);
  private static final Set<String> OPS = Set.of("and","or","not","if","coalesce","eq","ne","gt","gte","lt","lte","add","subtract","multiply","divide","round","min","max","in","contains","containsAll","concat","length","exists","isAnswered","statusIs","dateDiffDays","ageYears","dateAddDays");
  public record Context(Map<String, JsonNode> fields, String sessionDate, String sessionTimeZone, int stepLimit) {
    public Context { fields = fields == null ? Map.of() : Map.copyOf(fields); stepLimit = stepLimit <= 0 ? 100_000 : stepLimit; }
    public static Context defaults() { return new Context(Map.of(), "2026-09-05", "UTC", 100_000); }
  }
  public record Result(String state, String type, JsonNode value, String reason, String code) {
    static Result value(String type, JsonNode value) { return new Result("available", type, value, null, null); }
    static Result unknown(String reason) { return new Result("unknown", null, null, reason, null); }
    static Result error(String code) { return new Result("error", null, null, null, code); }
  }

  public Result compile(JsonNode expression) { return visit(expression, Context.defaults(), new Counter(20), true); }
  public Result evaluate(JsonNode expression, Context context) { return visit(expression, context, new Counter(context.stepLimit()), false); }

  private Result visit(JsonNode node, Context context, Counter counter, boolean compileOnly) {
    if (!counter.step()) return Result.error("EVALUATION_BUDGET");
    if (node == null || !node.isObject()) return Result.error("EXPR_SHAPE");
    if (node.has("literal")) return literal(node);
    if (node.has("context")) return context(node, context);
    if (node.has("ref")) return reference(node, context);
    if (!node.has("op") || !node.has("args") || node.size() != 2 || !node.path("op").isTextual() || !node.path("args").isArray()) return Result.error("EXPR_SHAPE");
    String op = node.path("op").asText();
    if (!OPS.contains(op)) return Result.error("UNSUPPORTED_OPERATOR");
    List<JsonNode> args = new ArrayList<>(); node.path("args").forEach(args::add);
    if (args.size() > 100 || !arity(op, args.size())) return Result.error("EXPR_ARITY");
    List<Result> compiled = new ArrayList<>();
    for (JsonNode arg : args) { Result r = visit(arg, context, counter, true); if (r.code != null) return r; compiled.add(r); }
    Result types = typeCheck(op, compiled); if (types.code != null) return types;
    if (compileOnly) return Result.value(types.type, null);
    return execute(op, args, context, counter, types.type);
  }

  private Result literal(JsonNode node) {
    if (node.size() != 1 || !node.path("literal").isObject()) return Result.error("EXPR_SHAPE");
    JsonNode literal = node.path("literal"); String type = literal.path("type").asText(null);
    try {
      if ("array".equals(type)) {
        if (literal.size()!=3 || !literal.path("itemType").isTextual() || !literal.path("value").isArray()) return Result.error("EXPR_SHAPE");
        String itemType=literal.path("itemType").asText(); for(JsonNode item: literal.path("value")) ContractValue.validate(itemType,item);
        return Result.value("array:"+itemType, literal.path("value"));
      }
      if (literal.size()!=2 || type==null || literal.path("value").isNull()) return Result.error("EXPR_SHAPE");
      ContractValue.validate(type, literal.path("value"));
      JsonNode value=literal.path("value");
      if ("decimal".equals(type)) value=ContractValue.canonicalNode(type, ContractValue.decimal(value));
      return Result.value(type,value);
    } catch (ContractValue.ContractException exception) { return Result.error(exception.code()); }
  }

  private Result context(JsonNode node, Context context) {
    if (node.size()!=1 || !node.path("context").isTextual()) return Result.error("EXPR_SHAPE");
    return switch(node.path("context").asText()) {
      case "sessionDate" -> Result.value("date", ContractValue.canonicalNode("text",context.sessionDate));
      case "sessionTimeZone" -> Result.value("text", ContractValue.canonicalNode("text",context.sessionTimeZone));
      default -> Result.error("UNSUPPORTED_CONTEXT");
    };
  }
  private Result reference(JsonNode node, Context context) {
    JsonNode ref=node.path("ref"); if(node.size()!=1 || !ref.isObject() || ref.size()<1 || !ref.path("fieldId").isTextual()) return Result.error("EXPR_SHAPE");
    if (ref.has("scope") && !"root".equals(ref.path("scope").asText())) return Result.error("EXPR_SCOPE");
    JsonNode value=context.fields().get(ref.path("fieldId").asText()); return value==null ? Result.unknown("UNAVAILABLE_OPERAND") : literal(value);
  }

  private Result execute(String op,List<JsonNode> raw,Context c,Counter counter,String type) {
    // Lazy operators revisit only branches selected at runtime; every branch was already compiled above.
    List<Result> values=new ArrayList<>();
    if ("if".equals(op)) { Result condition=visit(raw.get(0),c,counter,false); if(condition.code!=null)return condition; if(condition.reason!=null)return Result.unknown("UNKNOWN_CONDITION"); return visit(raw.get(Boolean.TRUE.equals(condition.value.booleanValue())?1:2),c,counter,false); }
    if ("coalesce".equals(op)) { for(JsonNode n:raw){Result r=visit(n,c,counter,false);if(r.code!=null)return r;if(r.reason==null)return r;}return Result.unknown("UNAVAILABLE_OPERAND"); }
    if ("and".equals(op)||"or".equals(op)) { boolean target="and".equals(op)?false:true; boolean unknown=false; for(JsonNode n:raw){Result r=visit(n,c,counter,false);if(r.code!=null)return r;if(r.reason!=null){unknown=true;continue;}if(r.value.booleanValue()==target)return bool(target);} return unknown?Result.unknown("UNAVAILABLE_OPERAND"):bool(!target); }
    for(JsonNode n:raw){Result r=visit(n,c,counter,false);if(r.code!=null)return r;if(r.reason!=null)return r;values.add(r);}
    try { return switch(op) {
      case "not" -> bool(!values.get(0).value.booleanValue());
      case "eq" -> bool(equal(values.get(0),values.get(1))); case "ne" -> bool(!equal(values.get(0),values.get(1)));
      case "gt","gte","lt","lte" -> compare(op,values.get(0),values.get(1));
      case "add","subtract","multiply","divide","min","max" -> numeric(op,values);
      case "round" -> decimal(decimal(values.get(0)).setScale(Integer.parseInt(ContractValue.integer(values.get(1).value)),RoundingMode.HALF_EVEN));
      case "in" -> bool(contains(values.get(1).value,values.get(0))); case "contains" -> bool(contains(values.get(0).value,values.get(1))); case "containsAll" -> containsAll(values);
      case "concat" -> Result.value("text", ContractValue.canonicalNode("text", values.stream().map(r->r.value.textValue()).reduce("",String::concat)));
      case "length" -> integer(values.get(0).value.isTextual()?values.get(0).value.textValue().codePointCount(0,values.get(0).value.textValue().length()):values.get(0).value.size());
      case "dateDiffDays" -> integer(java.time.temporal.ChronoUnit.DAYS.between(LocalDate.parse(values.get(0).value.textValue()),LocalDate.parse(values.get(1).value.textValue())));
      case "dateAddDays" -> Result.value("date", ContractValue.canonicalNode("text",LocalDate.parse(values.get(0).value.textValue()).plusDays(Long.parseLong(ContractValue.integer(values.get(1).value))).toString()));
      case "ageYears" -> age(values); case "exists","isAnswered" -> bool(true); case "statusIs" -> bool(false);
      default -> Result.error("UNSUPPORTED_OPERATOR");
    }; } catch (ArithmeticException e) { return Result.error("DIVIDE_BY_ZERO"); } catch (ContractValue.ContractException e) { return Result.error(e.code()); } catch (RuntimeException e) { return Result.error("INVALID_LITERAL"); }
  }
  private static boolean arity(String op,int n){return switch(op){case "not","length","exists","isAnswered"->n==1;case "if"->n==3;case "round","eq","ne","gt","gte","lt","lte","subtract","divide","in","contains","containsAll","dateDiffDays","ageYears","dateAddDays","statusIs"->n==2;default->n>=2;};}
  private Result typeCheck(String op,List<Result> a){
    if (a.stream().anyMatch(r->r.reason!=null)) return Result.value("unknown",null);
    String x=a.get(0).type; if(Set.of("add","subtract","multiply","divide","round","min","max").contains(op)){if(a.stream().anyMatch(r->!numericType(r.type)))return Result.error("EXPR_TYPE");return Result.value("decimal",null);}
    if(Set.of("gt","gte","lt","lte").contains(op)){if(a.size()!=2||!comparable(a.get(0).type,a.get(1).type))return Result.error("EXPR_TYPE");return Result.value("boolean",null);}
    if(Set.of("eq","ne").contains(op)){if(a.size()!=2||x.startsWith("array")||!comparable(x,a.get(1).type))return Result.error("EXPR_TYPE");return Result.value("boolean",null);}
    if("round".equals(op)&&!"integer".equals(a.get(1).type))return Result.error("EXPR_TYPE");
    if("concat".equals(op)&&a.stream().anyMatch(r->!"text".equals(r.type)))return Result.error("EXPR_TYPE");
    if("length".equals(op)&&!("text".equals(x)||x.startsWith("array:")))return Result.error("EXPR_TYPE");
    if(Set.of("and","or","not","if").contains(op)&&!"if".equals(op)&&a.stream().anyMatch(r->!"boolean".equals(r.type)))return Result.error("EXPR_TYPE");
    return Result.value(resultType(op,x),null);
  }
  private static String resultType(String op,String fallback){return switch(op){case "eq","ne","gt","gte","lt","lte","and","or","not","in","contains","containsAll","exists","isAnswered","statusIs"->"boolean";case "add","subtract","multiply","divide","round","min","max"->"decimal";case "length","dateDiffDays","ageYears"->"integer";case "dateAddDays"->"date";default->fallback;};}
  private static boolean numericType(String t){return "integer".equals(t)||"decimal".equals(t);} private static boolean comparable(String a,String b){return a.equals(b)||(numericType(a)&&numericType(b));}
  private static BigDecimal decimal(Result r){return new BigDecimal(r.value.textValue());} private static Result decimal(BigDecimal n){ContractValue.validateDecimal(n);return Result.value("decimal",ContractValue.canonicalNode("decimal",ContractValue.canonicalDecimal(n)));} private static Result integer(long n){return Result.value("integer",ContractValue.canonicalNode("integer",n));} private static Result bool(boolean n){return Result.value("boolean",ContractValue.canonicalNode("boolean",n));}
  private static Result numeric(String op,List<Result> v){BigDecimal a=decimal(v.get(0)),b=decimal(v.get(1));return switch(op){case "add"->decimal(a.add(b));case "subtract"->decimal(a.subtract(b));case "multiply"->decimal(a.multiply(b));case "divide"->{if(b.signum()==0)yield Result.error("DIVIDE_BY_ZERO");try{yield decimal(a.divide(b));}catch(ArithmeticException e){yield Result.error("CALC_PRECISION");}}case "min"->decimal(a.min(b));default->decimal(a.max(b));};}
  private static Result compare(String op,Result a,Result b){int n=numericType(a.type)?decimal(a).compareTo(decimal(b)):a.value.textValue().compareTo(b.value.textValue());return bool(switch(op){case "gt"->n>0;case "gte"->n>=0;case "lt"->n<0;default->n<=0;});} private static boolean equal(Result a,Result b){return numericType(a.type)?decimal(a).compareTo(decimal(b))==0:a.value.equals(b.value);} private static boolean contains(JsonNode array,Result item){for(JsonNode n:array){if(n.equals(item.value)||(n.isTextual()&&item.value.isTextual()&&numericTextEquals(n,item.value)))return true;}return false;} private static boolean numericTextEquals(JsonNode a,JsonNode b){try{return new BigDecimal(a.textValue()).compareTo(new BigDecimal(b.textValue()))==0;}catch(Exception e){return false;}} private static Result containsAll(List<Result> v){for(JsonNode n:v.get(1).value)if(!contains(v.get(0).value,Result.value(v.get(0).type.substring(6),n)))return bool(false);return bool(true);} private static Result age(List<Result> v){LocalDate birth=LocalDate.parse(v.get(0).value.textValue()),asOf=LocalDate.parse(v.get(1).value.textValue());if(asOf.isBefore(birth))return Result.error("DATE_RANGE");return integer(Period.between(birth,asOf).getYears());}
  private static final class Counter { int remaining; Counter(int remaining){this.remaining=remaining;} boolean step(){return remaining-->0;} }
}
