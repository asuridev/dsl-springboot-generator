package com.test.invoice.application.mappers;

import com.test.invoice.application.dtos.InvoiceResponseDto;
import com.test.invoice.domain.aggregate.Invoice;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class InvoiceApplicationMapper {

    public InvoiceResponseDto toResponseDto(Invoice domain) {
        return new InvoiceResponseDto(domain.getId(), domain.getNumber(), domain.getAmount());
    }

    public List<InvoiceResponseDto> toResponseDtoList(List<Invoice> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
