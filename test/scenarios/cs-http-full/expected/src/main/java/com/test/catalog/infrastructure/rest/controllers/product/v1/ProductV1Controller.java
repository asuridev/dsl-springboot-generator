package com.test.catalog.infrastructure.rest.controllers.product.v1;

import com.test.catalog.application.commands.ValidateProductsAndPricesCommand;
import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.catalog.application.queries.GetProductByIdQuery;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/internal/products")
@Slf4j
@Tag(name = "Product", description = "Product Management API")
public class ProductV1Controller {

    private final UseCaseMediator useCaseMediator;

    public ProductV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * Validate a product and its price.
     */
    @PostMapping("/validate")
    @ResponseStatus(HttpStatus.OK)
    @Operation(hidden = true)
    public void validateProductsAndPrices(@Valid @RequestBody ValidateProductsAndPricesCommand command) {
        log.info("validateProductsAndPrices");
        useCaseMediator.dispatch(command);
    }

    /**
     * Retrieve a product by its ID.
     */
    @GetMapping("/{productId}")
    @ResponseStatus(HttpStatus.OK)
    @Operation(hidden = true)
    public ProductResponseDto getProductById(@PathVariable String productId) {
        log.info("getProductById — productId: {}", productId);
        return useCaseMediator.dispatch(new GetProductByIdQuery(productId));
    }
}
