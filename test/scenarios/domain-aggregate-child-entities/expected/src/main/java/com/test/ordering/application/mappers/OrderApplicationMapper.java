package com.test.ordering.application.mappers;

import com.test.ordering.application.dtos.OrderLineResponseDto;
import com.test.ordering.application.dtos.OrderResponseDto;
import com.test.ordering.domain.aggregate.Order;
import com.test.ordering.domain.entity.OrderLine;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class OrderApplicationMapper {

    public OrderResponseDto toResponseDto(Order domain) {
        return new OrderResponseDto(
            domain.getId(),
            domain.getCustomerId(),
            domain.getOrderLines().stream().map(this::toOrderLineResponseDto).toList(),
            domain.getCreatedAt(),
            domain.getUpdatedAt()
        );
    }

    public List<OrderResponseDto> toResponseDtoList(List<Order> list) {
        return list.stream().map(this::toResponseDto).toList();
    }

    public OrderLineResponseDto toOrderLineResponseDto(OrderLine child) {
        return new OrderLineResponseDto(child.getId(), child.getProductId(), child.getQuantity(), child.getTags());
    }
}
