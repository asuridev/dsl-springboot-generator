package com.test.warehouse.application.mappers;

import com.test.warehouse.application.dtos.ShipmentResponseDto;
import com.test.warehouse.domain.aggregate.Shipment;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class ShipmentApplicationMapper {

    public ShipmentResponseDto toResponseDto(Shipment domain) {
        return new ShipmentResponseDto(domain.getId());
    }

    public List<ShipmentResponseDto> toResponseDtoList(List<Shipment> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
