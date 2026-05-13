package com.test.item.application.usecases;

import com.test.item.application.queries.GetItemIdQuery;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[get-item-id]
@ApplicationComponent
public class GetItemIdQueryHandler implements QueryHandler<GetItemIdQuery, UUID> {

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public UUID handle(GetItemIdQuery query) {
        // TODO: implement business logic — ver item-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
