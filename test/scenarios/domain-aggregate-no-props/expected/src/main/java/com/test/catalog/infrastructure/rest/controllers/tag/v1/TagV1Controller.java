package com.test.catalog.infrastructure.rest.controllers.tag.v1;

import com.test.catalog.application.commands.CreateTagCommand;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/tags")
@Slf4j
@Tag(name = "Tag", description = "Tag Management API")
public class TagV1Controller {

    private final UseCaseMediator useCaseMediator;

    public TagV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * createTag
     */
    @PostMapping
    @Operation(summary = "createTag")
    public ResponseEntity<UUID> createTag() {
        log.info("createTag");
        UUID id = UUID.randomUUID();
        UUID result = useCaseMediator.dispatch(new CreateTagCommand(id));
        return ResponseEntity.created(URI.create("/api/v1/tags/" + id)).body(result);
    }
}
