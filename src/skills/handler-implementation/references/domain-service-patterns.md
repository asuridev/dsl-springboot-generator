# Domain Services — Cuándo y Cómo Crearlos

Un **domain service** encapsula lógica de negocio que no pertenece naturalmente a ningún aggregate
específico. Es una clase stateless en la capa de dominio, sin dependencias de infraestructura directas.

---

## Cuándo crear un domain service

### Señal 1 — Lógica que cruza múltiples aggregates

Si el flujo `Then` de un UC describe pasos que consultan o modifican más de un aggregate,
la lógica de coordinación pertenece a un domain service, no al handler ni a un aggregate.

**Ejemplo:** Verificar que una Category no tiene productos activos antes de desactivarla requiere
consultar el aggregate `Product` desde el contexto del aggregate `Category`. Ni `Category` ni
`Product` deben conocerse mutuamente. El domain service actúa como coordinador.

```
❌ categoryRepository + productRepository ambos en el handler → lógica de coordinación expuesta
✅ CategoryAvailabilityService.verifyCanDeactivate(categoryId) → handler limpio
```

### Señal 2 — Lógica reusable entre múltiples handlers

Si dos o más handlers del mismo BC comparten exactamente los mismos pasos lógicos, extraer
esa lógica a un domain service evita duplicación y garantiza consistencia.

**Ejemplo:** La generación de slug a partir de un nombre aparece en `CreateCategoryCommandHandler`
y en `CreateProductCommandHandler`. La regla de normalización (kebab-case + unicode → ASCII) es
la misma en ambos casos.

```
❌ Lógica de slug duplicada en dos handlers → inconsistencia futura garantizada
✅ SlugGeneratorService.generate(name) → regla centralizada, handlers delgados
```

### Señal 3 — Lógica que requiere llamar a un repositorio, pero no pertenece a un aggregate

Los aggregates no deben recibir repositorios como dependencias. Si una regla de negocio
necesita consultar persistencia para validar (tipo: CAT-RULE-001 — unicidad de nombre),
esa validación va en el handler o en un domain service, no dentro del aggregate.

---

## Cuándo NO crear un domain service

- La lógica solo opera sobre el estado interno de un aggregate → va en el aggregate
- La lógica es trivial (una sola línea) → va directamente en el handler
- La lógica involucra infraestructura (repositorios JPA, HTTP, mensajería) → va en el handler
  con inyección de los puertos correspondientes

---

## Límite duro — los repositorios coordinados son SIEMPRE del mismo BC

Un domain service coordina aggregates **del mismo bounded context**. Los repositorios que recibe
(Patrón 2) son puertos de salida **de su propio BC**. **Nunca** inyectes el repositorio de otro BC
en un domain service ni en un handler: eso acopla dos contextos y rompe la arquitectura
hexagonal/DDD. Para datos de otro BC, usa la `integration:` declarada (adapter HTTP/ACL o evento
async), no su capa de persistencia. Si la lógica parece exigir el repositorio de otro BC y no hay
integración declarada, **detente y notifica al usuario** — no inyectes el repositorio cruzado.

---

## Estructura en el proyecto generado

### Ubicación

```
src/main/java/{package}/{bc-name}/domain/services/
├── SlugGeneratorService.java         ← sin dependencias externas
└── CategoryAvailabilityService.java  ← puede recibir repositorios como interfaces
```

> El directorio `domain/services/` **no es generado por la Fase 2**. Lo creas tú en la Fase 3.

> **Inyección sin Spring en el dominio.** El generador emite dos anotaciones marcador en
> `{package}.shared.domain.annotations`: `@ApplicationComponent` (la llevan los handlers) y
> `@DomainComponent` (para domain services que necesitan inyección). `UseCaseConfig` las registra
> como beans vía `@ComponentScan(includeFilters = …)`. Este es el mecanismo canónico: usar
> `@DomainComponent` en un domain service lo hace inyectable **sin** importar `@Component`/`@Service`
> de Spring en la capa de dominio.

### Convenciones (extraídas de AGENTS.md)

- **Sin Lombok** en clases de dominio
- **Stateless** — sin campos de instancia mutables
- **Sin anotaciones de Spring** (`@Service`, `@Component`) — el dominio no debe importar Spring.
  Si el service necesita **inyección** de puertos (repositorios), anótalo con **`@DomainComponent`**
  (`{package}.shared.domain.annotations.DomainComponent`): es la anotación marcador que emite el
  generador y que `UseCaseConfig` component-scanea (`includeFilters`), por lo que el service se
  registra como bean de Spring **sin** que el dominio dependa de Spring. Es el análogo de
  `@ApplicationComponent`, que ya usan todos los handlers. Un service puro sin dependencias no
  necesita anotación (se instancia con `new`); si prefieres que sea bean, también puede llevar
  `@DomainComponent`.
- **Sin dependencias de infraestructura** (JPA, HTTP, mensajería) — solo interfaces de dominio
- Nombre: `{ConceptName}Service` o `{ConceptName}DomainService` si hay ambigüedad con la capa de aplicación

---

## Patrones concretos

### Patrón 1 — Domain service puro (sin dependencias externas)

Para lógica que solo opera con primitivos o value objects del dominio:

```java
// domain/services/SlugGeneratorService.java
public class SlugGeneratorService {

    /**
     * Generates a URL-safe slug from a display name.
     * Normalizes unicode, lowercases, and replaces spaces with hyphens.
     * derived_from: implicit — reused by UC-CAT-001, UC-CAT-008
     */
    public String generate(String name) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Name must not be blank");
        }
        return Normalizer.normalize(name, Normalizer.Form.NFD)
            .replaceAll("\\p{M}", "")           // strip diacritics
            .toLowerCase()
            .replaceAll("[^a-z0-9\\s-]", "")    // remove non-alphanumeric
            .replaceAll("\\s+", "-")             // spaces → hyphens
            .replaceAll("-+", "-")               // collapse hyphens
            .strip();
    }
}
```

**Uso en el handler:**
```java
// En CreateCategoryCommandHandler (application/usecases)
private final SlugGeneratorService slugGenerator; // new SlugGeneratorService() o bean vía @DomainComponent

public void handle(CreateCategoryCommand command) {
    String slug = slugGenerator.generate(command.name());
    categoryRepository.findBySlug(slug)
        .ifPresent(c -> { throw new CategorySlugAlreadyExistsError(); });
    // ...
}
```

### Patrón 2 — Domain service con dependencia de repositorio (puerto de salida)

Para lógica que necesita consultar persistencia pero coordina múltiples aggregates:

```java
// domain/services/CategoryAvailabilityService.java
import {package}.shared.domain.annotations.DomainComponent;

@DomainComponent  // registrado por UseCaseConfig → inyectable sin acoplar el dominio a Spring
public class CategoryAvailabilityService {

    private final ProductRepository productRepository;

    public CategoryAvailabilityService(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    /**
     * Verifies CAT-RULE-003: a category can only be deactivated if it has no active products.
     * derived_from: CAT-RULE-003
     *
     * @throws CategoryHasActiveProductsError if active products exist
     */
    public void verifyCanDeactivate(UUID categoryId) {
        long activeCount = productRepository.countActiveByCategory(categoryId);
        if (activeCount > 0) {
            throw new CategoryHasActiveProductsError(categoryId);
        }
    }
}
```

**Uso en el handler:**
```java
// En DeactivateCategoryCommandHandler
private final CategoryAvailabilityService availabilityService;
private final CategoryRepository categoryRepository;

public void handle(DeactivateCategoryCommand command) {
    availabilityService.verifyCanDeactivate(command.categoryId()); // CAT-RULE-003

    Category category = categoryRepository.findById(command.categoryId())
        .orElseThrow(() -> new CategoryNotFoundError(command.categoryId()));

    category.deactivate();
    categoryRepository.save(category);
}
```

---

## Checklist antes de crear un domain service

- [ ] ¿La lógica aparece en más de un handler, o cruza más de un aggregate?
- [ ] ¿El nombre del servicio describe claramente una responsabilidad de dominio (no técnica)?
- [ ] ¿El servicio es stateless?
- [ ] ¿El servicio depende solo de interfaces de dominio (repositorios como puertos), no de JPA ni HTTP?
- [ ] ¿El flujo en `flows.md` hace referencia implícita o explícita a esta lógica compartida?
- [ ] ¿Todos los imports compilan: repositorios de dominio, errores tipados, value objects,
      `UUID`, `Instant`, `BigDecimal`, `Normalizer`, `DomainComponent` (si el service es bean), etc.?
- [ ] ¿El handler que lo inyecta importa el service y conserva las firmas generadas?

Si todas son verdaderas → crea el domain service.
Si no → implementa la lógica directamente en el handler.
