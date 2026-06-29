# Guía de Artefactos del Bounded Context

Esta guía explica qué leer de cada artefacto de diseño en `arch/{bc-name}/` y qué información extraer
para implementar los handlers de la Fase 3.

---

## Mapa de artefactos por utilidad

| Artefacto | Cuándo leerlo | Qué extraer |
|---|---|---|
| `{bc-name}.yaml` | Siempre, primero | Use cases scaffold, domain_rules, aggregates, repositories, errors |
| `{bc-name}-flows.md` | Siempre, segundo | Pasos exactos del Then para cada UC scaffold |
| `{bc-name}-spec.md` | Cuando necesitas contexto de responsabilidades | Qué hace y qué NO hace este BC |
| `{bc-name}-open-api.yaml` | Para auditoría de wiring HTTP | Paths, status, request bodies, query params y respuestas que el código generado debe respetar |
| `{bc-name}-internal-api.yaml` | Si existe y hay integraciones internas | Contratos internos, DTOs compartidos y puertos que no deben contradecir el YAML |
| `{bc-name}-async-api.yaml` | Para auditoría de eventos | Channels, routing keys/topics, payloads y mensajes consumidos/publicados |

---

## Leer `{bc-name}.yaml`

### Localizar los use cases con `implementation: scaffold`

```yaml
useCases:
  - id: UC-CAT-001
    name: CreateCategory
    type: command
    implementation: scaffold    # ← este es un TODO
    flowRef: FL-CAT-001         # ← flujo correspondiente en flows.md
    description: ...

  - id: UC-CAT-002
    name: UpdateCategory
    type: command
    # sin implementation: scaffold → ya está implementado, no tocar
```

Solo los use cases con `implementation: scaffold` tienen el `// TODO` pendiente.
Los que no tienen ese campo son CRUD trivial ya generado — no los modifiques.

### Extraer domain_rules relevantes para cada UC

```yaml
domain_rules:
  - id: CAT-RULE-001
    type: uniqueness
    field: name
    scope: global
    description: Category name must be unique system-wide

  - id: CAT-RULE-003
    type: invariant
    description: Cannot deactivate a category that has active products
```

Cada regla referenciada en el flujo `Then` de un UC debe estar verificada en el handler.
Las reglas de tipo `uniqueness` ya tienen su `findBy{Field}` generado en el repositorio.

### Leer la estructura de los aggregates

```yaml
aggregates:
  - name: Category
    fields:
      - name: id
        type: UUID
        readOnly: true
        defaultValue: generated
      - name: slug
        type: String
        readOnly: true
        derived_from: name       # ← slug se deriva del name, no viene del cliente
```

Los campos con `derived_from` o `defaultValue: generated` deben ser calculados en el
handler o en el aggregate factory — nunca vienen del Command directamente.

### Identificar los errores tipados disponibles

```yaml
errors:
  - id: CAT-ERR-001
    name: CategoryNameAlreadyExists
    httpStatus: 409
  - id: CAT-ERR-002
    name: CategorySlugAlreadyExists
    httpStatus: 409
```

Las clases de error están generadas en `domain/errors/`. Úsalas directamente —
no lances excepciones genéricas de Java.

---

## Leer contratos API y eventos en Fase 3

Estos artefactos no son la fuente para rediseñar el BC, pero sí sirven para detectar defectos del
código generado antes de completar lógica de negocio.

### OpenAPI

Revisa que controllers, commands y queries respeten:
- nombres de path/query params
- forma del body request/response
- status HTTP esperado
- semántica de paginación y ordenamiento

Si OpenAPI define `sort` y el código expone `sortBy/sortDirection`, repórtalo como inconsistencia
del generador. No cambies contratos manualmente salvo instrucción explícita.

### AsyncAPI

Revisa que eventos publicados/consumidos usen el mismo canal contractual en:
- `channel` de AsyncAPI o de `{bc-name}.yaml`
- routing keys/topics generados
- bindings de RabbitMQ/Kafka
- listeners y outbox

Fallback permitido si no existe canal explícito: `{producerBc}.{event-kebab-con-puntos}`.

---

## Leer `{bc-name}-flows.md`

El `flows.md` es la especificación ejecutable de la Fase 3. Cada flujo tiene un ID (FL-{BC}-{N})
que referencia al use case por su `flowRef`.

### Estructura de un flujo

```markdown
## FL-CAT-001 — CreateCategory (slug generation)

### Escenario A — Creación exitosa

**Given:**
- El admin está autenticado con rol `ROLE_ADMIN`.
- No existe Category con nombre "Lácteos".
- No existe Category con slug "lacteos".

**When:**
- POST /api/catalog/v1/categories con { "name": "Lácteos", ... }

**Then:**
1. Handler genera slug "lacteos" (kebab-case con normalización unicode)
2. Verifica CAT-RULE-001: categoryRepository.findByName("Lácteos") → vacío
3. Verifica CAT-RULE-002: categoryRepository.findBySlug("lacteos") → vacío
4. Invoca Category.create("Lácteos", ...) que asigna status=ACTIVE
5. Persiste con categoryRepository.save(category)
6. Respuesta: 201 Created

### Escenario B — Nombre duplicado

**Then:**
1. categoryRepository.findByName("Lácteos") → retorna existing
2. Lanza CategoryNameAlreadyExistsError (409 Conflict)
```

### Cómo mapear el flujo al handler

| Sección del flujo | Qué implementar |
|---|---|
| **Given** | Pre-condiciones → verificaciones al inicio del handler (throw si no se cumplen) |
| **When** | Ya implementado (es la llegada del Command/Query al handler) |
| **Then** pasos | Los pasos exactos del método `handle()`, en el orden listado |
| **Escenario B, C...** | Ramas del flujo → bloques `if` o llamadas que lanzan los errores tipados |

### Reglas de interpretación

- Los números en el **Then** son el orden de ejecución — respétalos
- Si un paso dice `categoryRepository.findByName(...)`, el método ya existe en la interfaz de repositorio generada
- Si un paso menciona una operación no disponible en los artefactos, **detente y notifica**
- Los escenarios de error (B, C, D) representan validaciones que deben ocurrir antes del camino feliz

---

## Ejemplo completo: mapeo YAML + flows → handler

**Del YAML:**
```yaml
- id: UC-CAT-003
  name: DeactivateCategory
  flowRef: FL-CAT-003
  implementation: scaffold
```

```yaml
domain_rules:
  - id: CAT-RULE-003
    type: invariant
    description: Cannot deactivate a category that has active products
```

**Del flows.md (FL-CAT-003):**
```
Then:
1. Verifica CAT-RULE-003: productRepository.countActiveByCategory(categoryId) → 0
2. Si count > 0: lanza CategoryHasActiveProductsError
3. Carga category: categoryRepository.findById(categoryId)
4. Si no existe: lanza CategoryNotFoundError
5. Invoca category.deactivate()
6. Persiste con categoryRepository.save(category)
```

**Handler resultante:**
```java
@Override
@Transactional
@LogExceptions
public void handle(DeactivateCategoryCommand command) {
    // CAT-RULE-003: no active products
    long activeCount = productRepository.countActiveByCategory(command.categoryId());
    if (activeCount > 0) {
        throw new CategoryHasActiveProductsError(command.categoryId());
    }

    Category category = categoryRepository.findById(command.categoryId())
        .orElseThrow(() -> new CategoryNotFoundError(command.categoryId()));

    category.deactivate();
    categoryRepository.save(category);
}
```

Nota: la lógica de verificar productos activos cruza dos aggregates (Category + Product).
Esto es candidato a un domain service. Consulta `domain-service-patterns.md`.
