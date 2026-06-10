package com.test.catalog.application.usecases;

import com.test.catalog.application.commands.CreateTagCommand;
import com.test.catalog.domain.repository.TagRepository;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.ReturningCommandHandler;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-TAG-001]
@ApplicationComponent
public class CreateTagCommandHandler implements ReturningCommandHandler<CreateTagCommand, UUID> {

    private final TagRepository tagRepository;

    public CreateTagCommandHandler(TagRepository tagRepository) {
        this.tagRepository = tagRepository;
    }

    @Override
    @Transactional
    @LogExceptions
    public UUID handle(CreateTagCommand command) {
        // 1. Build the Tag aggregate (Tag.create(...) / new Tag(...))
        // 2. tagRepository.save(tag)

        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
