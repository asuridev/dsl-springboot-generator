package com.test.catalog.infrastructure.rest.controllers.product.v1;

import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.catalog.application.queries.FindProductsByIdsQuery;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/products/by-ids")
@Slf4j
@Tag(name = "Product", description = "Product Management API")
public class ProductV1Controller {

    private final UseCaseMediator useCaseMediator;

    public ProductV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * Find products by a set of ids.
     */
    @GetMapping
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Find products by a set of ids.")
    public List<ProductResponseDto> findProductsByIds(@RequestParam(required = true) List<String> productIds) {
        log.info("findProductsByIds");
        return useCaseMediator.dispatch(new FindProductsByIdsQuery(productIds));
    }
}
