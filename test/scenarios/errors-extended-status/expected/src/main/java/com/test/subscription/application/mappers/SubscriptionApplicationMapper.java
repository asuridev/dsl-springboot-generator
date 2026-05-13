package com.test.subscription.application.mappers;

import com.test.subscription.application.dtos.SubscriptionResponseDto;
import com.test.subscription.domain.aggregate.Subscription;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class SubscriptionApplicationMapper {

    public SubscriptionResponseDto toResponseDto(Subscription domain) {
        return new SubscriptionResponseDto(domain.getId(), domain.getPlan());
    }

    public List<SubscriptionResponseDto> toResponseDtoList(List<Subscription> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
