package com.test.inventory.application.usecases;

import com.test.inventory.application.commands.CreateItemCommand;
import com.test.inventory.application.dtos.ItemResponseDto;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.ReturningCommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-INV-001]
@ApplicationComponent
public class CreateItemCommandHandler implements ReturningCommandHandler<CreateItemCommand, ItemResponseDto> {

    @Override
    @Transactional
    @LogExceptions
    public ItemResponseDto handle(CreateItemCommand command) {
        // TODO: implement business logic — ver inventory-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
