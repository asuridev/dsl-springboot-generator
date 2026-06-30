package com.test.catalog.infrastructure.rest.controllers.product.v1;

import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.catalog.application.queries.AdminSearchProductsQuery;
import com.test.catalog.application.queries.SearchProductsQuery;
import com.test.catalog.domain.enums.ProductStatus;
import com.test.shared.application.dtos.PagedResponse;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
@Slf4j
@Tag(name = "Product", description = "Product Management API")
public class ProductV1Controller {

    private final UseCaseMediator useCaseMediator;

    public ProductV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * searchProducts
     */
    @GetMapping("/products")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "searchProducts")
    public PagedResponse<ProductResponseDto> searchProducts(
        @RequestParam(required = false) String categoryId,
        @RequestParam(required = false) String search,
        @RequestParam(name = "page", defaultValue = "0") int page,
        @RequestParam(name = "size", defaultValue = "20") @Max(100) int size,
        @RequestParam(name = "sortBy", required = false) String sortBy,
        @RequestParam(name = "sortDirection", required = false) String sortDirection
    ) {
        log.info("searchProducts");
        return useCaseMediator.dispatch(new SearchProductsQuery(categoryId, search, page, size, sortBy, sortDirection));
    }

    /**
     * adminSearchProducts
     */
    @GetMapping("/admin/products")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "adminSearchProducts")
    public PagedResponse<ProductResponseDto> adminSearchProducts(
        @RequestParam(required = false) String categoryId,
        @RequestParam(required = false) ProductStatus status,
        @RequestParam(required = false) String search,
        @RequestParam(name = "page", defaultValue = "0") int page,
        @RequestParam(name = "size", defaultValue = "20") @Max(100) int size,
        @RequestParam(name = "sortBy", required = false) String sortBy,
        @RequestParam(name = "sortDirection", required = false) String sortDirection
    ) {
        log.info("adminSearchProducts");
        return useCaseMediator.dispatch(
            new AdminSearchProductsQuery(categoryId, status, search, page, size, sortBy, sortDirection)
        );
    }
}
