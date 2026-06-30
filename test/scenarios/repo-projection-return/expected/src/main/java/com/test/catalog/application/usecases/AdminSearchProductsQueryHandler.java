package com.test.catalog.application.usecases;

import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.catalog.application.queries.AdminSearchProductsQuery;
import com.test.catalog.domain.repository.ProductRepository;
import com.test.shared.application.dtos.PagedResponse;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-CAT-002]
@ApplicationComponent
public class AdminSearchProductsQueryHandler
    implements QueryHandler<AdminSearchProductsQuery, PagedResponse<ProductResponseDto>>
{

    private final ProductRepository productRepository;

    public AdminSearchProductsQueryHandler(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public PagedResponse<ProductResponseDto> handle(AdminSearchProductsQuery query) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
