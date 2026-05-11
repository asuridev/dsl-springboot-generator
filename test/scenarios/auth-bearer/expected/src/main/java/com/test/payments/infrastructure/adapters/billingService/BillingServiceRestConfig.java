package com.test.payments.infrastructure.adapters.billingService;

import feign.Logger;
import feign.Request;
import feign.RequestInterceptor;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;

// derived_from: system.yaml#/externalSystems/billing-service
/**
 * Feign configuration for the billing-service external system.
 * Not annotated with @Configuration — registered via @FeignClient(configuration=...).
 *
 * derived_from: system.yaml#/externalSystems[billing-service]/auth (type: bearer)
 */
public class BillingServiceRestConfig {

    @Value("${integration.billing-service.token:}")
    private String bearerToken;

    @Bean
    public RequestInterceptor billingServiceAuthInterceptor() {
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
            30000L,
            TimeUnit.MILLISECONDS, // read timeout
            true
        );
    }
}
