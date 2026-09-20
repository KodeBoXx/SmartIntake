package com.kodeboxx.smartintake;

import java.time.*;import java.util.*;import org.springframework.http.*;import org.springframework.jdbc.core.*;import org.springframework.web.bind.annotation.*;import org.springframework.web.server.ResponseStatusException;import com.fasterxml.jackson.databind.*;import com.kodeboxx.smartintake.contract.FormRuntime;import com.kodeboxx.smartintake.contract.PackageStamp;import com.kodeboxx.smartintake.contract.CsvSafety;
import org.springframework.boot.*;import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;import org.springframework.boot.autoconfigure.*;import org.springframework.context.annotation.*;import org.springframework.web.servlet.config.annotation.*;

@SpringBootApplication public class SmartIntakeApplication {
 public static void main(String[] args){SpringApplication.run(SmartIntakeApplication.class,args);}
 @Bean WebMvcConfigurer cors(){return new WebMvcConfigurer(){public void addCorsMappings(CorsRegistry r){r.addMapping("/v1/**").allowedOrigins("http://localhost:4200","http://127.0.0.1:4200").allowedMethods("GET","POST","PUT","PATCH","DELETE").allowedHeaders("Content-Type","X-CSRF-Token","X-Login-CSRF-Token").allowCredentials(true);}};}
}
