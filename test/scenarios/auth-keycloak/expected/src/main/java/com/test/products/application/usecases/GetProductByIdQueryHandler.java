package com.test.products.application.usecases;

import com.test.products.application.dtos.ProductDetail;
import com.test.products.application.queries.GetProductByIdQuery;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-PRD-010]
@ApplicationComponent
public class GetProductByIdQueryHandler implements QueryHandler<GetProductByIdQuery, ProductDetail> {

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public ProductDetail handle(GetProductByIdQuery query) {
        // TODO: implement business logic — ver products-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
