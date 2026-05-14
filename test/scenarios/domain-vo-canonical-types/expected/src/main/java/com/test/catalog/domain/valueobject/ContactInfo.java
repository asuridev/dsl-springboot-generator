package com.test.catalog.domain.valueobject;

import java.util.Objects;
import java.util.regex.Pattern;

/**
 * ContactInfo — Value Object
 * Immutable domain value object (pure Java, no Lombok).
 *
 * Covers Email canonical type and EMAIL_PATTERN guard.
 *
 * derived_from: valueObject:ContactInfo
 */
public final class ContactInfo {

    private static final Pattern EMAIL_PATTERN = Pattern.compile("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$");

    private final String email;

    private final String backupEmail;

    public ContactInfo(String email, String backupEmail) {
        if (email == null) {
            throw new IllegalArgumentException("VO ContactInfo.email: required");
        }
        if (email != null && !EMAIL_PATTERN.matcher(email).matches()) {
            throw new IllegalArgumentException("VO ContactInfo.email: invalid email format");
        }
        if (backupEmail != null && !EMAIL_PATTERN.matcher(backupEmail).matches()) {
            throw new IllegalArgumentException("VO ContactInfo.backupEmail: invalid email format");
        }

        this.email = email;
        this.backupEmail = backupEmail;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public String getEmail() {
        return email;
    }

    public String getBackupEmail() {
        return backupEmail;
    }

    // ─── Structural equality ──────────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        ContactInfo that = (ContactInfo) o;
        return Objects.equals(email, that.email) && Objects.equals(backupEmail, that.backupEmail);
    }

    @Override
    public int hashCode() {
        return Objects.hash(email, backupEmail);
    }

    @Override
    public String toString() {
        return "ContactInfo{" + "email=" + email + ", backupEmail=" + backupEmail + '}';
    }
}
