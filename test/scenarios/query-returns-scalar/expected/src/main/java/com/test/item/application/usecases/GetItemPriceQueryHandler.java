package com.test.item.application.usecases;

import com.test.item.application.queries.GetItemPriceQuery;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import java.math.BigDecimal;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[get-item-price]
@ApplicationComponent
public class GetItemPriceQueryHandler implements QueryHandler<GetItemPriceQuery, BigDecimal> {

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public BigDecimal handle(GetItemPriceQuery query) {
        // TODO: implement business logic — ver item-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
