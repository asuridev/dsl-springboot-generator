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
