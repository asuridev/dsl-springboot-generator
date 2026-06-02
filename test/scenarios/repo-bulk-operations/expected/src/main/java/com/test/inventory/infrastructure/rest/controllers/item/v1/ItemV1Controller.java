package com.test.inventory.infrastructure.rest.controllers.item.v1;

import com.test.inventory.application.commands.CreateItemCommand;
import com.test.inventory.application.dtos.ItemResponseDto;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
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
     * Create a new inventory item.
     */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Create a new inventory item.")
    public ItemResponseDto createItem(@Valid @RequestBody CreateItemCommand command) {
        log.info("createItem");
        return useCaseMediator.dispatch(command);
    }
}
