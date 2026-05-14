package com.test.notifications.application.mappers;

import com.test.notifications.application.dtos.NotificationResponseDto;
import com.test.notifications.domain.aggregate.Notification;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class NotificationApplicationMapper {

    public NotificationResponseDto toResponseDto(Notification domain) {
        return new NotificationResponseDto(domain.getId(), domain.getShipmentId());
    }

    public List<NotificationResponseDto> toResponseDtoList(List<Notification> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
