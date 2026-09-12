package com.kodeboxx.smartintake.contract;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;

/** Package validation and deterministic respondent validation for supported Lite field types. */
public final class FormRuntime {
  private static final Set<String> TYPES=Set.of("text","integer","decimal","date","boolean","choice","multiChoice","object","list","repeater","calculated","readOnly");
  private final ObjectMapper json;
  public FormRuntime(ObjectMapper json){this.json=json;}
  public void validateDefinition(Map<String,Object> definition){
    JsonNode root=json.valueToTree(definition);
    if(!ContractValue.VERSION.equals(root.path("contractVersion").asText())||!root.path("pages").isArray()||root.path("pages").isEmpty()) throw new IllegalArgumentException("DEFINITION_INVALID");
    Set<String> ids=new HashSet<>();
    for(JsonNode page:root.path("pages")){if(!page.path("id").isTextual()||!page.path("fields").isArray())throw new IllegalArgumentException("PAGE_INVALID"); for(JsonNode field:page.path("fields")){String id=field.path("id").asText();String type=field.path("type").asText();if(id.isBlank()||!ids.add(id)||!TYPES.contains(type))throw new IllegalArgumentException("FIELD_INVALID");if(("choice".equals(type)||"multiChoice".equals(type))&&!field.path("options").isArray())throw new IllegalArgumentException("OPTIONS_REQUIRED");compileRule(field.path("visibilityRule"));compileRule(field.path("requiredRule"));}}
  }
  /** Drops values for system-owned calculated/read-only fields before persistence. */
  public Map<String,Object> respondentAnswers(Map<String,Object> definition,Map<String,Object> answers){Map<String,Object> clean=new LinkedHashMap<>(answers==null?Map.of():answers);JsonNode root=json.valueToTree(definition);for(JsonNode page:root.path("pages"))for(JsonNode field:page.path("fields")){String type=field.path("type").asText();if("calculated".equals(type)||"readOnly".equals(type))clean.remove(field.path("id").asText());}return clean;}
  public List<Map<String,Object>> validate(Map<String,Object> definition,Map<String,Object> answers){
    JsonNode root=json.valueToTree(definition), values=json.valueToTree(answers==null?Map.of():answers);List<Map<String,Object>> errors=new ArrayList<>();
    for(JsonNode page:root.path("pages"))for(JsonNode field:page.path("fields")){String id=field.path("id").asText();if("calculated".equals(field.path("type").asText())||"readOnly".equals(field.path("type").asText()))continue; boolean visible=rule(field.path("visibilityRule"),values,true);boolean required=field.path("required").asBoolean(false)||rule(field.path("requiredRule"),values,false);JsonNode value=values.get(id);if(!visible)continue;if((value==null||value.isNull()||value.isTextual()&&value.asText().isBlank())&&required){errors.add(error(id,"REQUIRED","This field is required."));continue;}if(value==null||value.isNull())continue;try{validateValue(field,value);}catch(IllegalArgumentException e){errors.add(error(id,e.getMessage(),"Invalid "+field.path("type").asText()+" value."));}}
    return errors;
  }
  private void validateValue(JsonNode f,JsonNode value){String type=f.path("type").asText();if("multiChoice".equals(type)){if(!value.isArray())throw new IllegalArgumentException("INVALID_LITERAL");for(JsonNode x:value)choice(f,x);return;}if("choice".equals(type)){choice(f,value);return;}if("object".equals(type)){if(!value.isObject())throw new IllegalArgumentException("INVALID_LITERAL");return;}if("list".equals(type)){if(!value.isArray())throw new IllegalArgumentException("INVALID_LITERAL");return;}if("repeater".equals(type)){if(!value.isArray())throw new IllegalArgumentException("INVALID_LITERAL");Set<String> ids=new HashSet<>();for(JsonNode item:value){if(!item.isObject()||!item.path("id").isTextual()||item.path("id").asText().isBlank()||!ids.add(item.path("id").asText())||!item.has("value"))throw new IllegalArgumentException("REPEATER_ITEM_INVALID");}return;}if("text".equals(type)){if(!value.isTextual())throw new IllegalArgumentException("INVALID_LITERAL");int min=f.path("constraints").path("minLength").asInt(0),max=f.path("constraints").path("maxLength").asInt(Integer.MAX_VALUE);if(value.asText().length()<min||value.asText().length()>max)throw new IllegalArgumentException("TEXT_LENGTH");return;}ContractValue.validate(type,value);}
  private void choice(JsonNode f,JsonNode value){if(!value.isTextual()||!f.path("options").findValuesAsText("id").contains(value.asText()))throw new IllegalArgumentException("OPTION_INVALID");}
  private boolean rule(JsonNode ast,JsonNode values,boolean fallback){if(ast==null||ast.isMissingNode()||ast.isNull())return fallback;ExpressionEngine.Result r=new ExpressionEngine().evaluate(ast,new ExpressionEngine.Context(fields(values),"2026-09-12","UTC",1000));return r.code()==null&&r.reason()==null&&r.value()!=null?r.value().asBoolean():fallback;}
  private void compileRule(JsonNode ast){if(ast!=null&&!ast.isMissingNode()&&!ast.isNull()&&new ExpressionEngine().compile(ast).code()!=null)throw new IllegalArgumentException("RULE_INVALID");}
  private Map<String,JsonNode> fields(JsonNode values){Map<String,JsonNode> out=new HashMap<>();values.fields().forEachRemaining(e->out.put(e.getKey(),wrap(e.getValue())));return out;}
  private JsonNode wrap(JsonNode value){var outer=json.createObjectNode();var literal=outer.putObject("literal");if(value.isBoolean())literal.put("type","boolean").put("value",value.booleanValue());else literal.put("type","text").put("value",value.asText(value.toString()));return outer;}
  private Map<String,Object> error(String id,String code,String message){return Map.of("fieldId",id,"code",code,"message",message);}
}
