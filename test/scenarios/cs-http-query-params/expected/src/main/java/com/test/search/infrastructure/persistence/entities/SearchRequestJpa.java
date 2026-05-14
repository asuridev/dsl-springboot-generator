package com.test.search.infrastructure.persistence.entities;

import jakarta.persistence.*;
import java.util.UUID;
import lombok.*;

/**
 * SearchRequestJpa — JPA Entity for SearchRequest aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "search_requests")
public class SearchRequestJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;
}
