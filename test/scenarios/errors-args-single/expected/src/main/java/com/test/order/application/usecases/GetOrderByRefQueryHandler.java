package com.test.order.application.usecases;

import com.test.order.application.dtos.OrderResponseDto;
import com.test.order.application.queries.GetOrderByRefQuery;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[get-order-by-ref]
@ApplicationComponent
public class GetOrderByRefQueryHandler implements QueryHandler<GetOrderByRefQuery, OrderResponseDto> {

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public OrderResponseDto handle(GetOrderByRefQuery query) {
        // TODO: implement business logic — ver order-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
