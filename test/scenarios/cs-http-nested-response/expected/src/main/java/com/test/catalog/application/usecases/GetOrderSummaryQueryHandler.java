package com.test.catalog.application.usecases;

import com.test.catalog.application.dtos.OrderSummaryResultDto;
import com.test.catalog.application.queries.GetOrderSummaryQuery;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[get-order-summary]
@ApplicationComponent
public class GetOrderSummaryQueryHandler implements QueryHandler<GetOrderSummaryQuery, OrderSummaryResultDto> {

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public OrderSummaryResultDto handle(GetOrderSummaryQuery query) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
