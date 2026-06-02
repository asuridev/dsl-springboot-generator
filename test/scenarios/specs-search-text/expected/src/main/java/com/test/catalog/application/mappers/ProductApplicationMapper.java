package com.test.catalog.application.mappers;

import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.catalog.domain.aggregate.Product;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class ProductApplicationMapper {

    public ProductResponseDto toResponseDto(Product domain) {
        return new ProductResponseDto(
            domain.getId(),
            domain.getName(),
            domain.getDescription(),
            domain.getSku(),
            domain.getCreatedAt(),
            domain.getUpdatedAt()
        );
    }

    public List<ProductResponseDto> toResponseDtoList(List<Product> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
