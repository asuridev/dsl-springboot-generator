package com.test.catalog.infrastructure.adapters.orderHub;

import com.test.catalog.domain.models.orderHub.OrderSummary;
import com.test.catalog.infrastructure.adapters.orderHub.dtos.GetOrderSummaryResponseDto;
import org.springframework.stereotype.Component;

// derived_from: system.yaml#/externalSystems/order-hub
/**
 * ACL (Anti-Corruption Layer) mapper for {@link OrderHubClientPort}.
 *
 * <p>Translates wire-format DTOs from the order-hub external API into
 * domain models. The provider's wire format and error semantics never reach
 * the domain — they stop here.
 *
 * <p>Each mapping method is generated as a scaffold ({@code // TODO}). Implement
 * the translation manually because external responses often require domain
 * decisions (status normalization, error code mapping, derived fields) that
 * cannot be generated deterministically.
 */
@Component
public class OrderHubAclMapper {

    /**
     */
    public OrderSummary toOrderSummary(GetOrderSummaryResponseDto dto) {
        if (dto == null) return null;
        // TODO: implement mapping — see system.yaml#/externalSystems/order-hub/operations/getOrderSummary
        throw new UnsupportedOperationException("getOrderSummary ACL mapping not implemented yet");
    }
}
