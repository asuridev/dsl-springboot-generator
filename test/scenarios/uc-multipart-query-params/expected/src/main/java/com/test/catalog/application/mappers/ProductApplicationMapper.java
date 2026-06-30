package com.test.catalog.application.mappers;

import com.test.catalog.application.dtos.ProductImageResponseDto;
import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.catalog.domain.aggregate.Product;
import com.test.catalog.domain.entity.ProductImage;
import com.test.shared.domain.valueobject.StoredObject;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class ProductApplicationMapper {

    public ProductResponseDto toResponseDto(Product domain) {
        return new ProductResponseDto(
            domain.getId(),
            domain.getName(),
            domain.getProductImages().stream().map(this::toProductImageResponseDto).toList()
        );
    }

    public List<ProductResponseDto> toResponseDtoList(List<Product> list) {
        return list.stream().map(this::toResponseDto).toList();
    }

    public ProductImageResponseDto toProductImageResponseDto(ProductImage child) {
        return new ProductImageResponseDto(child.getId(), child.getMedia());
    }
}
