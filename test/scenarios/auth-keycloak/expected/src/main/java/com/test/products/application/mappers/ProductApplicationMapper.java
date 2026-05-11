package com.test.products.application.mappers;

import com.test.products.application.dtos.ProductResponseDto;
import com.test.products.domain.aggregate.Product;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class ProductApplicationMapper {

    public ProductResponseDto toResponseDto(Product domain) {
        return new ProductResponseDto(
            domain.getId(),
            domain.getName(),
            domain.getStatus(),
            domain.getCreatedAt(),
            domain.getUpdatedAt()
        );
    }

    public List<ProductResponseDto> toResponseDtoList(List<Product> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
