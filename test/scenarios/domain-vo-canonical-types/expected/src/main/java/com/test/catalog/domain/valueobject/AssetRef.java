package com.test.catalog.domain.valueobject;

import java.net.URI;
import java.util.Objects;

/**
 * AssetRef — Value Object
 * Immutable domain value object (pure Java, no Lombok).
 *
 * Covers Url and Text canonical types.
 *
 * derived_from: valueObject:AssetRef
 */
public final class AssetRef {

    private final URI downloadUrl;

    private final String notes;

    public AssetRef(URI downloadUrl, String notes) {
        if (downloadUrl == null) {
            throw new IllegalArgumentException("VO AssetRef.downloadUrl: required");
        }

        this.downloadUrl = downloadUrl;
        this.notes = notes;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public URI getDownloadUrl() {
        return downloadUrl;
    }

    public String getNotes() {
        return notes;
    }

    // ─── Structural equality ──────────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        AssetRef that = (AssetRef) o;
        return Objects.equals(downloadUrl, that.downloadUrl) && Objects.equals(notes, that.notes);
    }

    @Override
    public int hashCode() {
        return Objects.hash(downloadUrl, notes);
    }

    @Override
    public String toString() {
        return "AssetRef{" + "downloadUrl=" + downloadUrl + ", notes=" + notes + '}';
    }
}
