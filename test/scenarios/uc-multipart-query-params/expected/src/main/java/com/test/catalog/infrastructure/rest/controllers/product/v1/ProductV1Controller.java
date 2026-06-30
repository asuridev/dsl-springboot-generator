package com.test.catalog.infrastructure.rest.controllers.product.v1;

import com.test.catalog.application.commands.AddProductImageCommand;
import com.test.catalog.application.commands.CreateProductCommand;
import com.test.catalog.application.commands.RemoveProductImageCommand;
import com.test.catalog.domain.enums.ImageType;
import com.test.shared.domain.customExceptions.BadRequestException;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.UnsupportedMediaTypeStatusException;

@RestController
@RequestMapping("/api/v1/products")
@Slf4j
@Tag(name = "Product", description = "Product Management API")
public class ProductV1Controller {

    private final UseCaseMediator useCaseMediator;

    public ProductV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * createProduct
     */
    @PostMapping
    @Operation(summary = "createProduct")
    public ResponseEntity<UUID> createProduct(@Valid @RequestBody CreateProductCommand command) {
        log.info("createProduct");
        UUID id = UUID.randomUUID();
        UUID result = useCaseMediator.dispatch(new CreateProductCommand(id, command.name()));
        return ResponseEntity.created(URI.create("/api/v1/products/" + id)).body(result);
    }

    /**
     * addProductImage
     */
    @PostMapping(value = "/{productId}/images", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "addProductImage")
    public void addProductImage(
        @PathVariable String productId,
        @RequestPart(value = "file") MultipartFile file,
        @RequestParam(value = "altText", required = false) String altText,
        @RequestParam(value = "position", required = false) Integer position,
        @RequestParam(value = "imageType", required = true) ImageType imageType
    ) {
        log.info("addProductImage — productId: {}", productId);
        if (file == null || file.isEmpty()) {
            throw new BadRequestException("file: file part is required");
        }
        if (file != null && file.getSize() > 5242880L) {
            throw new BadRequestException("file: file exceeds max size 5MB");
        }
        if (
            file != null &&
            !file.isEmpty() &&
            !java.util.Set.of("image/png", "image/jpeg", "image/webp").contains(file.getContentType())
        ) {
            throw new UnsupportedMediaTypeStatusException(
                "file: unsupported content type — allowed: image/png, image/jpeg, image/webp"
            );
        }
        useCaseMediator.dispatch(new AddProductImageCommand(productId, file, altText, position, imageType));
    }

    /**
     * removeProductImage
     */
    @DeleteMapping("/{productId}/images/{imageId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "removeProductImage")
    public void removeProductImage(@PathVariable String productId, @PathVariable String imageId) {
        log.info("removeProductImage — productId, imageId: {}, {}", productId, imageId);
        useCaseMediator.dispatch(new RemoveProductImageCommand(productId, imageId));
    }
}
