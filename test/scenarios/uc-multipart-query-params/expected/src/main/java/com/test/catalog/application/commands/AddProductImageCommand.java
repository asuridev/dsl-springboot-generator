package com.test.catalog.application.commands;

import com.test.catalog.domain.enums.ImageType;
import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.web.multipart.MultipartFile;

// derived_from: useCases[UC-CAT-011]
public record AddProductImageCommand(
    String productId,
    MultipartFile file,
    @Size(max = 200) String altText,
    Integer position,
    @NotNull ImageType imageType
) implements Command {}
