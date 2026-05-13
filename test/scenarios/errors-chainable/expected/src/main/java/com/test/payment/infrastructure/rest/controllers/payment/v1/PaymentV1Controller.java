package com.test.payment.infrastructure.rest.controllers.payment.v1;

import com.test.payment.application.commands.ProcessPaymentCommand;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/payments")
@Slf4j
@Tag(name = "Payment", description = "Payment Management API")
public class PaymentV1Controller {

    private final UseCaseMediator useCaseMediator;

    public PaymentV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * Process a payment.
     */
    @PostMapping
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Process a payment.")
    public UUID processPayment(@Valid @RequestBody ProcessPaymentCommand command) {
        log.info("processPayment");
        return useCaseMediator.dispatch(command);
    }
}
