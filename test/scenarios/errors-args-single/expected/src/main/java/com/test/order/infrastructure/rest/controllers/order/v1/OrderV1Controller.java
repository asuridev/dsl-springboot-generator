package com.test.order.infrastructure.rest.controllers.order.v1;

import com.test.order.application.dtos.OrderResponseDto;
import com.test.order.application.queries.GetOrderByRefQuery;
import com.test.order.application.queries.GetOrderQuery;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
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
     * Get order by ID.
     */
    @GetMapping("/{orderId}")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Get order by ID.")
    public OrderResponseDto getOrder(@PathVariable String orderId) {
        log.info("getOrder — orderId: {}", orderId);
        return useCaseMediator.dispatch(new GetOrderQuery(orderId));
    }

    /**
     * Get order by reference number.
     */
    @GetMapping("/by-reference/{reference}")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Get order by reference number.")
    public OrderResponseDto getOrderByRef(@PathVariable String reference) {
        log.info("getOrderByRef — reference: {}", reference);
        return useCaseMediator.dispatch(new GetOrderByRefQuery(reference));
    }
}
