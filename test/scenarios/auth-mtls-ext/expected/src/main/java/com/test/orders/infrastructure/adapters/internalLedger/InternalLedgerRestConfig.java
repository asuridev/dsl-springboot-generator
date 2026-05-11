package com.test.orders.infrastructure.adapters.internalLedger;

import com.test.shared.infrastructure.auth.MutualTlsSupport;
import feign.Client;
import feign.Logger;
import feign.Request;
import java.util.concurrent.TimeUnit;
import org.springframework.context.annotation.Bean;

// derived_from: system.yaml#/externalSystems/internal-ledger
/**
 * Feign configuration for the internal-ledger external system.
 * Not annotated with @Configuration — registered via @FeignClient(configuration=...).
 *
 * derived_from: system.yaml#/externalSystems[internal-ledger]/auth (type: mTLS)
 */
public class InternalLedgerRestConfig {

    private final MutualTlsSupport mutualTlsSupport;

    public InternalLedgerRestConfig(MutualTlsSupport mutualTlsSupport) {
        this.mutualTlsSupport = mutualTlsSupport;
    }

    @Bean
    public Client feignClient() {
        return new Client.Default(mutualTlsSupport.buildSSLSocketFactory(), null);
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
