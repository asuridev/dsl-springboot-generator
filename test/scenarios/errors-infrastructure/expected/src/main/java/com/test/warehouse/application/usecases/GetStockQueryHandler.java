package com.test.warehouse.application.usecases;

import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import com.test.warehouse.application.dtos.StockResponseDto;
import com.test.warehouse.application.queries.GetStockQuery;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[get-stock]
@ApplicationComponent
public class GetStockQueryHandler implements QueryHandler<GetStockQuery, StockResponseDto> {

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public StockResponseDto handle(GetStockQuery query) {
        // TODO: implement business logic — ver warehouse-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
