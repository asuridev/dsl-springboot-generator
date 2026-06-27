package com.test.catalog.application.mappers;

import com.test.catalog.application.dtos.CategoryResponseDto;
import com.test.catalog.domain.aggregate.Category;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class CategoryApplicationMapper {

    public CategoryResponseDto toResponseDto(Category domain) {
        return new CategoryResponseDto(domain.getId(), domain.getName(), domain.getDescription());
    }

    public List<CategoryResponseDto> toResponseDtoList(List<Category> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
