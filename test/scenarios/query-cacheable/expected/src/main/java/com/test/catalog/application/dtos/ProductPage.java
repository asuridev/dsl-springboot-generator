package com.test.catalog.application.dtos;

import com.test.catalog.application.dtos.ProductDetail;
import java.util.List;

public record ProductPage(List<ProductDetail> content, int totalElements, int totalPages) {}
