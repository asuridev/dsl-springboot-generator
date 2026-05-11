package com.test.payments.infrastructure.adapters.paymentGateway;

import feign.Logger;
import feign.Request;
import feign.RequestInterceptor;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;

// derived_from: system.yaml#/externalSystems/payment-gateway
/**
 * Feign configuration for the payment-gateway external system.
 * Not annotated with @Configuration — registered via @FeignClient(configuration=...).
 *
 * derived_from: system.yaml#/externalSystems[payment-gateway]/resilience
 *
 * derived_from: system.yaml#/externalSystems[payment-gateway]/auth (type: api-key)
 */
public class PaymentGatewayRestConfig {

    @Value("${integration.payment-gateway.api-key:}")
    private String apiKey;

    @Bean
    public RequestInterceptor paymentGatewayAuthInterceptor() {
        return template -> {
            if (apiKey != null && !apiKey.isBlank()) {
                template.header("X-API-Key", apiKey);
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
