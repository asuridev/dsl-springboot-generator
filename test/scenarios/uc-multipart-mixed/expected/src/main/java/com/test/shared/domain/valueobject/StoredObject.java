package com.test.shared.domain.valueobject;

import java.net.URI;

/**
 * Canonical composite value object describing a binary persisted in an object
 * store (S3-compatible / MinIO).
 *
 * derived_from: objectStorage (canonical type StoredObject)
 *
 * Immutable. Produced by the storage port {@code put} operation and bound to
 * domain factory/methods. For {@code public-url} stores {@code url} holds the
 * stable public URL; for {@code signed-url} stores {@code url} is {@code null}
 * at write time and is filled on read via the port {@code signUrl} operation.
 *
 * @param storageKey  provider object key (path inside the bucket) — always present
 * @param url         resolvable URL (public or signed) — may be {@code null} for signed-url stores
 * @param contentType MIME type of the stored binary (e.g. {@code image/png})
 * @param sizeBytes   size of the stored binary in bytes
 */
public record StoredObject(String storageKey, URI url, String contentType, Long sizeBytes) {}
