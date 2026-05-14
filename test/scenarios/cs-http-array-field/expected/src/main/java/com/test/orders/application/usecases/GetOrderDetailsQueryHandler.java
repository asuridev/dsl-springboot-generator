package com.test.orders.application.usecases;

import com.test.orders.application.dtos.OrderDetailsResultDto;
import com.test.orders.application.queries.GetOrderDetailsQuery;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[get-order-details]
@ApplicationComponent
public class GetOrderDetailsQueryHandler implements QueryHandler<GetOrderDetailsQuery, OrderDetailsResultDto> {

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public OrderDetailsResultDto handle(GetOrderDetailsQuery query) {
        // TODO: implement business logic — ver orders-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
