package com.test.shared.infrastructure.security;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;

/**
 * Converts an incoming JWT into a Spring Security {@link AbstractAuthenticationToken},
 * mapping provider-specific roles to standard Spring {@code ROLE_} granted authorities.
 *
 * Provider: keycloak
 * Roles claim: realm_access.roles (nested)
 * Principal claim: preferred_username
 */
public class JwtAuthConverter {

    /**
     * Builds a {@link JwtAuthenticationConverter} pre-configured for this provider.
     * Called by {@code SecurityConfig.jwtAuthenticationConverter()}.
     */
    public JwtAuthenticationConverter converter() {
        JwtAuthenticationConverter jwtConverter = new JwtAuthenticationConverter();
        jwtConverter.setJwtGrantedAuthoritiesConverter(this::extractAuthorities);
        jwtConverter.setPrincipalClaimName("preferred_username");
        return jwtConverter;
    }

    /**
     * Combines role-based authorities (ROLE_ prefix), OAuth2 scope authorities
     * (SCOPE_ prefix), and granular permission authorities (no prefix) extracted
     * from the JWT into a single collection. This allows {@code hasAnyRole(...)},
     * {@code hasAnyAuthority('SCOPE_...')} and {@code hasAnyAuthority('x:action')}
     * to work correctly in {@code @PreAuthorize} expressions.
     */
    private Collection<GrantedAuthority> extractAuthorities(Jwt jwt) {
        List<GrantedAuthority> authorities = new ArrayList<>(extractRoles(jwt));
        authorities.addAll(extractScopes(jwt));
        authorities.addAll(extractPermissions(jwt));
        return authorities;
    }

    private Collection<GrantedAuthority> extractRoles(Jwt jwt) {
        Map<String, Object> realmAccess = jwt.getClaimAsMap("realm_access");
        if (realmAccess == null) {
            return Collections.emptyList();
        }
        Object rolesObj = realmAccess.get("roles");
        if (!(rolesObj instanceof List<?> roles)) {
            return Collections.emptyList();
        }
        return roles
            .stream()
            .filter(String.class::isInstance)
            .map(role -> new SimpleGrantedAuthority("ROLE_" + role))
            .map(GrantedAuthority.class::cast)
            .toList();
    }

    private Collection<GrantedAuthority> extractScopes(Jwt jwt) {
        String scopeClaim = jwt.getClaimAsString("scope");
        if (scopeClaim == null || scopeClaim.isBlank()) {
            return Collections.emptyList();
        }
        return List.of(scopeClaim.split(" "))
            .stream()
            .filter(s -> !s.isBlank())
            .map(scope -> new SimpleGrantedAuthority("SCOPE_" + scope))
            .map(GrantedAuthority.class::cast)
            .toList();
    }

    /**
     * Extracts granular permission authorities from the {@code permissions}
     * JWT claim (array of strings). Each permission is mapped to a
     * {@link SimpleGrantedAuthority} with no prefix, enabling
     * {@code hasAnyAuthority('catalog:read')} in {@code @PreAuthorize}.
     *
     * Configure this claim in Keycloak via a "User Client Role" protocol mapper
     * with "Token Claim Name" set to {@code permissions}
     * and "Multivalued" enabled.
     */
    private Collection<GrantedAuthority> extractPermissions(Jwt jwt) {
        List<String> permissions = jwt.getClaimAsStringList("permissions");
        if (permissions == null || permissions.isEmpty()) {
            return Collections.emptyList();
        }
        return permissions
            .stream()
            .filter(p -> !p.isBlank())
            .map(SimpleGrantedAuthority::new)
            .map(GrantedAuthority.class::cast)
            .toList();
    }
}
