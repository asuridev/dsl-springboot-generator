package com.test.billing.application.mappers;

import com.test.billing.application.dtos.InvoiceResponseDto;
import com.test.billing.domain.aggregate.Invoice;
import com.test.billing.domain.valueobject.Money;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class InvoiceApplicationMapper {

    public InvoiceResponseDto toResponseDto(Invoice domain) {
        return new InvoiceResponseDto(domain.getId(), domain.getOrderId(), domain.getTotalAmount());
    }

    public List<InvoiceResponseDto> toResponseDtoList(List<Invoice> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
