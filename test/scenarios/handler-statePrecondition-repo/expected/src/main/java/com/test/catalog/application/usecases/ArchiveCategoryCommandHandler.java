package com.test.catalog.application.usecases;

import com.test.catalog.application.commands.ArchiveCategoryCommand;
import com.test.catalog.domain.repository.CategoryRepository;
import com.test.catalog.domain.repository.ProductRepository;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-CAT-010]
@ApplicationComponent
public class ArchiveCategoryCommandHandler implements CommandHandler<ArchiveCategoryCommand> {

    private final CategoryRepository categoryRepository;

    private final ProductRepository productRepository;

    public ArchiveCategoryCommandHandler(CategoryRepository categoryRepository, ProductRepository productRepository) {
        this.categoryRepository = categoryRepository;

        this.productRepository = productRepository;
    }

    @Override
    @Transactional
    @LogExceptions
    public void handle(ArchiveCategoryCommand command) {
        // 1. Load Category via categoryRepository.findById(...) (throws CategoryNotFoundError)
        // 2. domainRule(CAT-RULE-001, statePrecondition): A category with active products cannot be archived. — enforce via productRepository.countByCategoryId(...)
        // 3. category.archive(...)
        // 4. categoryRepository.save(category)

        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
