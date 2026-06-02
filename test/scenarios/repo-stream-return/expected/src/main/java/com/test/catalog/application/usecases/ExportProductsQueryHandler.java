package com.test.catalog.application.usecases;

import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.catalog.application.queries.ExportProductsQuery;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import java.util.List;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-CAT-001]
@ApplicationComponent
public class ExportProductsQueryHandler implements QueryHandler<ExportProductsQuery, List<ProductResponseDto>> {

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public List<ProductResponseDto> handle(ExportProductsQuery query) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
