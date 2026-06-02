package com.test.orders.infrastructure.rest.controllers.order.v1;

import com.test.orders.application.commands.PlaceOrderCommand;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import com.test.shared.infrastructure.web.Idempotent;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/orders")
@Slf4j
@Tag(name = "Order", description = "Order Management API")
public class OrderV1Controller {

    private final UseCaseMediator useCaseMediator;

    public OrderV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * Place a new order (idempotent).
     */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Place a new order (idempotent).")
    @Idempotent(header = "Idempotency-Key", ttl = "PT24H")
    public void placeOrder(@Valid @RequestBody PlaceOrderCommand command) {
        log.info("placeOrder");
        useCaseMediator.dispatch(command);
    }
}
