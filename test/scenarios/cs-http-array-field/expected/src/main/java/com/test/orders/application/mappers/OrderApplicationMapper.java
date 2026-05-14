package com.test.orders.application.mappers;

import com.test.orders.application.dtos.OrderResponseDto;
import com.test.orders.domain.aggregate.Order;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class OrderApplicationMapper {

    public OrderResponseDto toResponseDto(Order domain) {
        return new OrderResponseDto(domain.getId());
    }

    public List<OrderResponseDto> toResponseDtoList(List<Order> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
