package com.test.catalog.application.commands;

import com.test.catalog.domain.enums.ImageType;
import com.test.shared.domain.interfaces.Command;
import org.springframework.web.multipart.MultipartFile;

// derived_from: useCases[UC-CAT-011]
public record AddProductImageCommand(
    String productId,
    MultipartFile file,
    String altText,
    ImageType imageType,
    Integer displayOrder
) implements Command {}
