package com.test.catalog.infrastructure.rest.controllers.category.v1;

import com.test.catalog.application.dtos.CategoryTree;
import com.test.catalog.application.queries.GetCategoryTreeQuery;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/categories/tree")
@Slf4j
@Tag(name = "Category", description = "Category Management API")
public class CategoryV1Controller {

    private final UseCaseMediator useCaseMediator;

    public CategoryV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * Get full category tree
     */
    @GetMapping
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Get full category tree")
    public CategoryTree getCategoryTree() {
        log.info("getCategoryTree");
        return useCaseMediator.dispatch(new GetCategoryTreeQuery());
    }
}
