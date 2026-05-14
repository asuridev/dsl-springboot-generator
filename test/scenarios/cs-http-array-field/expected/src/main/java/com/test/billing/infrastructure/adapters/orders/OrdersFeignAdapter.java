package com.test.billing.infrastructure.adapters.orders;

import com.test.billing.application.ports.OrdersServicePort;
import com.test.billing.domain.models.orders.OrderDetailsResult;
import org.springframework.stereotype.Component;

/**
 * Feign adapter — infrastructure implementation of {@link OrdersServicePort}.
 * Delegates HTTP calls to {@link OrdersFeignClient} and maps
 * infrastructure DTOs to domain models via {@link OrdersAclMapper}.
 */
@Component
public class OrdersFeignAdapter implements OrdersServicePort {

    private final OrdersFeignClient feignClient;
    private final OrdersAclMapper aclMapper;

    public OrdersFeignAdapter(OrdersFeignClient feignClient, OrdersAclMapper aclMapper) {
        this.feignClient = feignClient;
        this.aclMapper = aclMapper;
    }

    @Override
    public OrderDetailsResult getOrderDetails(String orderId) {
        return aclMapper.toOrderDetailsResult(feignClient.getOrderDetails(orderId));
    }
}
