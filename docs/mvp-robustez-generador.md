# Informe MVP de robustez del generador Spring Boot

Fecha de analisis: 2026-05-10

## Objetivo

Este documento resume el soporte actual de `@dsl/springboot-generator`, evalua su estado como MVP para generar proyectos Java Spring Boot validos desde artefactos de diseno en `arch/`, e identifica los puntos mas debiles que conviene fortalecer para reducir errores de build y aumentar la robustez deterministica del generador.

El criterio usado es el definido por `VISION.md` y `AGENTS.md`: el generador pertenece a la Fase 2 del pipeline, no disena, no infiere decisiones de dominio y debe producir scaffolding Spring Boot trazable, reproducible y compilable a partir de YAML aprobados.

## Resumen ejecutivo

El generador ya tiene una base solida para un MVP. Actualmente soporta una arquitectura hexagonal con DDD y CQRS, generacion de dominio, aplicacion, infraestructura, REST, mensajeria, integraciones HTTP, seguridad, resiliencia, outbox, idempotencia, proyecciones persistentes y sagas coreografiadas.

La validacion manual realizada sobre el proyecto generado en `C:\Users\antonio.suarez\Desktop\test-dsl` muestra que, corrigiendo `JAVA_HOME` para apuntar al JDK disponible, el proyecto generado pasa `./gradlew clean compileJava --no-daemon` y tambien `./gradlew build --no-daemon`.

La debilidad principal no es que el snapshot actual no compile, sino que el repositorio del generador todavia no tiene una compuerta automatica que compile el Java generado en sus escenarios de prueba. Eso deja espacio para que cambios futuros en templates, imports, tipos o mappers rompan el build de proyectos generados sin que `npm test` lo detecte.

## Validacion realizada

### Validacion del generador

Comando ejecutado:

```bash
npm test
```

Resultado observado:

- 25 de 26 escenarios pasan.
- El escenario `cs-http-full` falla por diferencias contra golden files en clases de query.
- Hay escenarios que pasan sin directorio `expected/`, por lo que aun no cierran regresiones completas de salida.

Metricas observadas:

- 20 archivos generadores en `src/generators/`.
- 189 templates EJS en `templates/`.
- 26 escenarios en `test/scenarios/`.
- 22 escenarios con `expected/`.
- 1258 archivos Java esperados bajo golden files.

### Validacion del proyecto generado

Proyecto revisado:

```text
C:\Users\antonio.suarez\Desktop\test-dsl
```

Comandos ejecutados:

```bash
JAVA_HOME='C:\java\jdk-17' PATH='/c/java/jdk-17/bin':$PATH ./gradlew clean compileJava --no-daemon
JAVA_HOME='C:\java\jdk-17' PATH='/c/java/jdk-17/bin':$PATH ./gradlew build --no-daemon
```

Resultado observado:

- `compileJava`: exitoso.
- `build`: exitoso.
- El proyecto generado contiene aproximadamente 251 archivos Java.

Nota operativa: el primer intento fallo porque `JAVA_HOME` estaba configurado como `C:\java`, ruta invalida. El JDK usable encontrado fue `C:\java\jdk-17`.

## Soporte actual del generador

### Entrada de diseno

El generador lee artefactos desde `arch/`:

- `arch/system/system.yaml` para arquitectura estrategica, bounded contexts, infraestructura, integraciones, auth server y sagas.
- `arch/{bc}/{bc}.yaml` para diseno tactico: enums, value objects, projections, aggregates, use cases, repositories, errors, integrations y domain events.
- `arch/{bc}/{bc}-open-api.yaml` para contratos REST publicos.
- `arch/{bc}/{bc}-internal-api.yaml` para contratos REST internos BC-a-BC.
- `arch/{bc}/{bc}-async-api.yaml` para contratos de eventos.

Tambien excluye `arch/review/` del descubrimiento de bounded contexts, respetando la regla de no procesar artefactos en revision.

### Generacion base Spring Boot

Soporte actual:

- Proyecto Gradle Spring Boot.
- `build.gradle`, `settings.gradle`, wrapper y estructura base.
- Configuracion por parametros.
- Dockerfile y `docker-compose.yaml`.
- Configuracion de base de datos PostgreSQL/H2 segun parametros.
- Flyway cuando se generan artefactos persistentes.
- Dependencias de Spring Web, JPA, Validation, Actuator, Security, OAuth2 Resource Server, OpenFeign, RabbitMQ/Kafka, Redis, Resilience4j y Spring Modulith segun configuracion.

### Dominio

Soporte actual:

- Enums simples y enums de ciclo de vida con transiciones.
- Value Objects inmutables.
- Event DTOs externos declarados.
- Aggregates y child entities.
- Propiedades auditables y soft delete.
- Campos ocultos `hidden: true`.
- Control de concurrencia optimista en JPA con `concurrencyControl: optimistic`.
- Domain methods con scaffolding o logica generada cuando aplica.
- Domain events publicados desde aggregates.
- Trazabilidad con comentarios `derived_from` en varias rutas de generacion.

### Aplicacion

Soporte actual:

- Commands y queries CQRS.
- Handlers de use cases.
- DTOs de entrada y salida.
- Mappers application-domain.
- Projections transitorias y persistentes.
- Paginacion y sorting declarativos.
- Autorizacion declarativa por roles, permisos, scopes y ownership.
- Idempotencia de requests.
- Query caching.
- Bulk commands.
- Async job tracking.
- Multi-aggregate same-BC orchestration.
- Errores parametrizados y mapeados a excepciones de dominio.

### Infraestructura de persistencia

Soporte actual:

- Entidades JPA con Lombok.
- Repositorios Spring Data JPA.
- Implementaciones de puertos de repositorio.
- Mappers JPA-domain.
- Query methods con filtros, `Page`, `Slice`, `Stream`, `List`, `Optional`, `Boolean`, `Long` e `Int`.
- Derivacion de metodos por reglas de unicidad.
- Especificaciones para filtros avanzados.
- Proyecciones persistentes y updaters.

### REST y contratos HTTP

Soporte actual:

- Controllers REST publicos desde OpenAPI.
- Controllers internos desde Internal API.
- Request DTOs y response DTOs.
- Soporte para path/query/body/header/authContext/multipart en inputs.
- Descargas `BinaryStream`.
- Endpoints publicos `public: true` reflejados en configuracion de seguridad.
- OpenAPI annotations cuando estan habilitadas.

### Mensajeria y eventos

Soporte actual:

- Domain events publicados y consumidos.
- Integration events.
- RabbitMQ y Kafka segun configuracion.
- Topologia de broker en parametros YAML.
- Shared broker config.
- Listeners de eventos.
- Metadata canonica `EventMetadata`.
- Validaciones cross-YAML AsyncAPI para eventos declarados, payloads y canales.
- Outbox transaccional.
- Idempotencia de consumidores.

### Integraciones externas y BC-a-BC

Soporte actual:

- Integraciones HTTP BC-a-BC via internal API.
- Puertos y adaptadores HTTP salientes.
- Clientes Feign.
- ACL adapters para sistemas externos.
- DTOs y mappers ACL.
- Autenticacion para integraciones: `oauth2-cc`, `api-key`, `bearer`, `internal-jwt`, `mTLS` y `none` segun guias.
- Resiliencia con circuit breaker, retries y timeouts.
- Validaciones de coherencia entre `system.yaml`, `bc.yaml` e internal APIs.

### Seguridad

Soporte actual:

- Spring Security con JWT resource server.
- Keycloak como auth provider.
- Generacion de realm export para Keycloak.
- Roles, permisos y scopes.
- Conversor JWT para roles y authorities.
- Endpoints publicos declarativos.

### Validaciones existentes

Fortalezas actuales:

- Whitelist estricta de claves en varias secciones de `bc.yaml`.
- Validacion de tipos canonicos y tipos prohibidos.
- Validacion de Decimal con precision/scale.
- Validacion de inputs de use cases.
- Validacion de autorizacion, idempotencia, cacheable, bulk, async y multi-aggregate use cases.
- Validacion de errores, HTTP statuses, message templates y errores huerfanos.
- Validacion de integraciones `INT-001..INT-027`.
- Validacion de AsyncAPI contra domain events.

## Puntos debiles y razones de ajuste

### 1. Falta compilar el Java generado dentro de la suite del generador

El runner actual ejecuta el CLI, assertions y diffs contra golden files, pero no corre `gradle compileJava` en el proyecto temporal generado.

Riesgo:

- Un template puede generar Java sintacticamente invalido y el test podria no detectarlo si no hay assertion especifica.
- Imports faltantes, tipos inexistentes, errores de generics o annotations invalidas se detectan tarde, en proyectos de usuario.
- El generador puede parecer estable aunque el contrato real del MVP, producir Spring Boot compilable, no este garantizado por CI.

Ajuste recomendado:

- Agregar una fase `compileGeneratedJava` al scenario runner.
- Ejecutar `./gradlew compileJava --no-daemon` en escenarios happy path.
- Permitir opt-out por escenario para pruebas negativas.
- En una segunda fase, ejecutar `./gradlew build --no-daemon` para un escenario MVP completo.

Prioridad: critica.

### 2. Algunas fases criticas hacen `warn` y continuan en modo estricto

En la orquestacion del build hay rutas donde se omiten outbound adapters, controllers o messaging con advertencia.

Riesgo:

- El YAML puede declarar un endpoint, integracion o evento, pero el generador omite el artefacto por un error interno o una inconsistencia.
- El usuario recibe un proyecto incompleto y descubre el problema cuando intenta usarlo o compilarlo.
- Contradice la regla de no inferir ni ocultar decisiones no cubiertas.

Ajuste recomendado:

- Convertir skips de artefactos declarados en diagnosticos formales.
- En `--strict`, cualquier controller, adapter o listener declarado pero no generable debe fallar.
- En `--no-strict`, mantener advertencias para exploracion.

Prioridad: critica.

### 3. Validacion OpenAPI/Internal API contra use cases incompleta

El reader valida que un use case HTTP tenga `operationId`, pero falta una validacion fuerte que compruebe que cada `operationId` existe y que su contrato coincide con `input[]` y `returns`.

Riesgo:

- Use cases HTTP sin controller generado si el `operationId` no existe.
- Endpoints OpenAPI sin handler de aplicacion.
- Parametros path/query/header/body divergentes del YAML tactico.
- Response schemas que no coinciden con `returns`.

Ajuste recomendado:

- Crear un validador `openapi-usecase-validator`.
- Reglas minimas:
  - Todo `useCases[].trigger.kind=http` debe resolver a una operacion OpenAPI o Internal API.
  - Toda operacion OpenAPI publica/interna debe tener use case correspondiente, salvo que se marque explicitamente como externo al generador.
  - `input[].source` debe coincidir con path/query/header/requestBody/security.
  - `returns` debe coincidir con el response schema principal.
  - `operationId` debe ser unico por BC.

Prioridad: alta.

### 4. Fallbacks a `Object`, `null` y TODOs no siempre distinguen scaffold intencional de diseno insuficiente

Hay rutas donde el generador cae a `Object`, `null /* TODO */`, `return null` o `UnsupportedOperationException` cuando no puede resolver informacion.

Riesgo:

- Un TODO puede representar una decision valida de Fase 3 o una falla de Fase 2.
- `Object` degrada tipos de dominio y puede romper mappers, serializacion o compilacion en rutas posteriores.
- `null` en eventos o DTOs puede compilar pero generar comportamiento incorrecto.

Ajuste recomendado:

- Clasificar TODOs en dos categorias:
  - Permitidos: solo si el YAML declara `implementation: scaffold` o la regla documentada delega a Fase 3.
  - Bloqueantes: tipos desconocidos, mapping de evento no resoluble, return no mapeable, repo method faltante, operationId faltante.
- En `--strict`, los TODOs bloqueantes deben detener el build con diagnostico YAML preciso.
- Evitar `Object` como fallback en dominio/aplicacion; exigir tipo canonico, enum, value object, aggregate, projection o event DTO declarado.

Prioridad: alta.

### 5. Golden files incompletos y drift en escenario existente

La suite tiene un escenario fallando por drift (`cs-http-full`) y algunos escenarios sin `expected/`.

Riesgo:

- Cambios accidentales de salida quedan sin detectar.
- Escenarios sin golden files solo prueban que el comando no falla y algunas assertions puntuales.
- La confianza en regresiones de templates queda limitada.

Ajuste recomendado:

- Corregir o aceptar conscientemente el drift de `cs-http-full`.
- Crear golden files para escenarios que aun no tienen `expected/`.
- Agregar un escenario `mvp-full-generated-build` basado en un arch representativo que cubra REST, JPA, seguridad, mensajeria, outbox/idempotencia e integraciones.

Prioridad: alta.

### 6. Validacion fragmentada entre readers, generadores y templates

Parte de la validacion ocurre en `bc-yaml-reader`, parte en `integration-validator`, parte durante generacion y parte implicitamente en templates.

Riesgo:

- Errores se detectan tarde y con mensajes menos claros.
- Diferentes generadores pueden interpretar la misma estructura de forma distinta.
- Se duplican heuristicas de tipos, imports, operaciones y repositorios.

Ajuste recomendado:

- Introducir una fase de modelo intermedio normalizado antes de renderizar templates.
- El pipeline recomendado seria:
  1. Leer YAML.
  2. Validar schema y cross-YAML.
  3. Normalizar a un modelo canonico tipado.
  4. Validar que el modelo es completamente generable.
  5. Renderizar templates.
  6. Compilar Java generado en tests.

Prioridad: media-alta.

### 7. Dos readers OpenAPI con contratos distintos

Existen rutas que leen OpenAPI como documento completo y otra utilidad que lo transforma en mapa de operaciones.

Riesgo:

- Comportamientos divergentes al resolver operationId, requestBody, parameters o responses.
- Arreglos aplicados a un reader pueden no beneficiar a otros generadores.

Ajuste recomendado:

- Unificar la lectura OpenAPI en un modulo canonico que devuelva documento original y mapa normalizado.
- Reutilizar ese modulo en controllers, application layer, security public endpoints y outbound adapters.

Prioridad: media.

## Ajustes recomendados por roadmap

### Fase 1: cerrar robustez minima del MVP

Objetivo: garantizar que cada escenario happy path genera Java compilable.

Acciones:

- Agregar compilacion Java generada al test runner.
- Corregir `cs-http-full`.
- Crear golden files faltantes.
- Agregar escenario MVP completo compilable.
- Documentar requisito de JDK o resolver toolchain en tests.

Resultado esperado:

- `npm test` falla si el generador produce Java invalido.
- El usuario tiene una senal automatica fuerte antes de probar proyectos reales.

### Fase 2: fail-fast estricto sobre artefactos declarados

Objetivo: que `--strict` no genere proyectos incompletos cuando algo declarado no puede producirse.

Acciones:

- Reemplazar skips criticos por diagnosticos.
- Fallar en `--strict` si no se generan controllers, messaging o adapters declarados.
- Clasificar TODOs permitidos vs bloqueantes.
- Eliminar fallbacks silenciosos a `Object` en rutas de dominio/aplicacion.

Resultado esperado:

- El generador detiene temprano los disenos incompletos o inconsistentes.
- Los errores apuntan a YAML y no a compilacion Java posterior.

### Fase 3: validacion contractual OpenAPI/useCases

Objetivo: evitar drift entre contratos HTTP y diseno tactico.

Acciones:

- Crear `openapi-usecase-validator`.
- Validar operationId, parametros, request body, headers, multipart y response schemas.
- Validar internal APIs para integraciones BC-a-BC.
- Unificar readers OpenAPI.

Resultado esperado:

- Los controllers generados son completos y coherentes con los contratos.
- Las inconsistencias se detectan antes de generar Java.

### Fase 4: modelo intermedio normalizado

Objetivo: reducir heuristicas duplicadas y hacer mas deterministica la generacion.

Acciones:

- Construir un modelo canonico con tipos resueltos, imports necesarios, operaciones, repositorios, DTOs, eventos y mappings.
- Hacer que templates reciban datos ya normalizados.
- Reducir logica compleja dentro de EJS.

Resultado esperado:

- Menos divergencia entre generadores.
- Errores mas claros.
- Menos riesgo de que cambios en una capa rompan otra.

## Recomendacion final

Si el objetivo es consolidar este proyecto como MVP, el siguiente ajuste mas importante es incorporar compilacion del Java generado dentro del ciclo de pruebas. Eso convierte la promesa principal del generador en una garantia verificable.

Despues de eso, conviene endurecer `--strict` para que no omita artefactos declarados y agregar validacion fuerte OpenAPI/Internal API contra use cases. Con esas tres mejoras, el generador pasaria de ser un scaffolder avanzado con buena cobertura documental a una herramienta mucho mas confiable para producir proyectos Spring Boot compilables de forma deterministica.

---

## Analisis complementario de Fase 1: `dsl-design-system`

Proyecto revisado:

```text
C:\Documentos\dsl-project\dsl-design-system\src
```

### Objetivo de la revision

Validar si el proyecto de Fase 1, responsable de guiar el diseno y producir los artefactos `arch/`, esta suficientemente alineado con lo que el generador de Fase 2 consume. La revision inicial se hizo sin modificar archivos de `dsl-design-system`; posteriormente se implementaron ajustes concretos de alineacion en ese repositorio.

### Estado general

La Fase 1 esta conceptualmente bien alineada con la vision. El repositorio declara claramente que no genera codigo y que su responsabilidad es producir artefactos YAML agnosticos. El CLI `dsl` tiene tres comandos principales:

- `dsl init`: inicializa `arch/`, copia agents/skills y crea `tools/dsl-validate/`.
- `dsl validate`: valida coherencia entre `system.yaml`, `bc.yaml` y AsyncAPI.
- `dsl preview`: genera una vista navegable de diagramas y contratos.

Los agentes principales tambien estan alineados:

- `design-system`: produce `arch/system/system.yaml`, `system-spec.md`, `system-diagram.mmd` y `AGENTS.md`.
- `design-bounded-context`: produce `bc.yaml`, `bc-spec.md`, `bc-flows.md`, OpenAPI, Internal API condicional, AsyncAPI y diagramas.

La Fase 1 ya contiene mucho conocimiento especifico del generador: restricciones de `useCases[]`, `domainRules[]`, `repositories[]`, `eventDtos[]`, `projections[]`, auth/resilience, idempotencia, cache, AsyncAPI y eventos. Eso es positivo porque reduce la probabilidad de que el agente de diseno produzca YAML que el generador rechace.

### Soporte actual relevante para la coherencia con Fase 2

La Fase 1 ya soporta o documenta correctamente:

- Estructura canonical de `arch/system/` y `arch/{bc}/`.
- Validacion previa de que un BC exista en `system.yaml` antes de ejecutar Paso 2.
- Separacion entre diseno estrategico y tactico.
- Exclusion de `arch/review/` en el descubrimiento de BCs dentro del validador.
- Uso de `tools/dsl-validate` como validador local copiado al workspace del usuario.
- Reglas `INT-001..INT-027` para integraciones, eventos, AsyncAPI, auth y schemas externos.
- Prohibicion de `source: auth-context` en payloads de eventos (`INT-025`).
- Uso de `source: authContext` para inputs/campos derivados del contexto de autenticacion.
- Reglas para `eventDtos[]`, proyecciones persistentes, `versionGuarded`, outbox/idempotencia, auth, resiliencia y cache.
- Reglas practicas para evitar errores de build conocidos, por ejemplo `queries returns: CategoryResponse` en lugar de `Category`.

### Estado posterior a los ajustes implementados

Despues del analisis se aplicaron cambios en `dsl-design-system` para cerrar los puntos mas directos de coherencia con el generador:

- `src/utils/integration-validator.js` quedo sincronizado con el validador del generador. La comparacion `diff` entre ambos archivos no muestra diferencias.
- `dsl init` sigue copiando el validador actualizado hacia `tools/dsl-validate/` porque `src/commands/init.js` ya usa `DSL_VALIDATE_SOURCES` para copiar `src/utils/integration-validator.js`.
- Se corrigieron referencias de Fase 1 que mostraban `source: auth-context` como fuente valida en payloads publicados. Ahora queda documentado como prohibido por `INT-025` y se muestra el patron valido con `source: authContext` en propiedad/input y `source: aggregate` o `source: param` en el evento.
- Se ajusto la regla de `domainRules[].type: uniqueness`: `field` queda recomendado para generacion completa, obligatorio solo cuando se usa `constraintName`.
- Se aclaro la politica de commands REST: CQRS sin response body sigue siendo el default, pero si OpenAPI declara `responses.<2xx>.content.application/json`, el command debe declarar `useCases[].returns` y coincidir con el schema.
- Se agrego una suite minima de smoke tests en `dsl-design-system/test/runner.js` y se reemplazo el script placeholder de `npm test`.

Validaciones ejecutadas en `dsl-design-system`:

```bash
npm test
node bin/dsl.js --help
git diff --check
```

Resultado observado:

- `npm test`: 5/5 tests pasan.
- `node bin/dsl.js --help`: exitoso.
- `git diff --check`: sin errores.
- El validador de Fase 1 y el del generador quedaron sin drift detectable por `diff`.

La nueva suite cubre:

- `dsl init` crea `arch/`, `.agents/skills`, `.github/agents`, `tools/dsl-validate/` y `tools/package.json`.
- El `tools/dsl-validate/bin/dsl.js validate` copiado valida un fixture minimo correcto.
- Un fixture con `source: auth-context` en payload publicado falla con `INT-025`.
- Un flujo incremental con BC declarado pero aun no disenado emite warning, no error estricto.
- Las referencias principales no vuelven a whitelistear `auth-context` como fuente valida de payload publicado.

### Ajustes necesarios para mayor coherencia

Estos ajustes fueron revisados despues de la implementacion. Algunos quedaron resueltos y otros siguen como trabajo futuro. No implican cambiar la responsabilidad de Fase 1 ni hacerla dependiente de Spring Boot; son ajustes de contrato para que produzca artefactos mas compatibles con el generador actual.

#### 1. Sincronizar el validador de Fase 1 con el del generador

Habia drift entre:

```text
dsl-design-system/src/utils/integration-validator.js
dsl-springboot-generator/src/utils/integration-validator.js
```

Estado: resuelto en el ajuste implementado.

La diferencia mas importante era el manejo de BCs declarados en `system.yaml` pero todavia no disenados en `arch/{bc}/`. El generador ya degradaba algunos casos a warning para permitir un flujo incremental, mientras que el validador de Fase 1 tendia a marcarlos como error.

Riesgo:

- Durante el diseno incremental, Fase 1 puede bloquear al usuario por BCs que aun no han pasado por Paso 2.
- Fase 1 y Fase 2 pueden reportar severidades distintas para el mismo set de artefactos.

Accion aplicada:

- Se sincronizo `dsl-design-system/src/utils/integration-validator.js` con `dsl-springboot-generator/src/utils/integration-validator.js`.
- `INT-007`, `INT-012` e `INT-014` ahora consideran BCs declarados pero aun no disenados y degradan esos casos a warning cuando corresponde.
- Se agrego un test smoke que valida el caso incremental.

Pendiente recomendado:

- Extraer las reglas `INT-*` a un paquete o modulo compartido versionado, usado por ambos proyectos.
- Agregar una prueba simple en ambos repos que compare codigos de diagnostico activos (`INT-001..INT-027`) para detectar drift futuro.

Prioridad: alta.

#### 2. Corregir contradiccion documental sobre `source: auth-context` en eventos

Estado: resuelto en el ajuste implementado.

El skill tactico principal indicaba correctamente que `source: auth-context` esta prohibido en `domainEvents.published[].payload[]`. Sin embargo, una referencia interna de Fase 1 conservaba un ejemplo y una tabla donde aparecia como fuente valida del payload.

Ejemplo de inconsistencia detectada:

```yaml
- { name: triggeredBy, type: String, source: auth-context, claim: sub }
```

Esto contradice `INT-025`, que el generador y el validador ya aplican como error.

Riesgo:

- El agente puede leer la referencia antigua y generar un payload invalido.
- El usuario recibe una regla contradictoria: una seccion dice que esta prohibido y otra lo muestra como permitido.

Accion aplicada:

- Se elimino `auth-context` de la whitelist de payloads en las referencias de Fase 1.
- Se reemplazo el ejemplo por el patron valido:

```yaml
properties:
  - name: createdBy
    type: Uuid
    readOnly: true
    source: authContext

domainEvents:
  published:
    - name: OrderConfirmed
      payload:
        - name: triggeredBy
          type: Uuid
          source: aggregate
          field: createdBy
```

Prioridad: alta.

#### 3. Alinear la politica de responses en commands REST

Estado: parcialmente resuelto.

La referencia OpenAPI de Fase 1 promueve CQRS estricto: commands sin response body (`POST` con `201 + Location`, `PATCH/DELETE` con `204`). Pero el skill tactico tambien reconoce que el generador soporta `returns` en commands cuando el OpenAPI declara body JSON.

Riesgo:

- El agente puede producir OpenAPI sin body por seguir CQRS estricto, pero luego declarar `returns` en el UC, o al reves.
- El generador soporta ambas rutas, pero necesita coherencia exacta entre OpenAPI y `useCases[].returns`.

Accion aplicada:

- Se mantuvo CQRS estricto como default de diseno.
- Se declaro una excepcion explicita y unica: si un command tiene `responses.<2xx>.content.application/json`, entonces `useCases[].returns` es obligatorio y debe coincidir con el schema de respuesta.

Pendiente recomendado:

- Agregar esta regla al validador de Fase 1 si se decide ampliar `dsl validate` para leer OpenAPI. Por ahora quedo documentada y reflejada en el checklist de refinamiento.

Prioridad: media-alta.

#### 4. Resolver la tension sobre `domainRules[].type: uniqueness` y `field`

Estado: resuelto en el ajuste implementado.

El generador permite `uniqueness` sin `field`: valida, pero genera TODO enriquecido porque no puede emitir una guardia ejecutable completa. Solo exige `field` cuando se declara `constraintName`. Algunas instrucciones de Fase 1 decian que `field` era obligatorio y que sin el fallaba el build.

Riesgo:

- No rompe el generador, pero confunde el contrato: una regla de calidad de diseno aparece como si fuera restriccion tecnica estricta.
- El agente puede sobrerrestringir casos donde el diseno aun no tiene informacion suficiente.

Accion aplicada:

- Se ajusto el texto de Fase 1:
  - `field` recomendado para generacion completa.
  - `field` obligatorio solo si se usa `constraintName`.
  - Sin `field`, el diseno es aceptado pero queda como scaffold/TODO enriquecido, por lo que debe clasificarse como alerta de robustez, no como error estructural.

Prioridad: media.

#### 5. Agregar una validacion de contrato Fase 1 -> Fase 2

Estado: parcialmente resuelto.

Fase 1 tiene `dsl validate`, pero el MVP necesita una prueba mas cercana al flujo real: tomar artefactos producidos por Fase 1 y pasarlos por el generador en modo estricto.

Riesgo:

- Fase 1 puede pasar su propio validador y aun asi producir YAML que el generador rechaza por una whitelist mas nueva.
- Los skills pueden quedar por delante o por detras del generador.

Accion aplicada:

- Se agregaron smoke tests de Fase 1 que validan `dsl init`, el validador copiado en `tools/dsl-validate`, un fixture valido, un fixture invalido con `INT-025` y el flujo incremental con BC aun no disenado.

Pendiente recomendado:

- Crear un escenario fixture compartido o reproducible:
  1. Fase 1 produce un `arch/` completo de ejemplo.
  2. Fase 1 ejecuta `tools/dsl-validate`.
  3. Fase 2 ejecuta `dsl-springboot build --strict` sobre ese `arch/`.
  4. Fase 2 compila `./gradlew compileJava` sobre el proyecto generado.
- Este test puede vivir inicialmente como script manual documentado y luego subir a CI.

Prioridad: alta.

#### 6. Agregar tests minimos al proyecto `dsl-design-system`

Estado: resuelto en el ajuste implementado.

El `package.json` de Fase 1 tenia:

```json
"test": "echo \"Error: no test specified\" && exit 1"
```

Riesgo:

- Cambios en skills, validador o templates del CLI no tienen una red de seguridad.
- `dsl init` podria dejar de copiar `tools/dsl-validate` correctamente sin que se detecte.

Accion aplicada:

- Se agregaron tests minimos de smoke:
  - `dsl init` en un directorio temporal crea `.agents/skills`, `.github/agents`, `arch/` y `tools/dsl-validate`.
  - `tools/dsl-validate/bin/dsl.js validate` ejecuta contra un fixture minimo valido.
  - Un fixture invalido dispara un codigo `INT-*` esperado.

El script `npm test` ahora ejecuta `node test/runner.js`.

Prioridad: media-alta.

### Ajustes no necesarios por ahora

No considero necesario que Fase 1 genere codigo, compile Java ni conozca detalles de Gradle/Spring Boot. Eso pertenece a Fase 2.

Tampoco considero necesario que Fase 1 deje de ser agnostica. Las reglas que menciona del generador deben entenderse como contrato del DSL, no como decisiones tecnologicas. Donde aparezcan terminos de Spring, Java o runtime, conviene moverlos a notas de compatibilidad o a referencias del generador, pero no al lenguaje de diseno principal.

### Recomendacion final para Fase 1

La Fase 1 es coherente con el generador en la arquitectura general y en la mayoria del schema. Despues de los ajustes aplicados, los riesgos mas inmediatos bajaron: el validador esta sincronizado, la contradiccion de `auth-context` fue corregida, `uniqueness.field` ya esta alineado con el comportamiento real, y existe una suite minima de smoke tests.

Los pendientes mas valiosos ahora son:

1. Extraer `integration-validator.js` o las reglas `INT-*` a un modulo compartido para evitar drift futuro.
2. Convertir la regla command response body vs `useCases[].returns` en validacion ejecutable si `dsl validate` empieza a leer OpenAPI.
3. Agregar un test de contrato Fase 1 -> Fase 2 que termine en `compileJava`.

Con los ajustes ya aplicados, el disenador queda mas cerca de producir artefactos que el generador pueda consumir sin friccion, manteniendo intacta la separacion de responsabilidades de la vision.
