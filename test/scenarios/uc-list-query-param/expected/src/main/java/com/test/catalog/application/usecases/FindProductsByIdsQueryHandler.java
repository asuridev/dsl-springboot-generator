package com.test.catalog.application.usecases;

import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.catalog.application.queries.FindProductsByIdsQuery;
import com.test.catalog.domain.repository.ProductRepository;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import java.util.List;
import org.springframework.transaction.annotation.Transactional;

/**
 * Returns products for a set of ids supplied as repeated query parameters (?productIds=a&productIds=b). The input is a List[Uuid] bound from the query string.
 *
 *
 * derived_from: useCases[UC-CAT-001]
 */
@ApplicationComponent
public class FindProductsByIdsQueryHandler implements QueryHandler<FindProductsByIdsQuery, List<ProductResponseDto>> {

    private final ProductRepository productRepository;

    public FindProductsByIdsQueryHandler(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public List<ProductResponseDto> handle(FindProductsByIdsQuery query) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
