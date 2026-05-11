package com.test.orders.infrastructure.adapters.catalog;

import com.test.shared.infrastructure.auth.InternalJwtPropagator;
import feign.Logger;
import feign.Request;
import feign.RequestInterceptor;
import java.util.concurrent.TimeUnit;
import org.springframework.context.annotation.Bean;

/**
 * Feign client configuration for the catalog BC.
 * Not annotated with @Configuration — registered via @FeignClient(configuration=...).
 *
 * derived_from: system.yaml#/integrations[from=orders,to=catalog]/auth (type: internal-jwt)
 */
public class CatalogFeignConfig {

    private final InternalJwtPropagator internalJwtPropagator;

    public CatalogFeignConfig(InternalJwtPropagator internalJwtPropagator) {
        this.internalJwtPropagator = internalJwtPropagator;
    }

    @Bean
    public RequestInterceptor catalogAuthInterceptor() {
        return internalJwtPropagator;
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
