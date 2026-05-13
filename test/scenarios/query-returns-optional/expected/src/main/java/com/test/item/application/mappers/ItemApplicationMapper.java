package com.test.item.application.mappers;

import com.test.item.application.dtos.ItemResponseDto;
import com.test.item.domain.aggregate.Item;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class ItemApplicationMapper {

    public ItemResponseDto toResponseDto(Item domain) {
        return new ItemResponseDto(domain.getId(), domain.getName(), domain.getPrice());
    }

    public List<ItemResponseDto> toResponseDtoList(List<Item> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
