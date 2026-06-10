package com.test.products.infrastructure.rest.controllers.product.v1;

import com.test.products.application.commands.CreateProductCommand;
import com.test.products.application.dtos.ProductDetail;
import com.test.products.application.queries.GetProductByIdQuery;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
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
     * Create a new product
     */
    @PostMapping
    @Operation(summary = "Create a new product")
    @PreAuthorize("hasAnyRole('ADMIN', 'CATALOG_MANAGER')")
    public ResponseEntity<Void> createProduct(@Valid @RequestBody CreateProductCommand command) {
        log.info("createProduct");
        UUID id = UUID.randomUUID();
        useCaseMediator.dispatch(new CreateProductCommand(id, command.name()));
        return ResponseEntity.created(URI.create("/api/v1/products/" + id)).build();
    }

    /**
     * Get product by ID
     */
    @GetMapping("/{productId}")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Get product by ID")
    @PreAuthorize("hasAnyRole('ADMIN', 'CATALOG_MANAGER', 'CUSTOMER')")
    public ProductDetail getProductById(@PathVariable String productId) {
        log.info("getProductById — productId: {}", productId);
        return useCaseMediator.dispatch(new GetProductByIdQuery(productId));
    }
}
