package com.test.item.infrastructure.rest.controllers.item.v1;

import com.test.item.application.commands.CalculateItemPriceCommand;
import com.test.item.application.commands.CreateItemCommand;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.math.BigDecimal;
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
     * Create a new item and return its generated ID.
     */
    @PostMapping
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Create a new item and return its generated ID.")
    public UUID createItem(@Valid @RequestBody CreateItemCommand command) {
        log.info("createItem");
        return useCaseMediator.dispatch(command);
    }

    /**
     * Calculate the price for a quantity of an item.
     */
    @PostMapping("/{itemId}/price")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Calculate the price for a quantity of an item.")
    public BigDecimal calculateItemPrice(
        @PathVariable String itemId,
        @Valid @RequestBody CalculateItemPriceCommand command
    ) {
        log.info("calculateItemPrice — itemId: {}", itemId);
        return useCaseMediator.dispatch(new CalculateItemPriceCommand(itemId, command.quantity()));
    }
}
