package com.test.catalog.infrastructure.rest.controllers.product.v1;

import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.catalog.application.queries.ListMyProductsQuery;
import com.test.catalog.domain.enums.ProductStatus;
import com.test.shared.application.dtos.PagedResponse;
import com.test.shared.domain.customExceptions.BadRequestException;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/products/mine")
@Slf4j
@Tag(name = "Product", description = "Product Management API")
public class ProductV1Controller {

    private final UseCaseMediator useCaseMediator;

    public ProductV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * List products owned by the authenticated user.
     */
    @GetMapping
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "List products owned by the authenticated user.")
    public PagedResponse<ProductResponseDto> listMyProducts(
        @RequestParam(required = false) ProductStatus status,
        @RequestParam(name = "page", defaultValue = "0") int page,
        @RequestParam(name = "size", defaultValue = "20") @Max(100) int size,
        @RequestParam(name = "sortBy", defaultValue = "name") String sortBy,
        @RequestParam(name = "sortDirection", defaultValue = "ASC") String sortDirection
    ) {
        log.info("listMyProducts");
        if (!java.util.Set.of("name").contains(sortBy)) {
            throw new BadRequestException("sortBy must be one of: name");
        }
        return useCaseMediator.dispatch(new ListMyProductsQuery(status, page, size, sortBy, sortDirection));
    }
}
