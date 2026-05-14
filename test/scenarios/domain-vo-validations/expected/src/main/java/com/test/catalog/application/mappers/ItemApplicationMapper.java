package com.test.catalog.application.mappers;

import com.test.catalog.application.dtos.ItemResponseDto;
import com.test.catalog.domain.aggregate.Item;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class ItemApplicationMapper {

    public ItemResponseDto toResponseDto(Item domain) {
        return new ItemResponseDto(domain.getId());
    }

    public List<ItemResponseDto> toResponseDtoList(List<Item> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
