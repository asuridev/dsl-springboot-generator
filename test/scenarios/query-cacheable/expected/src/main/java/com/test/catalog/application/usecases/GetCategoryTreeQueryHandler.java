package com.test.catalog.application.usecases;

import com.test.catalog.application.dtos.CategoryTree;
import com.test.catalog.application.queries.GetCategoryTreeQuery;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-CAT-020]
@ApplicationComponent
public class GetCategoryTreeQueryHandler implements QueryHandler<GetCategoryTreeQuery, CategoryTree> {

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    @Cacheable(cacheNames = "getCategoryTree")
    public CategoryTree handle(GetCategoryTreeQuery query) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
