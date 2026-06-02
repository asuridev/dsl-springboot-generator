package com.test.inventory.application.mappers;

import com.test.inventory.application.dtos.ItemResponseDto;
import com.test.inventory.domain.aggregate.Item;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class ItemApplicationMapper {

    public ItemResponseDto toResponseDto(Item domain) {
        return new ItemResponseDto(domain.getId(), domain.getSku(), domain.getQuantity());
    }

    public List<ItemResponseDto> toResponseDtoList(List<Item> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
