package com.test.catalog.infrastructure.rest.controllers.category.v1;

import com.test.catalog.application.commands.CreateCategoryCommand;
import com.test.catalog.application.commands.UpdateCategoryCommand;
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
     * createCategory
     */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "createCategory")
    public void createCategory(@Valid @RequestBody CreateCategoryCommand command) {
        log.info("createCategory");
        useCaseMediator.dispatch(command);
    }

    /**
     * updateCategory
     */
    @PatchMapping("/{categoryId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "updateCategory")
    public void updateCategory(@PathVariable String categoryId, @Valid @RequestBody UpdateCategoryCommand command) {
        log.info("updateCategory — categoryId: {}", categoryId);
        useCaseMediator.dispatch(new UpdateCategoryCommand(categoryId, command.name(), command.description()));
    }
}
