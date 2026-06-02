package com.test.catalog.infrastructure.adapters.orderHub;

import feign.Logger;
import feign.Request;
import java.util.concurrent.TimeUnit;
import org.springframework.context.annotation.Bean;

// derived_from: system.yaml#/externalSystems/order-hub
/**
 * Feign configuration for the order-hub external system.
 * Not annotated with @Configuration — registered via @FeignClient(configuration=...).
 */
public class OrderHubRestConfig {

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
