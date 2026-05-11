package com.test.catalog.infrastructure.rest.controllers.product.v1;

import com.test.catalog.application.dtos.ProductDetail;
import com.test.catalog.application.queries.GetProductByIdQuery;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
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
     * getProductById
     */
    @GetMapping("/{productId}")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "getProductById")
    public ProductDetail getProductById(@PathVariable String productId) {
        log.info("getProductById — productId: {}", productId);
        return useCaseMediator.dispatch(new GetProductByIdQuery(productId));
    }
}
