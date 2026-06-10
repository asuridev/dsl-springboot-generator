package com.test.catalog.infrastructure.rest.controllers.category.v1;

import com.test.catalog.application.commands.ArchiveCategoryCommand;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/categories")
@Slf4j
@Tag(name = "Category", description = "Category Management API")
public class CategoryV1Controller {

    private final UseCaseMediator useCaseMediator;

    public CategoryV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * archiveCategory
     */
    @PostMapping("/{categoryId}/archive")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "archiveCategory")
    public void archiveCategory(@PathVariable String categoryId) {
        log.info("archiveCategory — categoryId: {}", categoryId);
        useCaseMediator.dispatch(new ArchiveCategoryCommand(categoryId));
    }
}
