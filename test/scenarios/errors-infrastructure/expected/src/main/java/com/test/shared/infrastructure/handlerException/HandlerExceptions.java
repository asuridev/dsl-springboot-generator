package com.test.shared.infrastructure.handlerException;

import com.test.shared.domain.customExceptions.BadRequestException;
import com.test.shared.domain.customExceptions.BusinessException;
import com.test.shared.domain.customExceptions.ConflictException;
import com.test.shared.domain.customExceptions.DomainException;
import com.test.shared.domain.customExceptions.ForbiddenException;
import com.test.shared.domain.customExceptions.InvalidStateTransitionException;
import com.test.shared.domain.customExceptions.NotFoundException;
import com.test.shared.domain.customExceptions.UnauthorizedException;
import com.test.shared.domain.customExceptions.ValidationException;
import com.test.shared.domain.errorMessage.ErrorResponse;
import com.test.warehouse.domain.errors.WarehouseUnavailableError;
import jakarta.validation.ConstraintViolationException;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class HandlerExceptions {

    private static final Logger log = LoggerFactory.getLogger(HandlerExceptions.class);

    // ── Validation errors ──────────────────────────────────────────

    @ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseBody
    public ErrorResponse onMethodArgumentNotValidException(MethodArgumentNotValidException ex) {
        List<String> details = ex
            .getBindingResult()
            .getFieldErrors()
            .stream()
            .map(error -> error.getField() + " " + error.getDefaultMessage())
            .toList();
        return new ErrorResponse(
            HttpStatus.UNPROCESSABLE_ENTITY.value(),
            "Validation Error",
            "VALIDATION_ERROR",
            "Validation failed",
            details
        );
    }

    @ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
    @ExceptionHandler(ConstraintViolationException.class)
    @ResponseBody
    public ErrorResponse onConstraintViolationException(ConstraintViolationException ex) {
        List<String> details = ex
            .getConstraintViolations()
            .stream()
            .map(v -> v.getPropertyPath() + " " + v.getMessage())
            .toList();
        return new ErrorResponse(
            HttpStatus.UNPROCESSABLE_ENTITY.value(),
            "Validation Error",
            "VALIDATION_ERROR",
            "Constraint violation",
            details
        );
    }

    @ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
    @ExceptionHandler(HandlerMethodValidationException.class)
    @ResponseBody
    public ErrorResponse onHandlerMethodValidationException(HandlerMethodValidationException ex) {
        List<String> details = ex
            .getAllErrors()
            .stream()
            .map(org.springframework.context.MessageSourceResolvable::getDefaultMessage)
            .toList();
        return new ErrorResponse(
            HttpStatus.UNPROCESSABLE_ENTITY.value(),
            "Validation Error",
            "VALIDATION_ERROR",
            "Constraint violation",
            details
        );
    }

    @ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
    @ExceptionHandler(ValidationException.class)
    @ResponseBody
    public ErrorResponse onValidationException(ValidationException ex) {
        String message =
            ex.getRowNumber() != null ? "Row " + ex.getRowNumber() + ": " + ex.getMessage() : ex.getMessage();
        return new ErrorResponse(HttpStatus.UNPROCESSABLE_ENTITY.value(), "Validation Error", message);
    }

    // ── Spring framework errors ────────────────────────────────────

    @ResponseStatus(HttpStatus.BAD_REQUEST)
    @ExceptionHandler(
        {
            HttpMessageNotReadableException.class,
            MethodArgumentTypeMismatchException.class,
            IllegalArgumentException.class
        }
    )
    @ResponseBody
    public ErrorResponse onMalformedRequest(Exception ex) {
        return new ErrorResponse(HttpStatus.BAD_REQUEST.value(), "Bad Request", "Malformed request");
    }

    @ResponseStatus(HttpStatus.METHOD_NOT_ALLOWED)
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    @ResponseBody
    public ErrorResponse onMethodNotAllowed(HttpRequestMethodNotSupportedException ex) {
        return new ErrorResponse(
            HttpStatus.METHOD_NOT_ALLOWED.value(),
            "Method Not Allowed",
            "HTTP method not supported"
        );
    }

    @ResponseStatus(HttpStatus.CONFLICT)
    @ExceptionHandler(DataIntegrityViolationException.class)
    @ResponseBody
    public ResponseEntity<ErrorResponse> onDataIntegrityViolation(DataIntegrityViolationException ex) {
        ErrorResponse body = new ErrorResponse(
            HttpStatus.CONFLICT.value(),
            "Conflict",
            "Data integrity violation — a constraint was not satisfied"
        );
        return ResponseEntity.status(HttpStatus.CONFLICT).body(body);
    }

    // ── Security errors ────────────────────────────────────────────

    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    @ExceptionHandler(UnauthorizedException.class)
    @ResponseBody
    public ErrorResponse onUnauthorizedException(UnauthorizedException ex) {
        return buildResponse(HttpStatus.UNAUTHORIZED, "Unauthorized", ex, "Authentication required");
    }

    @ResponseStatus(HttpStatus.FORBIDDEN)
    @ExceptionHandler(ForbiddenException.class)
    @ResponseBody
    public ErrorResponse onForbiddenException(ForbiddenException ex) {
        return buildResponse(HttpStatus.FORBIDDEN, "Forbidden", ex, "Access denied");
    }

    // ── Domain exceptions ──────────────────────────────────────────

    @ResponseStatus(HttpStatus.BAD_REQUEST)
    @ExceptionHandler(BadRequestException.class)
    @ResponseBody
    public ErrorResponse onBadRequestException(BadRequestException ex) {
        return buildResponse(HttpStatus.BAD_REQUEST, "Bad Request", ex, "Bad request");
    }

    @ResponseStatus(HttpStatus.NOT_FOUND)
    @ExceptionHandler(NotFoundException.class)
    @ResponseBody
    public ErrorResponse onNotFoundException(NotFoundException ex) {
        return buildResponse(HttpStatus.NOT_FOUND, "Not Found", ex, "Resource not found");
    }

    @ResponseStatus(HttpStatus.CONFLICT)
    @ExceptionHandler(ConflictException.class)
    @ResponseBody
    public ErrorResponse onConflictException(ConflictException ex) {
        return buildResponse(HttpStatus.CONFLICT, "Conflict", ex, "Resource conflict");
    }

    @ResponseStatus(HttpStatus.CONFLICT)
    @ExceptionHandler(InvalidStateTransitionException.class)
    @ResponseBody
    public ErrorResponse onInvalidStateTransitionException(InvalidStateTransitionException ex) {
        return new ErrorResponse(
            HttpStatus.CONFLICT.value(),
            "Invalid State Transition",
            ex.getMessage() != null ? ex.getMessage() : "State transition not allowed"
        );
    }

    @ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
    @ExceptionHandler(BusinessException.class)
    @ResponseBody
    public ErrorResponse onBusinessException(BusinessException ex) {
        return buildResponse(
            HttpStatus.UNPROCESSABLE_ENTITY,
            "Business Rule Violation",
            ex,
            "A business rule was violated"
        );
    }

    // ── Generic DomainException with dynamic httpStatus ────────────
    // Catches errors generated for extended HTTP statuses (402, 408, 412, 415,
    // 423, 429, 503, 504) which extend DomainException directly. The status
    // and code are read from the structured DomainException metadata.
    @ExceptionHandler(DomainException.class)
    @ResponseBody
    public ResponseEntity<ErrorResponse> onDomainException(DomainException ex) {
        Integer status = ex.getHttpStatus();
        HttpStatus http = status != null ? HttpStatus.valueOf(status) : HttpStatus.UNPROCESSABLE_ENTITY;
        ErrorResponse body = new ErrorResponse(
            http.value(),
            http.getReasonPhrase(),
            ex.getCode(),
            ex.getMessage() != null ? ex.getMessage() : http.getReasonPhrase(),
            ex.getDetails()
        );
        return ResponseEntity.status(http).body(body);
    }

    // ── Infrastructure → domain error translation ─────────────────
    // [Phase 4, Gap E5] Each `errors[]` entry declared with
    // `kind: infrastructure` and `triggeredBy: <Exception>` produces a
    // dedicated handler that converts the underlying JVM exception into
    // the corresponding domain error. The original cause is preserved as
    // the throwable cause when the domain error declares `chainable: true`.

    @ExceptionHandler(DataAccessException.class)
    @ResponseBody
    public ResponseEntity<ErrorResponse> onWarehouseUnavailableError(DataAccessException ex) {
        log.warn("Infrastructure failure mapped to WAREHOUSE_UNAVAILABLE", ex);
        DomainException domainEx = new WarehouseUnavailableError();
        Integer rawStatus = domainEx.getHttpStatus();
        HttpStatus status = rawStatus != null ? HttpStatus.valueOf(rawStatus) : HttpStatus.SERVICE_UNAVAILABLE;
        ErrorResponse body = new ErrorResponse(
            status.value(),
            status.getReasonPhrase(),
            domainEx.getCode(),
            domainEx.getMessage() != null ? domainEx.getMessage() : status.getReasonPhrase(),
            domainEx.getDetails()
        );
        return ResponseEntity.status(status).body(body);
    }

    // ── Catch-all ──────────────────────────────────────────────────

    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    @ExceptionHandler(Exception.class)
    @ResponseBody
    public ErrorResponse onServerError(Exception ex) {
        log.error("Unhandled exception", ex);
        return new ErrorResponse(
            HttpStatus.INTERNAL_SERVER_ERROR.value(),
            "Internal Server Error",
            "An unexpected error occurred"
        );
    }

    // ── Helpers ────────────────────────────────────────────────────

    private static ErrorResponse buildResponse(
        HttpStatus status,
        String error,
        DomainException ex,
        String fallbackMessage
    ) {
        String message = ex.getMessage() != null ? ex.getMessage() : fallbackMessage;
        return new ErrorResponse(status.value(), error, ex.getCode(), message, ex.getDetails());
    }
}
