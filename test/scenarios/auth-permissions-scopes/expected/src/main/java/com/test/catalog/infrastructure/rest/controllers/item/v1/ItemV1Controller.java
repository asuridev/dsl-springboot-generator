package com.test.catalog.infrastructure.rest.controllers.item.v1;

import com.test.catalog.application.commands.ArchiveItemCommand;
import com.test.catalog.application.commands.CreateItemCommand;
import com.test.catalog.application.commands.UpdateItemCommand;
import com.test.catalog.application.dtos.ItemDetail;
import com.test.catalog.application.queries.GetItemByIdQuery;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
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
     * Get item by ID
     */
    @GetMapping("/{itemId}")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Get item by ID")
    @PreAuthorize("hasAnyAuthority('catalog:read')")
    public ItemDetail getItemById(@PathVariable String itemId) {
        log.info("getItemById — itemId: {}", itemId);
        return useCaseMediator.dispatch(new GetItemByIdQuery(itemId));
    }

    /**
     * Create a catalog item
     */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Create a catalog item")
    @PreAuthorize("hasAnyAuthority('SCOPE_catalog:write')")
    public void createItem(@Valid @RequestBody CreateItemCommand command) {
        log.info("createItem");
        useCaseMediator.dispatch(command);
    }

    /**
     * Update a catalog item
     */
    @PutMapping("/{itemId}")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Update a catalog item")
    @PreAuthorize("hasAnyAuthority('SCOPE_catalog:write') and hasAnyRole('MANAGER')")
    public void updateItem(@PathVariable String itemId, @Valid @RequestBody UpdateItemCommand command) {
        log.info("updateItem — itemId: {}", itemId);
        useCaseMediator.dispatch(new UpdateItemCommand(itemId, command.name()));
    }

    /**
     * Archive a catalog item
     */
    @PostMapping("/{itemId}/archive")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Archive a catalog item")
    @PreAuthorize(
        "hasAnyAuthority('SCOPE_catalog:admin') and hasAnyRole('ADMIN') and hasAnyAuthority('catalog:archive')"
    )
    public void archiveItem(@PathVariable String itemId) {
        log.info("archiveItem — itemId: {}", itemId);
        useCaseMediator.dispatch(new ArchiveItemCommand(itemId));
    }
}
