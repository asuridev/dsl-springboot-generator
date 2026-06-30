package com.test.catalog.application.ports;

import com.test.shared.domain.valueobject.StoredObject;
import java.net.URI;
import org.springframework.core.io.Resource;
import org.springframework.web.multipart.MultipartFile;

/**
 * Output port for the "product-media" object store.
 *
 * derived_from: objectStorage:product-media
 *
 * Provider-agnostic contract for binary persistence. The infrastructure adapter
 * (S3-compatible / MinIO) implements it. visibility=public, urlAccess=public-url.
 */
public interface ProductMediaStoragePort {
    /**
     * Uploads the given multipart file and returns its {@link StoredObject} descriptor.
     * For public-url stores the returned {@code url} is the stable public URL; for
     * signed-url stores {@code url} is {@code null} (sign on read via {@link #signUrl}).
     */
    StoredObject put(MultipartFile file);

    /**
     * Returns a time-limited signed URL granting read access to the object with the
     * given storage key.
     */
    URI signUrl(String storageKey);

    /**
     * Streams the object with the given storage key as a binary {@link Resource}
     * (proxy download — the bucket is never exposed to the client).
     */
    Resource get(String storageKey);

    /**
     * Permanently deletes the object with the given storage key.
     */
    void delete(String storageKey);
}
