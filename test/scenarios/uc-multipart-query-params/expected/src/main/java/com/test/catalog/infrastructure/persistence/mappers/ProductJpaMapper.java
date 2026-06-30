package com.test.catalog.infrastructure.persistence.mappers;

import com.test.catalog.domain.aggregate.Product;
import com.test.catalog.domain.entity.ProductImage;
import com.test.catalog.infrastructure.persistence.entities.ProductImageJpa;
import com.test.catalog.infrastructure.persistence.entities.ProductJpa;
import com.test.shared.domain.valueobject.StoredObject;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * ProductJpaMapper — stateless converter between the domain model
 * and its JPA representation.
 *
 * Extracted from ProductRepositoryImpl to keep the adapter focused
 * on persistence orchestration. All conversions are pure functions; introduce
 * dependencies (e.g. value-object factories) only if a domain rule explicitly
 * requires them.
 */
@Component
public class ProductJpaMapper {

    // ─── JPA → Domain ────────────────────────────────────────────────────────

    public Product toDomain(ProductJpa jpa) {
        return new Product(
            jpa.getId(),
            jpa.getName(),
            jpa.getProductImages().stream().map(this::toProductImageDomain).toList()
        );
    }

    public ProductImage toProductImageDomain(ProductImageJpa jpa) {
        return new ProductImage(
            jpa.getId(),
            new StoredObject(
                jpa.getMediaStorageKey(),
                jpa.getMediaUrl() != null ? java.net.URI.create(jpa.getMediaUrl()) : null,
                jpa.getMediaContentType(),
                jpa.getMediaSizeBytes()
            )
        );
    }

    // ─── Domain → JPA ────────────────────────────────────────────────────────

    public ProductJpa toJpa(Product domain) {
        ProductJpa jpa = ProductJpa.builder()
            .id(domain.getId())
            .name(domain.getName())
            .productImages(
                domain
                    .getProductImages()
                    .stream()
                    .map(this::toProductImageJpa)
                    .collect(java.util.stream.Collectors.toCollection(java.util.ArrayList::new))
            )
            .build();
        return jpa;
    }

    public ProductImageJpa toProductImageJpa(ProductImage domain) {
        return ProductImageJpa.builder()
            .id(domain.getId())
            .mediaStorageKey(domain.getMedia() != null ? domain.getMedia().storageKey() : null)
            .mediaUrl(
                domain.getMedia() != null && domain.getMedia().url() != null ? domain.getMedia().url().toString() : null
            )
            .mediaContentType(domain.getMedia() != null ? domain.getMedia().contentType() : null)
            .mediaSizeBytes(domain.getMedia() != null ? domain.getMedia().sizeBytes() : null)
            .build();
    }
}
