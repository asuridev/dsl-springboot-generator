package com.test.orders.infrastructure.adapters.catalog;

import feign.Logger;
import feign.Request;
import feign.RequestInterceptor;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;

/**
 * Feign client configuration for the catalog BC.
 * Not annotated with @Configuration — registered via @FeignClient(configuration=...).
 *
 * derived_from: system.yaml#/integrations[from=orders,to=catalog]/auth (type: bearer)
 */
public class CatalogFeignConfig {

    @Value("${integration.catalog.bearer-token:}")
    private String bearerToken;

    @Bean
    public RequestInterceptor catalogAuthInterceptor() {
        return template -> {
            if (bearerToken != null && !bearerToken.isBlank()) {
                template.header("Authorization", "Bearer " + bearerToken);
            }
        };
    }

    @Bean
    public Logger.Level feignLoggerLevel() {
        return Logger.Level.BASIC;
    }

    @Bean
    public Request.Options feignOptions() {
        return new Request.Options(
            5000L,
            TimeUnit.MILLISECONDS, // connect timeout
            15000L,
            TimeUnit.MILLISECONDS, // read timeout
            true
        );
    }
}
