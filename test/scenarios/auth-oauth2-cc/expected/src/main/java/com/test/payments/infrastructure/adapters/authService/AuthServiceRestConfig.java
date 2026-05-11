package com.test.payments.infrastructure.adapters.authService;

import com.test.shared.infrastructure.auth.OAuth2ClientCredentialsSupport;
import feign.Logger;
import feign.Request;
import feign.RequestInterceptor;
import java.util.concurrent.TimeUnit;
import org.springframework.context.annotation.Bean;

// derived_from: system.yaml#/externalSystems/auth-service
/**
 * Feign configuration for the auth-service external system.
 * Not annotated with @Configuration — registered via @FeignClient(configuration=...).
 *
 * derived_from: system.yaml#/externalSystems[auth-service]/auth (type: oauth2-cc)
 */
public class AuthServiceRestConfig {

    private final OAuth2ClientCredentialsSupport oauth2Support;

    public AuthServiceRestConfig(OAuth2ClientCredentialsSupport oauth2Support) {
        this.oauth2Support = oauth2Support;
    }

    @Bean
    public RequestInterceptor authServiceAuthInterceptor() {
        return oauth2Support.buildInterceptor("billing-provider");
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
