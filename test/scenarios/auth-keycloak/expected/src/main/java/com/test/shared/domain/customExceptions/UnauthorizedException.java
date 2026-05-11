package com.test.shared.domain.customExceptions;

import java.util.List;

public class UnauthorizedException extends DomainException {

    protected UnauthorizedException() {}

    public UnauthorizedException(String message) {
        super(message);
    }

    public UnauthorizedException(String message, Throwable cause) {
        super(message, cause);
    }

    public UnauthorizedException(String message, String code, Object[] args) {
        super(message, code, args);
    }

    public UnauthorizedException(String message, String code, Integer httpStatus, Object[] args) {
        super(message, code, httpStatus, args);
    }

    public UnauthorizedException(String message, String code, Integer httpStatus, Object[] args, List<String> details) {
        super(message, code, httpStatus, args, details);
    }
}
