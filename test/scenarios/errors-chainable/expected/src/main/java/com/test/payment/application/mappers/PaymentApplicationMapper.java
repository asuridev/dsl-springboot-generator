package com.test.payment.application.mappers;

import com.test.payment.application.dtos.PaymentResponseDto;
import com.test.payment.domain.aggregate.Payment;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class PaymentApplicationMapper {

    public PaymentResponseDto toResponseDto(Payment domain) {
        return new PaymentResponseDto(domain.getId(), domain.getAmount());
    }

    public List<PaymentResponseDto> toResponseDtoList(List<Payment> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
