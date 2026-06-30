package com.test.catalog.infrastructure.persistence.repositories;

import com.test.catalog.application.dtos.ProductPriceValidation;
import com.test.catalog.domain.enums.ProductStatus;
import com.test.catalog.infrastructure.persistence.entities.ProductJpa;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

/**
 * ProductJpaRepository — Spring Data JPA repository for ProductJpa.
 * Inherited from JpaRepository: findById, findAll, save, delete, count, etc.
 */
@Repository
public interface ProductJpaRepository extends JpaRepository<ProductJpa, UUID> {
    // derived_from: openapi:searchProducts
    @Query(
        "SELECT p FROM ProductJpa p WHERE p.status = 'ACTIVE' AND (:categoryId IS NULL OR p.categoryId = :categoryId) AND (:search IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%')))"
    )
    Page<ProductJpa> searchActive(@Param("categoryId") UUID categoryId, @Param("search") String search, Pageable page);

    // derived_from: openapi:adminSearchProducts
    @Query(
        "SELECT p FROM ProductJpa p WHERE (:categoryId IS NULL OR p.categoryId = :categoryId) AND (:status IS NULL OR p.status = :status) AND (:search IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%')))"
    )
    Page<ProductJpa> searchAll(
        @Param("categoryId") UUID categoryId,
        @Param("status") ProductStatus status,
        @Param("search") String search,
        Pageable page
    );

    @Query("SELECT p FROM ProductJpa p WHERE p.id IN :productIds")
    List<ProductJpa> findByProductIds(@Param("productIds") List<UUID> productIds);

    @Query(
        "SELECT new com.test.catalog.application.dtos.ProductPriceValidation(p.id, p.status, new com.test.catalog.domain.valueobject.Money(p.priceAmount, p.priceCurrency)) FROM ProductJpa p WHERE p.id IN :productIds"
    )
    List<ProductPriceValidation> findPriceValidationByProductIds(@Param("productIds") List<UUID> productIds);

    // derived_from: RULE-CAT-003
    @Query(
        "SELECT CASE WHEN COUNT(p) > 0 THEN true ELSE false END FROM ProductJpa p WHERE p.status = 'ACTIVE' AND p.categoryId = :categoryId"
    )
    boolean existsActiveByCategoryId(@Param("categoryId") UUID categoryId);

    // derived_from: RULE-CAT-003
    @Query("SELECT COUNT(p) FROM ProductJpa p WHERE p.status = 'ACTIVE' AND p.categoryId = :categoryId")
    long countActiveByCategoryId(@Param("categoryId") UUID categoryId);
}
