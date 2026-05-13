package com.test.catalog.application.mappers;

import com.test.catalog.application.dtos.TagResponseDto;
import com.test.catalog.domain.aggregate.Tag;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class TagApplicationMapper {

    public TagResponseDto toResponseDto(Tag domain) {
        return new TagResponseDto(domain.getId(), domain.getCreatedAt(), domain.getUpdatedAt());
    }

    public List<TagResponseDto> toResponseDtoList(List<Tag> list) {
        return list.stream().map(this::toResponseDto).toList();
    }
}
