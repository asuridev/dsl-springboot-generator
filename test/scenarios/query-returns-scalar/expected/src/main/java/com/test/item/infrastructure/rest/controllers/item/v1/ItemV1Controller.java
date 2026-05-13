package com.test.item.infrastructure.rest.controllers.item.v1;

import com.test.item.application.queries.GetItemCreatedAtQuery;
import com.test.item.application.queries.GetItemIdQuery;
import com.test.item.application.queries.GetItemPriceQuery;
import com.test.item.application.queries.IsItemAvailableQuery;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/items")
@Slf4j
@Tag(name = "Item", description = "Item Management API")
public class ItemV1Controller {

    private final UseCaseMediator useCaseMediator;

    public ItemV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * Get the UUID of an item by name.
     */
    @GetMapping("/id")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Get the UUID of an item by name.")
    public UUID getItemId(@RequestParam(required = true) String name) {
        log.info("getItemId");
        return useCaseMediator.dispatch(new GetItemIdQuery(name));
    }

    /**
     * Get the current price of an item.
     */
    @GetMapping("/{itemId}/price")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Get the current price of an item.")
    public BigDecimal getItemPrice(@PathVariable String itemId) {
        log.info("getItemPrice — itemId: {}", itemId);
        return useCaseMediator.dispatch(new GetItemPriceQuery(itemId));
    }

    /**
     * Get the creation timestamp of an item.
     */
    @GetMapping("/{itemId}/created-at")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Get the creation timestamp of an item.")
    public Instant getItemCreatedAt(@PathVariable String itemId) {
        log.info("getItemCreatedAt — itemId: {}", itemId);
        return useCaseMediator.dispatch(new GetItemCreatedAtQuery(itemId));
    }

    /**
     * Check if an item is available.
     */
    @GetMapping("/{itemId}/available")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Check if an item is available.")
    public Boolean isItemAvailable(@PathVariable String itemId) {
        log.info("isItemAvailable — itemId: {}", itemId);
        return useCaseMediator.dispatch(new IsItemAvailableQuery(itemId));
    }
}
