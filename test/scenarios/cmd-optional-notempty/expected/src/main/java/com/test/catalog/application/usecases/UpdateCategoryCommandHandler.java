package com.test.catalog.application.usecases;

import com.test.catalog.application.commands.UpdateCategoryCommand;
import com.test.catalog.domain.repository.CategoryRepository;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-CAT-002]
@ApplicationComponent
public class UpdateCategoryCommandHandler implements CommandHandler<UpdateCategoryCommand> {

    private final CategoryRepository categoryRepository;

    public UpdateCategoryCommandHandler(CategoryRepository categoryRepository) {
        this.categoryRepository = categoryRepository;
    }

    @Override
    @Transactional
    @LogExceptions
    public void handle(UpdateCategoryCommand command) {
        // 1. Load Category via categoryRepository.findById(...) (throws CategoryNotFoundError)
        // 2. categoryRepository.save(category)

        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
