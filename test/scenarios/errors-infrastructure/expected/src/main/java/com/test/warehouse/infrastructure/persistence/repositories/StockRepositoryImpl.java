package com.test.warehouse.infrastructure.persistence.repositories;

import com.test.warehouse.domain.aggregate.Stock;
import com.test.warehouse.domain.repository.StockRepository;
import com.test.warehouse.infrastructure.persistence.entities.StockJpa;
import com.test.warehouse.infrastructure.persistence.mappers.StockJpaMapper;
import com.test.warehouse.infrastructure.persistence.repositories.StockJpaRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * StockRepositoryImpl — Infrastructure adapter implementing StockRepository.
 * Bridges the domain repository port with Spring Data JPA. Conversions between
 * the domain model and the JPA model live in StockJpaMapper so that
 * this adapter can stay focused on persistence orchestration and transactions.
 */
@Component
@Transactional(readOnly = true)
public class StockRepositoryImpl implements StockRepository {

    private final StockJpaRepository jpaRepository;
    private final StockJpaMapper mapper;

    public StockRepositoryImpl(StockJpaRepository jpaRepository, StockJpaMapper mapper) {
        this.jpaRepository = jpaRepository;
        this.mapper = mapper;
    }

    // ─── Repository methods ───────────────────────────────────────────────────

    @Override
    @Transactional
    public Stock save(Stock stock) {
        return mapper.toDomain(jpaRepository.save(mapper.toJpa(stock)));
    }

    @Override
    public Optional<Stock> findById(UUID id) {
        return jpaRepository.findById(id).map(mapper::toDomain);
    }
}
