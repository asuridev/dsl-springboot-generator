package com.test.item.application.usecases;

import com.test.item.application.commands.FindOrCreateItemCommand;
import com.test.item.application.dtos.ItemResponseDto;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.ReturningCommandHandler;
import java.util.Optional;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[find-or-create-item]
@ApplicationComponent
public class FindOrCreateItemCommandHandler
    implements ReturningCommandHandler<FindOrCreateItemCommand, Optional<ItemResponseDto>>
{

    @Override
    @Transactional
    @LogExceptions
    public Optional<ItemResponseDto> handle(FindOrCreateItemCommand command) {
        // TODO: implement business logic — ver item-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
