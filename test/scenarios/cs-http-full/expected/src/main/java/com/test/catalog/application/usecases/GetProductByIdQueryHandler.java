package com.test.catalog.application.usecases;

import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.catalog.application.queries.GetProductByIdQuery;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[get-product-by-id]
@ApplicationComponent
public class GetProductByIdQueryHandler implements QueryHandler<GetProductByIdQuery, ProductResponseDto> {

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public ProductResponseDto handle(GetProductByIdQuery query) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
