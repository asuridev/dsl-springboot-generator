package com.test.order.application.usecases;

import com.test.order.application.dtos.OrderResponseDto;
import com.test.order.application.mappers.OrderApplicationMapper;
import com.test.order.application.queries.GetOrderQuery;
import com.test.order.domain.aggregate.Order;
import com.test.order.domain.errors.OrderNotFoundError;
import com.test.order.domain.repository.OrderRepository;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[get-order]
@ApplicationComponent
public class GetOrderQueryHandler implements QueryHandler<GetOrderQuery, OrderResponseDto> {

    private final OrderRepository orderRepository;
    private final OrderApplicationMapper orderApplicationMapper;

    public GetOrderQueryHandler(OrderRepository orderRepository, OrderApplicationMapper orderApplicationMapper) {
        this.orderRepository = orderRepository;
        this.orderApplicationMapper = orderApplicationMapper;
    }

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public OrderResponseDto handle(GetOrderQuery query) {
        Order order = orderRepository
            .findById(UUID.fromString(query.orderId()))
            .orElseThrow(() -> new OrderNotFoundError(UUID.fromString(query.orderId())));
        return orderApplicationMapper.toResponseDto(order);
    }
}
