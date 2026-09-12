package com.kodeboxx.smartintake.contract;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class FormRuntimeTests {
 private final FormRuntime runtime=new FormRuntime(new ObjectMapper());
 private Map<String,Object> def(){
  Map<String,Object> age=Map.of("id","age","type","integer","required",true);
  Map<String,Object> amount=Map.of("id","amount","type","decimal");
  Map<String,Object> channels=Map.of("id","channels","type","multiChoice","options",List.of(Map.of("id","email","label","Email")));
  Map<String,Object> rule=Map.of("op","eq","args",List.of(Map.of("ref",Map.of("fieldId","age")),Map.of("literal",Map.of("type","text","value","21"))));
  Map<String,Object> followup=Map.of("id","followup","type","text","requiredRule",rule);
  return Map.of("contractVersion","4.0.0","pages",List.of(Map.of("id","one","fields",List.of(age,amount,channels,followup))));
 }
 @Test void validatesTypedValuesAndOptions(){var errors=runtime.validate(def(),Map.of("age","twenty","amount","1.2.3","channels",List.of("sms")));assertEquals(3,errors.size());assertTrue(errors.stream().anyMatch(x->"age".equals(x.get("fieldId"))));}
 @Test void evaluatesRequiredRuleAst(){assertTrue(runtime.validate(def(),Map.of("age","21")).stream().anyMatch(x->"followup".equals(x.get("fieldId"))));assertFalse(runtime.validate(def(),Map.of("age","20")).stream().anyMatch(x->"followup".equals(x.get("fieldId"))));}
 @Test void stripsSystemOwnedValuesAndRejectsMalformedRepeater(){Map<String,Object> d=Map.of("contractVersion","4.0.0","pages",List.of(Map.of("id","p","fields",List.of(Map.of("id","total","type","calculated"),Map.of("id","note","type","readOnly"),Map.of("id","items","type","repeater")))));assertFalse(runtime.respondentAnswers(d,Map.of("total","forged","note","forged","items",List.of(Map.of("id","a","value","ok")))).containsKey("total"));assertEquals("REPEATER_ITEM_INVALID",runtime.validate(d,Map.of("items",List.of(Map.of("value","bad")))).get(0).get("code"));}
 @Test void rejectsUnknownFieldTypes(){assertThrows(IllegalArgumentException.class,()->runtime.validateDefinition(Map.of("contractVersion","4.0.0","pages",List.of(Map.of("id","a","fields",List.of(Map.of("id","x","type","script")))))));}
}
