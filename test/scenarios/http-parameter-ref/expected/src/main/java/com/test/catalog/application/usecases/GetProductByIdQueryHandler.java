package com.test.catalog.application.usecases;

import com.test.catalog.application.dtos.ProductDetail;
import com.test.catalog.application.queries.GetProductByIdQuery;
import com.test.catalog.domain.repository.ProductRepository;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-PRD-001]
@ApplicationComponent
public class GetProductByIdQueryHandler implements QueryHandler<GetProductByIdQuery, ProductDetail> {

    private final ProductRepository productRepository;

    public GetProductByIdQueryHandler(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public ProductDetail handle(GetProductByIdQuery query) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
