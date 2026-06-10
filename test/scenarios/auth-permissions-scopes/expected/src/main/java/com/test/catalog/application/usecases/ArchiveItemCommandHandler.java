package com.test.catalog.application.usecases;

import com.test.catalog.application.commands.ArchiveItemCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-CAT-004]
@ApplicationComponent
public class ArchiveItemCommandHandler implements CommandHandler<ArchiveItemCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(ArchiveItemCommand command) {
        // 1. item.archive(...)

        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
