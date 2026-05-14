package com.test.search.infrastructure.adapters.catalog.dtos;

/**
 * Infrastructure DTO — shape of the ProductSearchResultDto response from catalog BC.
 * Only used inside the adapter layer; never exposed to application or domain layers.
 */
public record ProductSearchResultDto(int totalCount, int page) {}
