package com.test.orders.infrastructure.rest.controllers.order.v1;

import com.test.orders.application.dtos.OrderDetailsResultDto;
import com.test.orders.application.queries.GetOrderDetailsQuery;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/internal/orders")
@Slf4j
@Tag(name = "Order", description = "Order Management API")
public class OrderV1Controller {

    private final UseCaseMediator useCaseMediator;

    public OrderV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * Get order details including all line items.
     */
    @GetMapping("/{orderId}")
    @ResponseStatus(HttpStatus.OK)
    @Operation(hidden = true)
    public OrderDetailsResultDto getOrderDetails(@PathVariable String orderId) {
        log.info("getOrderDetails — orderId: {}", orderId);
        return useCaseMediator.dispatch(new GetOrderDetailsQuery(orderId));
    }
}
