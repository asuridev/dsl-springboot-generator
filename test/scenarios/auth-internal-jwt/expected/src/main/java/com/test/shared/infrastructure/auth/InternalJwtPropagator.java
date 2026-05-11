package com.test.shared.infrastructure.auth;

import feign.RequestInterceptor;
import feign.RequestTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.AbstractOAuth2TokenAuthenticationToken;
import org.springframework.stereotype.Component;

/**
 * derived_from: system.yaml#/integrations/auth (type: internal-jwt)
 *
 * Feign {@link RequestInterceptor} that propagates the JWT from the current
 * inbound request to all outgoing Feign calls that declare
 * {@code auth.type: internal-jwt}.
 *
 * <p>The token is extracted from the Spring Security {@code SecurityContext}.
 * If no authenticated principal is present (e.g. in background threads or
 * tests without a security context), the header is not added and the call
 * proceeds unauthenticated.
 */
@Component
public class InternalJwtPropagator implements RequestInterceptor {

    @Override
    public void apply(RequestTemplate template) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth instanceof AbstractOAuth2TokenAuthenticationToken<?> tokenAuth) {
            String tokenValue = tokenAuth.getToken().getTokenValue();
            template.header("Authorization", "Bearer " + tokenValue);
        }
    }
}
