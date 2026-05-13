package com.test.shared.domain.customExceptions;

import java.util.List;

public class ConflictException extends DomainException {

    protected ConflictException() {}

    public ConflictException(String message) {
        super(message);
    }

    public ConflictException(String message, Throwable cause) {
        super(message, cause);
    }

    public ConflictException(String message, String code, Object[] args) {
        super(message, code, args);
    }

    public ConflictException(String message, String code, Integer httpStatus, Object[] args) {
        super(message, code, httpStatus, args);
    }

    public ConflictException(String message, String code, Integer httpStatus, Object[] args, List<String> details) {
        super(message, code, httpStatus, args, details);
    }
}
