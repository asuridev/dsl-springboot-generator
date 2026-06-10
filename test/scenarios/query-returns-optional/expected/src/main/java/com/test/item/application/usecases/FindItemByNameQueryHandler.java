package com.test.item.application.usecases;

import com.test.item.application.dtos.ItemResponseDto;
import com.test.item.application.queries.FindItemByNameQuery;
import com.test.item.domain.repository.ItemRepository;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import java.util.Optional;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[find-item-by-name]
@ApplicationComponent
public class FindItemByNameQueryHandler implements QueryHandler<FindItemByNameQuery, Optional<ItemResponseDto>> {

    private final ItemRepository itemRepository;

    public FindItemByNameQueryHandler(ItemRepository itemRepository) {
        this.itemRepository = itemRepository;
    }

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public Optional<ItemResponseDto> handle(FindItemByNameQuery query) {
        // TODO: implement business logic — ver item-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
