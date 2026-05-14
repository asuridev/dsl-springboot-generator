package com.test.orders.infrastructure.adapters.catalog;

import feign.Logger;
import feign.Request;
import java.util.concurrent.TimeUnit;
import org.springframework.context.annotation.Bean;

/**
 * Feign client configuration for the catalog BC.
 * Not annotated with @Configuration — registered via @FeignClient(configuration=...).
 */
public class CatalogFeignConfig {

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
