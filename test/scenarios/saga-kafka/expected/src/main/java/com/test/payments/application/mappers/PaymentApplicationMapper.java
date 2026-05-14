package com.test.payments.application.mappers;

import com.test.payments.application.dtos.PaymentResponseDto;
import com.test.payments.domain.aggregate.Payment;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class PaymentApplicationMapper {

    public PaymentResponseDto toResponseDto(Payment domain) {
        return new PaymentResponseDto(domain.getId(), domain.getOrderId(), domain.getAmount());
    }

    public List<PaymentResponseDto> toResponseDtoList(List<Payment> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
