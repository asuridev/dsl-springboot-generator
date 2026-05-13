package com.test.warehouse.application.mappers;

import com.test.warehouse.application.dtos.StockResponseDto;
import com.test.warehouse.domain.aggregate.Stock;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class StockApplicationMapper {

    public StockResponseDto toResponseDto(Stock domain) {
        return new StockResponseDto(domain.getId(), domain.getSku(), domain.getQuantity());
    }

    public List<StockResponseDto> toResponseDtoList(List<Stock> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
