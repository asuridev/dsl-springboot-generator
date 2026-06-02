package com.test.catalog.infrastructure.persistence.repositories;

import com.test.catalog.domain.aggregate.Product;
import com.test.catalog.domain.repository.ProductRepository;
import com.test.catalog.infrastructure.persistence.entities.ProductJpa;
import com.test.catalog.infrastructure.persistence.mappers.ProductJpaMapper;
import com.test.catalog.infrastructure.persistence.repositories.ProductJpaRepository;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * ProductRepositoryImpl — Infrastructure adapter implementing ProductRepository.
 * Bridges the domain repository port with Spring Data JPA. Conversions between
 * the domain model and the JPA model live in ProductJpaMapper so that
 * this adapter can stay focused on persistence orchestration and transactions.
 */
@Component
@Transactional(readOnly = true)
public class ProductRepositoryImpl implements ProductRepository {

    private final ProductJpaRepository jpaRepository;
    private final ProductJpaMapper mapper;

    public ProductRepositoryImpl(ProductJpaRepository jpaRepository, ProductJpaMapper mapper) {
        this.jpaRepository = jpaRepository;
        this.mapper = mapper;
    }

    // ─── Repository methods ───────────────────────────────────────────────────

    @Override
    public Stream<Product> exportProducts(String name) {
        return jpaRepository.exportProducts(name).map(mapper::toDomain);
    }

    @Override
    public Optional<Product> findById(UUID id) {
        return jpaRepository.findById(id).map(mapper::toDomain);
    }

    @Override
    @Transactional
    public Product save(Product product) {
        return mapper.toDomain(jpaRepository.save(mapper.toJpa(product)));
    }
}
