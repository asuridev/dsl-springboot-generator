package com.test.item.application.usecases;

import com.test.item.application.queries.IsItemAvailableQuery;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[is-item-available]
@ApplicationComponent
public class IsItemAvailableQueryHandler implements QueryHandler<IsItemAvailableQuery, Boolean> {

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public Boolean handle(IsItemAvailableQuery query) {
        // TODO: implement business logic — ver item-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
