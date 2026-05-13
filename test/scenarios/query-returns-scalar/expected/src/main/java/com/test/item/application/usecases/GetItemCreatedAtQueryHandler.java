package com.test.item.application.usecases;

import com.test.item.application.queries.GetItemCreatedAtQuery;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import java.time.Instant;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[get-item-created-at]
@ApplicationComponent
public class GetItemCreatedAtQueryHandler implements QueryHandler<GetItemCreatedAtQuery, Instant> {

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public Instant handle(GetItemCreatedAtQuery query) {
        // TODO: implement business logic — ver item-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
