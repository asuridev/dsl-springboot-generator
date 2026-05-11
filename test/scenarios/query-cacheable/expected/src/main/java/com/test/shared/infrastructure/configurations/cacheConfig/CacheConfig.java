package com.test.shared.infrastructure.configurations.cacheConfig;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.jsontype.impl.LaissezFaireSubTypeValidator;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext.SerializationPair;

/**
 * Configures Redis-backed Spring Cache with per-query TTL.
 * derived_from: useCases[*].cacheable
 */
@Configuration
@EnableCaching
public class CacheConfig {

    private final ObjectMapper objectMapper;

    public CacheConfig(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory factory) {
        ObjectMapper redisMapper = objectMapper
            .copy()
            .activateDefaultTypingAsProperty(
                LaissezFaireSubTypeValidator.instance,
                ObjectMapper.DefaultTyping.EVERYTHING,
                "@class"
            );

        RedisCacheConfiguration defaults = RedisCacheConfiguration.defaultCacheConfig()
            .disableCachingNullValues()
            .serializeValuesWith(SerializationPair.fromSerializer(new GenericJackson2JsonRedisSerializer(redisMapper)));

        Map<String, RedisCacheConfiguration> caches = new HashMap<>();
        // derived_from: useCases[UC-CAT-010].cacheable
        caches.put("getProductById", defaults.entryTtl(Duration.parse("PT5M")));
        // derived_from: useCases[UC-CAT-020].cacheable
        caches.put("getCategoryTree", defaults.entryTtl(Duration.parse("PT1H")));
        // derived_from: useCases[UC-CAT-030].cacheable
        caches.put("searchProductsByCategory", defaults.entryTtl(Duration.parse("PT3M")));

        return RedisCacheManager.builder(factory)
            .cacheDefaults(defaults)
            .withInitialCacheConfigurations(caches)
            .build();
    }
}
