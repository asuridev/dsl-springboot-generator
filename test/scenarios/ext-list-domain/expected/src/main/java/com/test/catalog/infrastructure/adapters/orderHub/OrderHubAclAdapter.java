package com.test.catalog.infrastructure.adapters.orderHub;

import com.test.catalog.application.ports.OrderHubClientPort;
import com.test.catalog.domain.models.orderHub.OrderSummary;
import org.springframework.stereotype.Component;

/**
 * Feign adapter — infrastructure implementation of {@link OrderHubClientPort}.
 * Delegates HTTP calls to {@link OrderHubRestClient} and maps
 * infrastructure DTOs to domain models via {@link OrderHubAclMapper}.
 */
@Component
public class OrderHubAclAdapter implements OrderHubClientPort {

    private final OrderHubRestClient feignClient;
    private final OrderHubAclMapper aclMapper;

    public OrderHubAclAdapter(OrderHubRestClient feignClient, OrderHubAclMapper aclMapper) {
        this.feignClient = feignClient;
        this.aclMapper = aclMapper;
    }

    @Override
    public OrderSummary getOrderSummary(String orderId) {
        return aclMapper.toOrderSummary(feignClient.getOrderSummary(orderId));
    }
}
