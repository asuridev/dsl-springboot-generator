package com.test.catalog.infrastructure.persistence.entities;

import jakarta.persistence.*;
import java.util.UUID;
import lombok.*;

/**
 * ProductImageJpa — JPA Entity for ProductImage child entity.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "product_images")
public class ProductImageJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "media_storage_key", columnDefinition = "TEXT", nullable = false)
    private String mediaStorageKey;

    @Column(name = "media_url", columnDefinition = "TEXT")
    private String mediaUrl;

    @Column(name = "media_content_type", length = 255)
    private String mediaContentType;

    @Column(name = "media_size_bytes", nullable = false)
    private Long mediaSizeBytes;
}
