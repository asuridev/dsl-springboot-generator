package com.test.healthcheck.infrastructure.adapters.healthApi;

import feign.Logger;
import feign.Request;
import java.util.concurrent.TimeUnit;
import org.springframework.context.annotation.Bean;

// derived_from: system.yaml#/externalSystems/health-api
/**
 * Feign configuration for the health-api external system.
 * Not annotated with @Configuration — registered via @FeignClient(configuration=...).
 *
 * derived_from: system.yaml#/externalSystems[health-api]/resilience
 */
public class HealthApiRestConfig {

    @Bean
    public Logger.Level feignLoggerLevel() {
        return Logger.Level.BASIC;
    }

    @Bean
    public Request.Options feignOptions() {
        return new Request.Options(
            5000L,
            TimeUnit.MILLISECONDS, // connect timeout
            30000L,
            TimeUnit.MILLISECONDS, // read timeout
            true
        );
    }
}
