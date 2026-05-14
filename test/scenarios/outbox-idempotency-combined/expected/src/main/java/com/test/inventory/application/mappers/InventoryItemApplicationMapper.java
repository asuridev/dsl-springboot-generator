package com.test.inventory.application.mappers;

import com.test.inventory.application.dtos.InventoryItemResponseDto;
import com.test.inventory.domain.aggregate.InventoryItem;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class InventoryItemApplicationMapper {

    public InventoryItemResponseDto toResponseDto(InventoryItem domain) {
        return new InventoryItemResponseDto(domain.getId(), domain.getProductId(), domain.getStock());
    }

    public List<InventoryItemResponseDto> toResponseDtoList(List<InventoryItem> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
