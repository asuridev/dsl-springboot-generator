package com.test.item.infrastructure.rest.controllers.item.v1;

import com.test.item.application.commands.FindOrCreateItemCommand;
import com.test.item.application.dtos.ItemResponseDto;
import com.test.item.application.queries.FindItemByNameQuery;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
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
     * Find an item by name, returns null if not found.
     */
    @GetMapping("/search")
    @Operation(summary = "Find an item by name, returns null if not found.")
    public ResponseEntity<ItemResponseDto> findItemByName(@RequestParam(required = true) String name) {
        log.info("findItemByName");
        return useCaseMediator
            .dispatch(new FindItemByNameQuery(name))
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Find an existing item by name or create a new one.
     */
    @PostMapping("/find-or-create")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Find an existing item by name or create a new one.")
    public Optional<ItemResponseDto> findOrCreateItem(@Valid @RequestBody FindOrCreateItemCommand command) {
        log.info("findOrCreateItem");
        return useCaseMediator.dispatch(command);
    }
}
