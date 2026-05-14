package com.test.catalog.infrastructure.rest.controllers.product.v1;

import com.test.catalog.application.dtos.ProductPriceValidationResultDto;
import com.test.catalog.application.queries.ValidateProductPricesQuery;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/internal/catalog/prices/validate")
@Slf4j
@Tag(name = "Product", description = "Product Management API")
public class ProductV1Controller {

    private final UseCaseMediator useCaseMediator;

    public ProductV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * Validate prices for a list of products and return per-item results.
     */
    @PostMapping
    @ResponseStatus(HttpStatus.OK)
    @Operation(hidden = true)
    public ProductPriceValidationResultDto validateProductPrices(@Valid @RequestBody ValidateProductPricesQuery query) {
        log.info("validateProductPrices");
        return useCaseMediator.dispatch(query);
    }
}
