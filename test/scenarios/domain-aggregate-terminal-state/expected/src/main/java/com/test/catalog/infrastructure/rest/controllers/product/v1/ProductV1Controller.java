package com.test.catalog.infrastructure.rest.controllers.product.v1;

import com.test.catalog.application.commands.ActivateProductCommand;
import com.test.catalog.application.commands.DiscontinueProductCommand;
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
     * activateProduct
     */
    @PostMapping("/{productId}/activate")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "activateProduct")
    public void activateProduct(@PathVariable String productId) {
        log.info("activateProduct — productId: {}", productId);
        useCaseMediator.dispatch(new ActivateProductCommand(productId));
    }

    /**
     * discontinueProduct
     */
    @PostMapping("/{productId}/discontinue")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "discontinueProduct")
    public void discontinueProduct(@PathVariable String productId) {
        log.info("discontinueProduct — productId: {}", productId);
        useCaseMediator.dispatch(new DiscontinueProductCommand(productId));
    }
}
