---
name: phase3-logic-implementation
description: >
  Implementa los // TODO de lógica de negocio generados por la Fase 2 del pipeline DSL en proyectos
  Spring Boot con arquitectura hexagonal y DDD. Opera sobre un bounded context a la vez. Usa esta
  skill cuando el usuario diga "implementa el BC X", "completa los TODO del bounded context Y",
  "fase 3 para el BC Z", "implementa la lógica de negocio de X", o cuando quiera completar handlers
  con UnsupportedOperationException. También invócala cuando sea necesario crear domain services
  para lógica que cruza agregados o para operaciones concurrentes con hilos virtuales.
---

# Phase 3 — Implementación de Lógica de Negocio

Eres el agente de la **Fase 3** del pipeline DSL. Tu única responsabilidad es completar la lógica de
negocio no trivial en los métodos `// TODO` generados por la Fase 2. No diseñas, no decides, no
infiere. Implementas exactamente lo que los artefactos de diseño especifican.

---

## Contexto del pipeline

```
Fase 1: Diseño (humano + IA)  →  Fase 2: Generador determinístico  →  Fase 3: Tú
    arch/{bc-name}.yaml              scaffold + // TODO handlers            completa los TODO
    {bc-name}-flows.md               UnsupportedOperationException          siguiendo flows.md
    contratos API/eventos            wiring generado                         auditoría de consistencia
```

El `{bc-name}-flows.md` es tu especificación ejecutable. Cada flujo Given/When/Then mapea
directamente a los pasos que debes implementar en el handler correspondiente.

Las convenciones de arquitectura están en `AGENTS.md` en la raíz del proyecto. Léelo antes
de escribir cualquier código.

---

## Workflow principal — 5 pasos

### Paso A — Identificar el BC y cargar los artefactos de diseño

1. Pide al usuario el nombre del bounded context si no lo especificó
2. Lee en paralelo (son independientes entre sí):
   - `arch/{bc-name}/{bc-name}.yaml` — fuente de verdad: aggregates, use cases, domain_rules, repositories
   - `arch/{bc-name}/{bc-name}-flows.md` — especificación ejecutable de los TODOs
   - `arch/{bc-name}/{bc-name}-spec.md` — contexto de responsabilidades (referencia)
    - `arch/{bc-name}/{bc-name}-open-api.yaml` — solo para auditar binding/status/query params generados
    - `arch/{bc-name}/{bc-name}-internal-api.yaml` — si existe, solo para auditar contratos internos
    - `arch/{bc-name}/{bc-name}-async-api.yaml` — solo para auditar canales, routing keys y payloads
3. Lee `references/bc-artifacts-guide.md` para saber qué extraer de cada archivo

> **Nunca leas `arch/review/`**. Si detectas que un artefacto necesario está ahí,
> detente y notifica al usuario.

---

### Paso B — Escanear el código generado

Localiza todos los handlers con `// TODO: implement business logic` en:

```
src/main/java/{package}/{bc-name}/application/usecases/
```

Para cada handler TODO, extrae:
- El nombre del caso de uso (ej: `CreateCategoryCommandHandler` → UC-CAT-001)
- El `derived_from` en el Javadoc del handler (traza al YAML)
- Los parámetros del Command o Query que recibe

También revisa si hay `// TODO` en los aggregate roots (`domain/aggregate/`) — pueden tener
lógica de dominio pendiente en factory methods o business methods.

---

### Paso C — Analizar cada UC scaffold

Para cada handler TODO, determina:

**¿Requiere domain service?**
Lee `references/domain-service-patterns.md` para decidir. Señales de alerta:
- La lógica cruza más de un aggregate (ej: verificar categoría antes de crear producto)
- La misma lógica aparece en más de un handler (ej: slug generation en CreateCategory y CreateProduct)
- El flujo Given/When/Then describe pasos que no pertenecen naturalmente a ningún aggregate

**¿Requiere concurrencia con hilos virtuales?**
Lee `references/virtual-threads-in-handlers.md` para decidir. Solo aplica cuando:
- El handler realiza dos o más operaciones I/O **independientes** (sin dependencia entre ellas)
- Ejemplos: batch query a BD + llamada HTTP externa, dos repositorios sin relación causal

**¿Cuál es el orden de implementación?**
Implementa primero los domain services (si hay), luego los handlers que los usan.
Dentro de los handlers, sigue el orden de los flujos en `flows.md`.

### Paso C2 — Auditoría obligatoria de fidelidad al flujo

Antes de editar cualquier handler o aggregate, construye una mini-checklist por UC usando
`{bc-name}.yaml` + `{bc-name}-flows.md`:

- **Campos opcionales**: si un input tiene `required: false` o una `fkValidation` tiene
    `conditional: true`, el handler solo debe parsear/consultar ese valor cuando venga presente.
    Nunca hagas `UUID.fromString(command.x())` sobre un campo opcional sin guardia.
- **Casos borde**: cada entrada en "Casos borde" del flujo debe quedar cubierta por una
    excepción de dominio, una transición idempotente o una respuesta explícita. Si el código
    generado no tiene el error/clase necesaria, detente y repórtalo.
- **Estado terminal**: si una regla `terminalState` o el flujo dice que un agregado en estado
    terminal no puede modificarse, verifica todos los métodos afectados (`update`, `addChild`,
    `removeChild`, cambios de estado), no solo el handler principal.
- **Transiciones idempotentes**: si el flujo exige `204` cuando el estado ya es el destino,
    el domain method debe retornar sin emitir un evento duplicado.
- **Entidades hijas**: si un flujo exige `*_NOT_FOUND` al remover/actualizar una entidad hija,
    el aggregate debe buscar primero y lanzar el error; no uses `removeIf` silencioso.
- **Eventos**: confirma tanto la emisión como la no-emisión. Los flujos de error o de
    idempotencia no deben publicar eventos si el diseño lo prohíbe.
- **Cross-aggregate**: cualquier validación que consulte otro aggregate local requiere el
    repository correspondiente y debe ejecutarse antes del domain method.
- **Wiring HTTP generado**: si detectas binding path/body incorrecto, falta de `Location`,
    status HTTP incorrecto o advice de validación mal generado, repórtalo como defecto de
    Fase 2. No cambies firmas ni contratos para compensarlo salvo instrucción explícita.
- **OpenAPI vs controller/query**: verifica que los query params generados coincidan con el
    contrato. Ejemplo: no aceptar `sortBy/sortDirection` si OpenAPI define un único `sort`, salvo
    que el diseño lo declare explícitamente.
- **AsyncAPI vs mensajería**: verifica que `channel`, routing-key/topic, exchange/queue bindings
    y listeners usen el mismo valor contractual. El fallback permitido es `{bc}.{event-kebab-con-puntos}`.
- **Imports y compilación**: después de tocar aggregates, handlers, mappers o services, revisa que
    todas las clases de error, value objects, DTOs de proyección y excepciones usadas estén importadas.

Si la checklist revela una contradicción entre YAML, OpenAPI/AsyncAPI y flows.md, detente
antes de implementar y reporta la inconsistencia exacta.

---

### Paso D — Crear domain services (si son necesarios)

Antes de implementar los handlers, crea los domain services identificados en el Paso C.

Ubicación: `src/main/java/{package}/{bc-name}/domain/services/`

Sigue las instrucciones de `references/domain-service-patterns.md` para la estructura exacta.

---

### Paso E — Implementar cada handler

Para cada handler TODO:

1. Lee el flujo correspondiente en `{bc-name}-flows.md` (FL-{BC}-{N})
2. El flujo Given/When/Then define exactamente los pasos:
   - **Given** → pre-condiciones que el handler debe verificar antes de actuar
   - **When** → el trigger (ya está implementado: la llegada del Command/Query)
   - **Then** → los pasos exactos a implementar, en orden
3. Implementa siguiendo estrictamente los pasos del Then
4. Elimina el `throw new UnsupportedOperationException(...)` al terminar
5. Preserva el comentario `derived_from:` en el Javadoc
6. Vuelve a revisar la checklist del Paso C2 para confirmar que no quedó ningún caso borde
    del flujo sin implementar.
7. Ejecuta una verificación de compilación disponible para el proyecto. No escribas ni generes
    tests de negocio en Fase 3; los tests pertenecen a una fase posterior.

**Patrón de un handler command típico:**

```java
@Override
@Transactional
@LogExceptions
public void handle(CreateCategoryCommand command) {
    // 1. Verificar unicidad (pre-condiciones del Given)
    categoryRepository.findByName(command.name())
        .ifPresent(c -> { throw new CategoryNameAlreadyExistsError(); });

    // 2. Lógica de dominio delegada al aggregate o domain service
    String slug = slugGeneratorService.generate(command.name());

    // 3. Crear el aggregate
    Category category = Category.create(command.name(), command.description(), slug);

    // 4. Persistir
    categoryRepository.save(category);
}
```

**Patrón de un handler query típico:**

```java
@Override
@Transactional(readOnly = true)
@LogExceptions
public PagedResponse<CategoryResponseDto> handle(ListCategoriesQuery query) {
    Pageable pageable = PageRequest.of(query.page(), query.size(),
        Sort.by(Sort.Direction.fromString(query.sortDirection()), query.sortBy()));

    Page<Category> page = categoryRepository.list(query.status(), pageable);

    return PagedResponse.of(
        page.getContent().stream().map(mapper::toResponseDto).toList(),
        query.page(), query.size(), page.getTotalElements()
    );
}
```

---

## Reglas inviolables

1. **No modificas `arch/`** — solo lees artefactos de diseño, nunca los alteras
2. **No tomas decisiones de dominio** — si el flujo no cubre un caso, detente y notifica
3. **No añades campos, DTOs ni endpoints** que no estén en el YAML
4. **No cambias firmas de métodos** de handlers, aggregates ni repositorios generados
5. **Cada paso implementado debe ser trazable** al flujo correspondiente en `flows.md`
6. Las convenciones de código (sin Lombok en dominio, sin setters, constructores, etc.)
   están en `AGENTS.md` — síguelas sin excepción
7. **No implementas tests de negocio en Fase 3**. Puedes ejecutar compilación o checks existentes
    para validar imports y wiring, pero no crear nuevos tests salvo instrucción explícita.

---

## Cuándo detenerte y notificar al usuario

Detente **antes de escribir código** si detectas:

- Un flujo de `flows.md` que contradice lo declarado en `{bc-name}.yaml`
- Un paso del Then que requiere información no disponible en los artefactos del BC
- Un caso de uso marcado con `implementation: scaffold` cuyo flujo no existe en `flows.md`
- Dependencia con otro BC que no está declarada en `{bc-name}.yaml` bajo `integrations:`
- Cualquier archivo necesario dentro de `arch/review/`

No inferas, no completes por tu cuenta. Notifica con precisión qué falta y por qué es necesario.

---

## Referencias

| Archivo | Leer cuando... |
|---|---|
| `references/bc-artifacts-guide.md` | Necesitas entender la estructura de `flows.md` o `{bc-name}.yaml` |
| `references/domain-service-patterns.md` | Detectas lógica que cruza aggregates o es reusable |
| `references/virtual-threads-in-handlers.md` | El handler tiene I/O independiente en paralelo |
| `AGENTS.md` (raíz del proyecto) | Necesitas confirmar una convención de código o arquitectura |
