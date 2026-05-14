package com.test.catalog.infrastructure.rest.controllers.product.v1;

import com.test.catalog.application.dtos.AvailableProductDto;
import com.test.catalog.application.queries.ListAvailableProductsQuery;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/internal/products/available")
@Slf4j
@Tag(name = "Product", description = "Product Management API")
public class ProductV1Controller {

    private final UseCaseMediator useCaseMediator;

    public ProductV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * List all available products.
     */
    @GetMapping
    @ResponseStatus(HttpStatus.OK)
    @Operation(hidden = true)
    public AvailableProductDto listAvailableProducts() {
        log.info("listAvailableProducts");
        return useCaseMediator.dispatch(new ListAvailableProductsQuery());
    }
}
