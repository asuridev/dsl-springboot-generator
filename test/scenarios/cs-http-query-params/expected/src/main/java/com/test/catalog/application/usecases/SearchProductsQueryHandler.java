package com.test.catalog.application.usecases;

import com.test.catalog.application.dtos.ProductSearchResultDto;
import com.test.catalog.application.queries.SearchProductsQuery;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[search-products]
@ApplicationComponent
public class SearchProductsQueryHandler implements QueryHandler<SearchProductsQuery, ProductSearchResultDto> {

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public ProductSearchResultDto handle(SearchProductsQuery query) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
