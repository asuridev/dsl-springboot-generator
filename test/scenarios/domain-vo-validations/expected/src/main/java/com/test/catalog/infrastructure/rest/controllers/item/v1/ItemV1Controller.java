package com.test.catalog.infrastructure.rest.controllers.item.v1;

import com.test.catalog.application.commands.CreateItemCommand;
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
     * createItem
     */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "createItem")
    public void createItem(@Valid @RequestBody CreateItemCommand command) {
        log.info("createItem");
        useCaseMediator.dispatch(command);
    }
}
