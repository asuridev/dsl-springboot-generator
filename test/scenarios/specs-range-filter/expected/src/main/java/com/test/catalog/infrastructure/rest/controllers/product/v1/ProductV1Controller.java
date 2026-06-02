package com.test.catalog.infrastructure.rest.controllers.product.v1;

import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.catalog.application.queries.SearchProductsByPriceRangeQuery;
import com.test.shared.application.dtos.PagedResponse;
import com.test.shared.application.dtos.Range;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
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
     * Search products filtered by price range
     */
    @GetMapping
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Search products filtered by price range")
    public PagedResponse<ProductResponseDto> searchProductsByPriceRange(
        @RequestParam(name = "priceRangeMin", required = false) BigDecimal priceRangeMin,
        @RequestParam(name = "priceRangeMax", required = false) BigDecimal priceRangeMax,
        @RequestParam(name = "page", defaultValue = "0") int page,
        @RequestParam(name = "size", defaultValue = "20") int size,
        @RequestParam(name = "sortBy", required = false) String sortBy,
        @RequestParam(name = "sortDirection", required = false) String sortDirection
    ) {
        log.info("searchProductsByPriceRange");
        return useCaseMediator.dispatch(
            new SearchProductsByPriceRangeQuery(
                new Range<>(priceRangeMin, priceRangeMax),
                page,
                size,
                sortBy,
                sortDirection
            )
        );
    }
}
