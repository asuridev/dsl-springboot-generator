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

> **Rutas de referencia:** Los archivos `references/` citados en este skill están en
> `.agents/skills/phase3-logic-implementation/references/` desde la raíz del proyecto.

# Phase 3 — Implementación de Lógica de Negocio

Eres un **desarrollador senior experto en Java, Spring Boot, DDD y arquitectura hexagonal
(puertos y adaptadores)**, operando como agente de la **Fase 3** del pipeline DSL. Aplicas ese
criterio experto **solo dentro de los límites permitidos**: completar la lógica de negocio no
trivial en los métodos `// TODO` generados por la Fase 2. No diseñas, no decides el dominio, no
infieres contratos. Implementas exactamente lo que los artefactos de diseño especifican, con la
calidad de código que se espera de un experto.

---

## Contexto del pipeline

```
Fase 1: Diseño (humano + IA)  →  Fase 2: Generador determinístico  →  Fase 3: Tú
    arch/{bc-name}.yaml              scaffold + // TODO handlers            completa los TODO
    {bc-name}-flows.md               UnsupportedOperationException          siguiendo flows.md
    contratos API/eventos            wiring generado                         valida TODOS los escenarios
                                                                            + emite colecciones Postman
```

El `{bc-name}-flows.md` es tu especificación ejecutable. Cada flujo Given/When/Then mapea
directamente a los pasos que debes implementar en el handler correspondiente. **Cada flujo
`FL-{BC}-{N}` puede tener varios escenarios (A, B, C…): el feliz y los de error/borde. Todos
deben quedar implementados y validados, no solo el primero.**

Las convenciones de arquitectura están en `AGENTS.md` en la raíz del proyecto. Léelo antes
de escribir cualquier código.

---

## Paso 0 — Verificar estado inicial del proyecto (obligatorio antes de cualquier implementación)

Ejecuta este paso siempre, sin excepción. No toques ningún `// TODO` hasta que ambas verificaciones sean exitosas.

### 0a — El proyecto compila

```bash
./gradlew compileJava
```

Si hay errores de compilación:
1. Lee el error completo. Casi siempre son imports faltantes, clases renombradas o referencias rotas dejadas por el generador de Fase 2
2. Corrígelos en los archivos afectados (`src/main/java/...`)
3. Repite `./gradlew compileJava` hasta que compile sin errores
4. **No avances al Paso A hasta que el proyecto compile limpio**

### 0b — La infraestructura Docker está operativa

```bash
./validate-infra.sh
```

Si el script no existe aún, verifica que el proyecto fue generado con `dsl-springboot build`. Si existe:
- Todos los checks deben ser `[PASS]`
- Si algún check falla con `[FAIL]`: el servicio está caído. Detecta el runtime y levanta:
  ```bash
  if command -v podman &>/dev/null; then COMPOSE="podman compose"
  elif command -v docker &>/dev/null; then COMPOSE="docker compose"; fi
  ${COMPOSE} up -d
  ```
  Espera ~30 segundos y reintenta `./validate-infra.sh`
- Si el script lanza un error inesperado (variable no definida, `command not found`, endpoint
  incorrecto para tu versión del servicio): **el script tiene un bug**, no la infraestructura.
  Verifica cada servicio manualmente con los comandos de la guía antes de intentar levantar nada
- Si sigue fallando tras reintentar: **detente y reporta al usuario el servicio que falla**

> Referencia completa de CLI: `.agents/skills/phase3-logic-implementation/references/infra-validation-guide.md`

---

## Workflow principal — pasos A–E

### Paso A — Identificar el BC y cargar los artefactos de diseño

1. Pide al usuario el nombre del bounded context si no lo especificó
2. Lee en paralelo (son independientes entre sí):
   - `arch/{bc-name}/{bc-name}.yaml` — fuente de verdad: aggregates, use cases, domain_rules, repositories
   - `arch/{bc-name}/{bc-name}-flows.md` — especificación ejecutable de los TODOs
   - `arch/{bc-name}/{bc-name}-spec.md` — contexto de responsabilidades (referencia)
    - `arch/{bc-name}/{bc-name}-open-api.yaml` — solo para auditar binding/status/query params generados
    - `arch/{bc-name}/{bc-name}-internal-api.yaml` — si existe, solo para auditar contratos internos
    - `arch/{bc-name}/{bc-name}-async-api.yaml` — solo para auditar canales, routing keys y payloads
3. Lee `.agents/skills/phase3-logic-implementation/references/bc-artifacts-guide.md` para saber qué extraer de cada archivo

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
Lee `.agents/skills/phase3-logic-implementation/references/domain-service-patterns.md` para decidir. Señales de alerta:
- La lógica cruza más de un aggregate (ej: verificar categoría antes de crear producto)
- La misma lógica aparece en más de un handler (ej: slug generation en CreateCategory y CreateProduct)
- El flujo Given/When/Then describe pasos que no pertenecen naturalmente a ningún aggregate

**¿Requiere concurrencia con hilos virtuales?**
Lee `.agents/skills/phase3-logic-implementation/references/virtual-threads-in-handlers.md` para decidir. Solo aplica cuando:
- El handler realiza dos o más operaciones I/O **independientes** (sin dependencia entre ellas)
- Ejemplos: batch query a BD + llamada HTTP externa, dos repositorios sin relación causal

**¿Cuál es el orden de implementación?**
Implementa primero los domain services (si hay), luego los handlers que los usan.
Dentro de los handlers, sigue el orden de los flujos en `flows.md`.

### Paso C2 — Auditoría obligatoria de fidelidad al flujo

Antes de editar cualquier handler o aggregate, construye una mini-checklist por UC usando
`{bc-name}.yaml` + `{bc-name}-flows.md`:

- **`storageCalls[]`**: Si el UC declara `storageCalls[]` en el YAML, lee
    `references/storage-integration-patterns.md` antes de tocar el handler. Identifica la
    operación (`put` / `delete` / `signUrl` / `get`) y qué parte dejó como TODO la Fase 2.
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
- **Cross-BC**: si una validación necesita datos de OTRO bounded context, **no** inyectes su
    repositorio. Debe existir una `integration:` saliente declarada (adapter HTTP/ACL o evento). Si
    no existe, es dependencia no declarada → detente y reporta (coherente con "Cuándo detenerte").
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
- **Optimistic locking**: si la JPA entity del aggregate tiene `@Version Long version`, verifica
    que el aggregate de dominio también declare el campo `Long version` con getter, y que el mapper
    lo propague en `toDomain()` y `toJpa()`. Sin ese round-trip, Hibernate lanzará
    `OptimisticLockException` en el primer update de cualquier aggregate con
    `concurrencyControl: optimistic`. Si el campo no existe en el dominio, repórtalo como defecto
    del generador Fase 2 antes de proceder.

Si la checklist revela una contradicción entre YAML, OpenAPI/AsyncAPI y flows.md, detente
antes de implementar y reporta la inconsistencia exacta.

---

### Paso D — Crear domain services (si son necesarios)

Antes de implementar los handlers, crea los domain services identificados en el Paso C.

Ubicación: `src/main/java/{package}/{bc-name}/domain/services/`

Sigue las instrucciones de `.agents/skills/phase3-logic-implementation/references/domain-service-patterns.md` para la estructura exacta.

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
7. Ejecuta el ciclo completo del **Paso F** para este UC (F1→F2→F3). El UC **no se cierra con
    compilación**: solo cuando F3 pasa end-to-end **para todos los escenarios del flujo** (A, B,
    C…), no solo el camino feliz. No escribas ni generes tests de negocio en Fase 3; los tests
    pertenecen a una fase posterior.

Cuando **todos** los UCs del BC estén cerrados (todos sus escenarios verdes en el Paso F),
ejecuta el **Paso G — Generar colecciones Postman**.

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

## Paso F — Validar cada flujo implementado via contenedores

Ejecuta este paso **después de implementar CADA UC**, antes de pasar al siguiente. El ciclo es: implementar → validar → corregir si falla → continuar solo cuando pasa.

> **Regla de cierre (no negociable):** un UC **NO está "completado"** hasta que **F3 se ejecute con
> éxito end-to-end para TODOS los escenarios del flujo** (A, B, C…): el camino feliz **y** cada
> escenario de error/borde, con su request real → side effects verificados en DB/cache/broker (o la
> ausencia de side effects cuando el flujo lo prohíbe). **La compilación limpia (F1) y el arranque de
> la app (F2) NO bastan.** Si algún escenario no se ejecutó o no pasó, el UC está "en progreso",
> nunca "hecho". Está prohibido reportar al usuario un UC como terminado, pasar al siguiente UC, o
> marcar la tarea como completa sin un F3 verde para **cada** escenario de ese UC.

### F1 — Recompilar

```bash
./gradlew compileJava
```

Si falla → vuelve al Paso E, corrige los errores de compilación y repite.

### F2 — Verificar que la aplicación levanta

Detecta el runtime disponible (una vez por sesión, reutiliza la variable en F4):

```bash
if command -v podman &>/dev/null; then RUNTIME=podman; COMPOSE="podman compose"
elif command -v docker &>/dev/null; then RUNTIME=docker; COMPOSE="docker compose"
fi
```

**Si la app corre via contenedor:**

```bash
${COMPOSE} restart app

# Health check (esperar ~10s si se reinició)
curl -sf http://localhost:8080/actuator/health | jq .status
```

Si falla → lee los logs:
```bash
${COMPOSE} logs --tail=100 app
```

**Si la app corre localmente con `./gradlew bootRun`:**

Detén el proceso existente (Ctrl+C en la terminal correspondiente) y reinicia:
```bash
./gradlew bootRun
```
El perfil activo está en `src/main/resources/application.yml` bajo `spring.profiles.active`.
Los logs aparecen directamente en la terminal donde corre `bootRun`; no hay comando equivalente
a `${COMPOSE} logs`.

### F3 — Ejecutar el flujo del UC recién implementado

**Si el proyecto usa Keycloak** (`authProvider: keycloak` en `CLAUDE.md` o `AGENTS.md`),
obtén el token antes de ejecutar cualquier `curl`:

```bash
TOKEN=$(curl -s -X POST \
  "http://localhost:8180/realms/{realm}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id={clientId}&client_secret={clientSecret}" \
  | jq -r .access_token)
```

Añade `-H "Authorization: Bearer ${TOKEN}"` a cada `curl` de validación.
El `{realm}`, `{clientId}` y `{clientSecret}` están en la configuración del proyecto
(normalmente `docker-compose.yml` o `keycloak/realm-export.json`).

> Variantes (password grant, introspección, etc.):
> `.agents/skills/phase3-logic-implementation/references/infra-validation-guide.md` → sección Keycloak

1. Consulta el flujo en `arch/{bc-name}/{bc-name}-flows.md` (FL-{BC}-{N})
2. **Itera sobre CADA escenario del flujo** (Escenario A, B, C…), no solo el primero:
   - El `Given` define las pre-condiciones (estado previo, rol/credencial a usar)
   - El `When` define la request a ejecutar
   - El `Then` define el resultado esperado: status HTTP (2xx en el feliz, 4xx en los de error),
     side effects en DB/cache/broker, **o la ausencia de ellos** (p.ej. un escenario de error o
     idempotente que NO debe persistir ni publicar evento)
3. Traduce cada paso del **Then** a comandos HTTP y CLI de contenedores
4. Ejecuta los comandos en el orden del flujo y verifica el resultado esperado de **cada** escenario

> **Importante:** los escenarios de error (nombre duplicado → 409, recurso inexistente → 404,
> permiso insuficiente → 403, validación → 400) son parte del flujo y deben ejecutarse igual que el
> feliz. Para ellos, confirma el status de error correcto y que **no** se produjeron side effects no
> deseados.

Ejemplo completo para un UC `CreateProduct`:

```bash
# 1. POST — crear el recurso
curl -s -X POST http://localhost:8080/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Widget","categoryId":"uuid-aqui","price":{"amount":100,"currency":"USD"}}' \
  | jq .

# 2. Verificar persistencia en DB (según el motor — ver dsl-springboot.json#/database)
#    PostgreSQL:
${RUNTIME} exec {SYSTEM}-devtools psql -h postgres -U postgres -d {dbName} \
  -c "SELECT id, name, status FROM catalog.products ORDER BY created_at DESC LIMIT 1"
#    SQL Server (cliente sqlcmd en devtools):
${RUNTIME} exec {SYSTEM}-devtools sqlcmd -S sqlserver,1433 -U sa -P 'Str0ng_Passw0rd!' -d {dbName} -C \
  -Q "SELECT TOP 1 id, name, status FROM products ORDER BY created_at DESC"
#    Oracle (sqlplus dentro del contenedor oracle):
${RUNTIME} exec {SYSTEM}-oracle bash -c "echo 'SELECT id, name, status FROM products ORDER BY created_at DESC FETCH FIRST 1 ROWS ONLY;' | sqlplus -s appuser/Str0ng_Passw0rd1@//localhost:1521/FREEPDB1"

# 3. Verificar evento publicado (si el UC emite evento Kafka)
${RUNTIME} exec {SYSTEM}-devtools kcat -b kafka:29092 -t catalog.product.created -o -1 -e \
  | jq .

# 4. Verificar clave de idempotencia (si el UC tiene idempotency)
${RUNTIME} exec {SYSTEM}-devtools redis-cli -h cache GET "idempotency:{requestId}"
```

Donde `{SYSTEM}` es el valor de `systemName` en `dsl-springboot.json`.

> Comandos completos para cada tecnología: `.agents/skills/phase3-logic-implementation/references/infra-validation-guide.md`

### F4 — Si el flujo falla: fix loop

1. Lee los logs: `${COMPOSE} logs --tail=100 app` (o revisa la terminal de `bootRun` si corre local)
2. Identifica la capa que falla:
   - Lógica de dominio → handler, aggregate, domain service
   - Persistencia → repositorio JPA, entidad JPA, Flyway migration
   - Mensajería → producer, publisher, serialización del evento
   - Respuesta HTTP → controller, mapper, exception advice
3. Corrige el archivo afectado
4. Vuelve a F1 (recompilar → reiniciar → re-ejecutar el flujo)
5. Repite hasta `[PASS]`

**Regla:** Solo avanza al siguiente UC cuando este flujo ejecuta end-to-end sin errores y los side effects (DB, cache, broker) son los esperados.

---

## Paso G — Generar colecciones Postman (al cerrar el BC)

Ejecuta este paso **una sola vez, después de que TODOS los UCs del BC estén cerrados** (todos sus
escenarios verdes en el Paso F). El objetivo es dejar un artefacto reutilizable para que un humano
pueda revalidar los flujos manualmente.

> **Precondición:** no generes las colecciones si algún escenario del Paso F quedó en rojo o sin
> ejecutar. Las colecciones reflejan lo que realmente validaste.

Lee `.agents/skills/phase3-logic-implementation/references/postman-collection-guide.md` para la
estructura JSON exacta (formato Postman Collection v2.1.0), las plantillas de request y las
convenciones de nombres de variables.

Escribe los archivos con el tool **Write** dentro de un directorio `postman/` en la raíz del
proyecto (créalo si no existe).

### G1 — `postman/auth-collection.json` (compartido entre BCs)

- **Si el archivo ya existe, NO lo recrees ni lo sobrescribas.** Es compartido por todos los BCs
  del mismo sistema; recrearlo perdería ajustes manuales del usuario. Solo notifícalo y continúa.
- Si no existe, genéralo con **una request de token por cada rol/credencial** que los flujos del BC
  necesiten. Detecta los roles y las credenciales desde la configuración del proyecto:
  - Keycloak: `keycloak/realm-export.json`, `docker-compose.yml` (realm, clientId, secret, usuarios)
  - OAuth2 client-credentials: `tokenEndpoint`, clientId/secret de los parámetros del proyecto
- Cada request guarda su token en una **global de Postman** en el script de test:
  `pm.globals.set("token_<rol-kebab>", pm.response.json().access_token)`.

### G2 — `postman/{bc-name}-collection.json` (se regenera siempre)

- **Carpeta por flujo** `FL-{BC}-{N}`; dentro, **una request por cada escenario** (A, B, C…):
  - `Authorization: Bearer {{token_<rol>}}` según el rol del `Given`
  - método, URL (`{{baseUrl}}` + path del controller) y body derivados del `When`
  - un script de test que asserta el resultado del `Then` (status esperado —2xx o el 4xx del
    escenario de error— y, cuando aplique, la forma de la respuesta)
- **Carpeta adicional "CRUD"** con los endpoints triviales del BC: los UCs **sin**
  `implementation: scaffold` que existan en `{bc-name}-open-api.yaml`. Una request por
  `operationId`, con body de ejemplo derivado del schema.
- Declara `{{baseUrl}}` como variable de colección (default `http://localhost:8080`).

### G3 — Reportar al usuario

Indica las rutas generadas y el orden de uso en Postman:
1. Importar `postman/auth-collection.json` y ejecutarlo para poblar las globals de token.
2. Importar `postman/{bc-name}-collection.json` y ejecutar las carpetas de flujos.

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
8. **Definición de "completado":** un UC solo está completo cuando su flujo se validó vía Paso F3
    (ejecución real + side effects esperados). Compilar **no** es completar. No reportes progreso
    como terminado, ni avances al siguiente UC, sin esa evidencia (refuerza la regla F4 del Paso F).
9. **Aislamiento de bounded contexts (rompe la arquitectura si se viola):** un handler, aggregate
    o domain service de un BC **NUNCA** inyecta ni referencia un repositorio, entidad JPA, aggregate
    o clase de dominio de **otro** BC. Cada BC solo conoce sus propios puertos. La comunicación entre
    BCs ocurre **exclusivamente** a través de las `integrations:` declaradas en `{bc-name}.yaml`
    (adapters HTTP/ACL salientes, eventos async, internal-API). Si un flujo parece requerir datos de
    otro BC y no hay integración declarada, **detente y notifica** — no inyectes su repositorio.

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
| `.agents/skills/phase3-logic-implementation/references/bc-artifacts-guide.md` | Necesitas entender la estructura de `flows.md` o `{bc-name}.yaml` |
| `.agents/skills/phase3-logic-implementation/references/domain-service-patterns.md` | Detectas lógica que cruza aggregates o es reusable |
| `.agents/skills/phase3-logic-implementation/references/virtual-threads-in-handlers.md` | El handler tiene I/O independiente en paralelo |
| `.agents/skills/phase3-logic-implementation/references/storage-integration-patterns.md` | El UC declara `storageCalls[]` (put / delete / signUrl / get) |
| `.agents/skills/phase3-logic-implementation/references/infra-validation-guide.md` | Comandos CLI exactos para DB, Kafka, Redis, RabbitMQ, MinIO, Keycloak o reinicio de app |
| `.agents/skills/phase3-logic-implementation/references/postman-collection-guide.md` | Ejecutas el Paso G: estructura JSON de las colecciones Postman (`auth-collection` + `{bc}-collection`) |
| `AGENTS.md` (raíz del proyecto) | Necesitas confirmar una convención de código o arquitectura |
