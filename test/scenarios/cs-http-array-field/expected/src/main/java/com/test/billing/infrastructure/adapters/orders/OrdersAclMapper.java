package com.test.billing.infrastructure.adapters.orders;

import com.test.billing.domain.models.orders.OrderDetailsResult;
import com.test.billing.domain.models.orders.OrderLineItem;
import com.test.billing.infrastructure.adapters.orders.dtos.OrderDetailsResultDto;
import com.test.billing.infrastructure.adapters.orders.dtos.OrderLineItemDto;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * ACL (Anti-Corruption Layer) mapper for {@link OrdersServicePort}.
 *
 * <p>Translates infrastructure DTOs (shaped by the orders external API) into
 * domain models. If the external API changes, only these methods need updating;
 * domain logic using the domain models remains untouched.
 */
@Component
public class OrdersAclMapper {

    public OrderDetailsResult toOrderDetailsResult(OrderDetailsResultDto dto) {
        if (dto == null) return null;
        return new OrderDetailsResult(
            dto.orderId(),
            dto.totalAmount(),
            dto.lineItems() == null
                ? null
                : dto.lineItems().stream().map(this::mapToOrderLineItem).collect(java.util.stream.Collectors.toList())
        );
    }

    private OrderLineItem mapToOrderLineItem(OrderLineItemDto dto) {
        if (dto == null) return null;
        return new OrderLineItem(dto.productId(), dto.quantity(), dto.unitPrice());
    }
}
