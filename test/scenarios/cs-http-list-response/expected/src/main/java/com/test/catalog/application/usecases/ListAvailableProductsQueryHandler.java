package com.test.catalog.application.usecases;

import com.test.catalog.application.dtos.AvailableProductDto;
import com.test.catalog.application.queries.ListAvailableProductsQuery;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[list-available-products]
@ApplicationComponent
public class ListAvailableProductsQueryHandler
    implements QueryHandler<ListAvailableProductsQuery, AvailableProductDto>
{

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public AvailableProductDto handle(ListAvailableProductsQuery query) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
