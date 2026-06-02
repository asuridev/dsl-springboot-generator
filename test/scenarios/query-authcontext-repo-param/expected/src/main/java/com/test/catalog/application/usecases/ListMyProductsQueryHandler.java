package com.test.catalog.application.usecases;

import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.catalog.application.mappers.ProductApplicationMapper;
import com.test.catalog.application.queries.ListMyProductsQuery;
import com.test.catalog.domain.aggregate.Product;
import com.test.catalog.domain.enums.ProductStatus;
import com.test.catalog.domain.repository.ProductRepository;
import com.test.shared.application.dtos.PagedResponse;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import com.test.shared.infrastructure.security.SecurityContextUtil;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-CAT-001]
@ApplicationComponent
public class ListMyProductsQueryHandler
    implements QueryHandler<ListMyProductsQuery, PagedResponse<ProductResponseDto>>
{

    private final ProductRepository productRepository;
    private final ProductApplicationMapper productApplicationMapper;

    public ListMyProductsQueryHandler(
        ProductRepository productRepository,
        ProductApplicationMapper productApplicationMapper
    ) {
        this.productRepository = productRepository;
        this.productApplicationMapper = productApplicationMapper;
    }

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public PagedResponse<ProductResponseDto> handle(ListMyProductsQuery query) {
        Page<Product> page = productRepository.list(
            UUID.fromString(SecurityContextUtil.currentUserClaim("sub")),
            query.status(),
            PageRequest.of(
                query.page(),
                query.size(),
                Sort.by(Sort.Direction.fromString(query.sortDirection()), query.sortBy())
            )
        );
        return PagedResponse.of(
            page.getContent().stream().map(productApplicationMapper::toResponseDto).toList(),
            query.page(),
            query.size(),
            page.getTotalElements()
        );
    }
}
