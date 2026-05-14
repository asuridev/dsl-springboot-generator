package com.test.shared.domain.errorMessage;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErrorResponse(
    Instant timestamp,
    int status,
    String error,
    String code,
    String message,
    List<String> details
) {
    public ErrorResponse(int status, String error, String message) {
        this(Instant.now(), status, error, null, message, null);
    }

    public ErrorResponse(int status, String error, String message, List<String> details) {
        this(Instant.now(), status, error, null, message, details);
    }

    public ErrorResponse(int status, String error, String code, String message, List<String> details) {
        this(Instant.now(), status, error, code, message, details);
    }
}
