package com.test.orders.infrastructure.adapters.catalog;

import org.springframework.stereotype.Component;

/**
 * ACL (Anti-Corruption Layer) mapper for {@link CatalogServicePort}.
 *
 * <p>Translates infrastructure DTOs (shaped by the catalog external API) into
 * domain models. If the external API changes, only these methods need updating;
 * domain logic using the domain models remains untouched.
 */
@Component
public class CatalogAclMapper {}
