package com.test.ordering.application.mappers;

import com.test.ordering.application.dtos.OrderRecordResponseDto;
import com.test.ordering.domain.aggregate.OrderRecord;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class OrderRecordApplicationMapper {

    public OrderRecordResponseDto toResponseDto(OrderRecord domain) {
        return new OrderRecordResponseDto(domain.getId(), domain.getBuyerId(), domain.getStatus());
    }

    public List<OrderRecordResponseDto> toResponseDtoList(List<OrderRecord> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
