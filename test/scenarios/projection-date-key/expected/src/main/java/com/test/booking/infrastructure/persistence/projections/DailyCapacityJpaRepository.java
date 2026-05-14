package com.test.booking.infrastructure.persistence.projections;

import java.time.LocalDate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

/**
 * Spring Data repository for DailyCapacityJpa.
 * derived_from: bc.booking.projections[DailyCapacity] (persistent: true)
 */
@Repository
public interface DailyCapacityJpaRepository extends JpaRepository<DailyCapacityJpa, LocalDate> {}
