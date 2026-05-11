package com.test.catalog.application.usecases;

import com.test.catalog.application.dtos.ItemDetail;
import com.test.catalog.application.queries.GetItemByIdQuery;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-CAT-001]
@ApplicationComponent
public class GetItemByIdQueryHandler implements QueryHandler<GetItemByIdQuery, ItemDetail> {

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public ItemDetail handle(GetItemByIdQuery query) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
