package com.test.inventory.application.mappers;

import com.test.inventory.application.dtos.StockItemResponseDto;
import com.test.inventory.domain.aggregate.StockItem;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class StockItemApplicationMapper {

    public StockItemResponseDto toResponseDto(StockItem domain) {
        return new StockItemResponseDto(domain.getId(), domain.getOrderId(), domain.getQuantity());
    }

    public List<StockItemResponseDto> toResponseDtoList(List<StockItem> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
