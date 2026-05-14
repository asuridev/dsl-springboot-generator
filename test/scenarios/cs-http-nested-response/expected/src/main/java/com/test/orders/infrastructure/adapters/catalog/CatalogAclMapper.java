package com.test.orders.infrastructure.adapters.catalog;

import com.test.orders.domain.models.catalog.CustomerInfo;
import com.test.orders.domain.models.catalog.OrderSummaryResult;
import com.test.orders.infrastructure.adapters.catalog.dtos.CustomerInfoDto;
import com.test.orders.infrastructure.adapters.catalog.dtos.OrderSummaryResultDto;
import org.springframework.stereotype.Component;

/**
 * ACL (Anti-Corruption Layer) mapper for {@link CatalogServicePort}.
 *
 * <p>Translates infrastructure DTOs (shaped by the catalog external API) into
 * domain models. If the external API changes, only these methods need updating;
 * domain logic using the domain models remains untouched.
 */
@Component
public class CatalogAclMapper {

    public OrderSummaryResult toOrderSummaryResult(OrderSummaryResultDto dto) {
        if (dto == null) return null;
        return new OrderSummaryResult(dto.orderId(), dto.totalAmount(), mapToCustomerInfo(dto.customer()));
    }

    private CustomerInfo mapToCustomerInfo(CustomerInfoDto dto) {
        if (dto == null) return null;
        return new CustomerInfo(dto.customerId(), dto.name(), dto.email());
    }
}
