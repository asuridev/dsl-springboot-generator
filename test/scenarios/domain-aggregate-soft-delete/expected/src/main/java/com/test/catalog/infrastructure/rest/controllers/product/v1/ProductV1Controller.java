package com.test.catalog.infrastructure.rest.controllers.product.v1;

import com.test.catalog.application.commands.CreateProductCommand;
import com.test.catalog.application.commands.DeleteProductCommand;
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
@RequestMapping("/api/v1/products")
@Slf4j
@Tag(name = "Product", description = "Product Management API")
public class ProductV1Controller {

    private final UseCaseMediator useCaseMediator;

    public ProductV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * createProduct
     */
    @PostMapping
    @Operation(summary = "createProduct")
    public ResponseEntity<UUID> createProduct(@Valid @RequestBody CreateProductCommand command) {
        log.info("createProduct");
        UUID id = UUID.randomUUID();
        UUID result = useCaseMediator.dispatch(new CreateProductCommand(id, command.name()));
        return ResponseEntity.created(URI.create("/api/v1/products/" + id)).body(result);
    }

    /**
     * deleteProduct
     */
    @DeleteMapping("/{productId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "deleteProduct")
    public void deleteProduct(@PathVariable String productId) {
        log.info("deleteProduct — productId: {}", productId);
        useCaseMediator.dispatch(new DeleteProductCommand(productId));
    }
}
