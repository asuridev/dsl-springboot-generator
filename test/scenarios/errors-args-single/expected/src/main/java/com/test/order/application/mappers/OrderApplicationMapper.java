package com.test.order.application.mappers;

import com.test.order.application.dtos.OrderResponseDto;
import com.test.order.domain.aggregate.Order;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class OrderApplicationMapper {

    public OrderResponseDto toResponseDto(Order domain) {
        return new OrderResponseDto(domain.getId(), domain.getReference());
    }

    public List<OrderResponseDto> toResponseDtoList(List<Order> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
