package com.test.warehouse.infrastructure.rest.controllers.stock.v1;

import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import com.test.warehouse.application.dtos.StockResponseDto;
import com.test.warehouse.application.queries.GetStockQuery;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/stocks")
@Slf4j
@Tag(name = "Stock", description = "Stock Management API")
public class StockV1Controller {

    private final UseCaseMediator useCaseMediator;

    public StockV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * Get stock by ID.
     */
    @GetMapping("/{stockId}")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Get stock by ID.")
    public StockResponseDto getStock(@PathVariable String stockId) {
        log.info("getStock — stockId: {}", stockId);
        return useCaseMediator.dispatch(new GetStockQuery(stockId));
    }
}
