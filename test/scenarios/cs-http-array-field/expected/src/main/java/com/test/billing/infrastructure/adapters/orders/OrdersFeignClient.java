package com.test.billing.infrastructure.adapters.orders;

import com.test.billing.infrastructure.adapters.orders.dtos.OrderDetailsResultDto;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

/**
 * Feign client for the orders BC internal API.
 * Returns infrastructure DTOs — never domain models directly.
 * Mapped to domain models by {@link OrdersAclMapper}.
 */
@FeignClient(
    name = "billing-orders-service",
    url = "${integration.orders.base-url}",
    configuration = OrdersFeignConfig.class
)
public interface OrdersFeignClient {
    @GetMapping("/internal/orders/{orderId}")
    OrderDetailsResultDto getOrderDetails(@PathVariable("orderId") String orderId);
}
