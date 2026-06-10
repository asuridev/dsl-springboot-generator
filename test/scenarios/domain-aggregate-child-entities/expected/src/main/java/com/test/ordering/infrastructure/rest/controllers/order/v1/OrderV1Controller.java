package com.test.ordering.infrastructure.rest.controllers.order.v1;

import com.test.ordering.application.commands.AddOrderLineCommand;
import com.test.ordering.application.commands.CreateOrderCommand;
import com.test.ordering.application.commands.RemoveOrderLineCommand;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
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
     * createOrder
     */
    @PostMapping
    @Operation(summary = "createOrder")
    public ResponseEntity<UUID> createOrder(@Valid @RequestBody CreateOrderCommand command) {
        log.info("createOrder");
        UUID id = UUID.randomUUID();
        UUID result = useCaseMediator.dispatch(new CreateOrderCommand(id, command.customerId()));
        return ResponseEntity.created(URI.create("/api/v1/orders/" + id)).body(result);
    }

    /**
     * addOrderLine
     */
    @PostMapping("/{orderId}/lines")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "addOrderLine")
    public void addOrderLine(@PathVariable String orderId, @Valid @RequestBody AddOrderLineCommand command) {
        log.info("addOrderLine — orderId: {}", orderId);
        useCaseMediator.dispatch(
            new AddOrderLineCommand(orderId, command.productId(), command.quantity(), command.tags())
        );
    }

    /**
     * removeOrderLine
     */
    @DeleteMapping("/{orderId}/lines/{lineId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "removeOrderLine")
    public void removeOrderLine(@PathVariable String orderId, @PathVariable String lineId) {
        log.info("removeOrderLine — orderId, lineId: {}, {}", orderId, lineId);
        useCaseMediator.dispatch(new RemoveOrderLineCommand(orderId, lineId));
    }
}
