package com.test.catalog.application.usecases;

import com.test.catalog.application.dtos.ProductPage;
import com.test.catalog.application.queries.SearchProductsByCategoryQuery;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-CAT-030]
@ApplicationComponent
public class SearchProductsByCategoryQueryHandler implements QueryHandler<SearchProductsByCategoryQuery, ProductPage> {

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    @Cacheable(
        cacheNames = "searchProductsByCategory",
        key = "#query.categoryId + ':' + #query.page + ':' + #query.size",
        condition = "#query.categoryId != null"
    )
    public ProductPage handle(SearchProductsByCategoryQuery query) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
