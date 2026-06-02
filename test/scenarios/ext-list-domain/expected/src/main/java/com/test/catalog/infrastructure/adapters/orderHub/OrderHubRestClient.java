package com.test.catalog.infrastructure.adapters.orderHub;

import com.test.catalog.infrastructure.adapters.orderHub.dtos.GetOrderSummaryResponseDto;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

/**
 * Feign client for the order-hub BC internal API.
 * Returns infrastructure DTOs — never domain models directly.
 * Mapped to domain models by {@link OrderHubAclMapper}.
 */
@FeignClient(
    name = "order-hub-client",
    url = "${integration.order-hub.base-url}",
    configuration = OrderHubRestConfig.class
)
public interface OrderHubRestClient {
    @GetMapping("/v1/orders/{orderId}")
    GetOrderSummaryResponseDto getOrderSummary(@PathVariable("orderId") String orderId);
}
