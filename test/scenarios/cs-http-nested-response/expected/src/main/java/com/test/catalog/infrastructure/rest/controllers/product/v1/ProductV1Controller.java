package com.test.catalog.infrastructure.rest.controllers.product.v1;

import com.test.catalog.application.dtos.OrderSummaryResultDto;
import com.test.catalog.application.queries.GetOrderSummaryQuery;
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
@Tag(name = "Product", description = "Product Management API")
public class ProductV1Controller {

    private final UseCaseMediator useCaseMediator;

    public ProductV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * Get a summary of an order including customer info.
     */
    @GetMapping("/{orderId}/summary")
    @ResponseStatus(HttpStatus.OK)
    @Operation(hidden = true)
    public OrderSummaryResultDto getOrderSummary(@PathVariable String orderId) {
        log.info("getOrderSummary — orderId: {}", orderId);
        return useCaseMediator.dispatch(new GetOrderSummaryQuery(orderId));
    }
}
