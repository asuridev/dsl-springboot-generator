# Guía de acceso a CLI de infraestructura

Referencia de comandos para el agente de Fase 3. Todos los comandos son copy-paste directos.

---

## Contenedor devtools — punto de entrada unificado

El proyecto generado incluye un contenedor `{SYSTEM}-devtools` con todos los CLI tools pre-instalados.

**Detectar el runtime disponible (ejecutar una vez al inicio de sesión):**
```bash
if command -v podman &>/dev/null; then RUNTIME=podman; COMPOSE=podman-compose
elif command -v docker &>/dev/null; then RUNTIME=docker; COMPOSE="docker compose"
fi
```

**Patrón general:**
```bash
${RUNTIME} exec {SYSTEM}-devtools <tool> <args>
```

**Cómo obtener `{SYSTEM}` y `{DB}`:**
```bash
# Con jq (recomendado — jq está en el contenedor devtools, no necesariamente en el host)
SYSTEM=$(cat dsl-springboot.json | jq -r .systemName)
DB=${SYSTEM//-/_}

# Sin jq (Python alternativo)
SYSTEM=$(python3 -c "import sys,json; print(json.load(open('dsl-springboot.json'))['systemName'])")
DB=${SYSTEM//-/_}
```

---

## Cheatsheet por tecnología

### PostgreSQL

```bash
# Verificar conectividad
${RUNTIME} exec ${SYSTEM}-devtools psql -h postgres -U postgres -d ${DB} -c "SELECT 1" -q -t

# Listar esquemas
${RUNTIME} exec ${SYSTEM}-devtools psql -h postgres -U postgres -d ${DB} -c "\dn"

# Listar tablas de un bounded context (reemplaza {bc} por el nombre del BC)
${RUNTIME} exec ${SYSTEM}-devtools psql -h postgres -U postgres -d ${DB} -c "\dt {bc}.*"

# Contar registros
${RUNTIME} exec ${SYSTEM}-devtools psql -h postgres -U postgres -d ${DB} \
  -c "SELECT COUNT(*) FROM {bc}.{table}"

# Ver último registro insertado
${RUNTIME} exec ${SYSTEM}-devtools psql -h postgres -U postgres -d ${DB} \
  -c "SELECT * FROM {bc}.{table} ORDER BY created_at DESC LIMIT 1"

# Ver todas las columnas de una tabla
${RUNTIME} exec ${SYSTEM}-devtools psql -h postgres -U postgres -d ${DB} \
  -c "\d {bc}.{table}"
```

### MySQL

```bash
# Verificar conectividad
${RUNTIME} exec ${SYSTEM}-devtools mysql -h mysql -u postgres -ppostgres ${DB} -e "SELECT 1"

# Listar tablas
${RUNTIME} exec ${SYSTEM}-devtools mysql -h mysql -u postgres -ppostgres ${DB} -e "SHOW TABLES"

# Contar registros
${RUNTIME} exec ${SYSTEM}-devtools mysql -h mysql -u postgres -ppostgres ${DB} \
  -e "SELECT COUNT(*) FROM {table}"

# Ver último registro
${RUNTIME} exec ${SYSTEM}-devtools mysql -h mysql -u postgres -ppostgres ${DB} \
  -e "SELECT * FROM {table} ORDER BY created_at DESC LIMIT 1"
```

### Kafka

```bash
# Listar todos los topics y particiones
${RUNTIME} exec ${SYSTEM}-devtools kcat -b kafka:29092 -L

# Verificar que un topic existe
${RUNTIME} exec ${SYSTEM}-devtools kcat -b kafka:29092 -L | grep {topic-name}

# Leer último mensaje de un topic
${RUNTIME} exec ${SYSTEM}-devtools kcat -b kafka:29092 -t {topic} -o -1 -e

# Leer los últimos N mensajes de un topic
${RUNTIME} exec ${SYSTEM}-devtools kcat -b kafka:29092 -t {topic} -o -{N} -e

# Leer todos los mensajes desde el inicio
${RUNTIME} exec ${SYSTEM}-devtools kcat -b kafka:29092 -t {topic} -o beginning -e

# Ejemplo — verificar evento catalog.product.created
${RUNTIME} exec ${SYSTEM}-devtools kcat -b kafka:29092 -t catalog.product.created -o -1 -e | jq .
```

> Nota: `-e` hace que kcat salga cuando llega al final de los mensajes (no espera indefinidamente)

### RabbitMQ (vía Management HTTP API)

```bash
# Verificar que el servidor está sano
curl -sf -u guest:guest http://localhost:15672/api/healthchecks/node | jq .status

# Listar todos los exchanges
curl -sf -u guest:guest http://localhost:15672/api/exchanges | jq '[.[] | {name, type}]'

# Listar todas las queues con conteo de mensajes
curl -sf -u guest:guest http://localhost:15672/api/queues | jq '[.[] | {name, messages}]'

# Contar mensajes en una queue específica
curl -sf -u guest:guest "http://localhost:15672/api/queues/%2F/{queue-name}" | jq .messages

# Ver bindings de una queue
curl -sf -u guest:guest "http://localhost:15672/api/queues/%2F/{queue-name}/bindings" | jq .

# Verificar que una queue existe y tiene mensajes
curl -sf -u guest:guest "http://localhost:15672/api/queues/%2F/{queue-name}" \
  | jq '{name: .name, messages: .messages, consumers: .consumers}'
```

### Redis / Valkey (cache de idempotencia)

```bash
# Verificar conectividad
${RUNTIME} exec ${SYSTEM}-devtools redis-cli -h cache PING

# Ver todas las claves
${RUNTIME} exec ${SYSTEM}-devtools redis-cli -h cache KEYS "*"

# Ver claves de idempotencia
${RUNTIME} exec ${SYSTEM}-devtools redis-cli -h cache KEYS "idempotency:*"

# Verificar que una clave existe (por request-id)
${RUNTIME} exec ${SYSTEM}-devtools redis-cli -h cache EXISTS "idempotency:{request-id}"

# Leer el valor de una clave de idempotencia
${RUNTIME} exec ${SYSTEM}-devtools redis-cli -h cache GET "idempotency:{request-id}"

# Ver TTL de una clave
${RUNTIME} exec ${SYSTEM}-devtools redis-cli -h cache TTL "idempotency:{request-id}"
```

### Keycloak

```bash
# Verificar que el servidor está listo
curl -sf http://localhost:8180/health/ready | jq .status

# Obtener token con client_credentials (para probar endpoints protegidos)
curl -s -X POST \
  "http://localhost:8180/realms/{realm}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id={clientId}&client_secret={clientSecret}" \
  | jq -r .access_token

# Guardar el token en variable para usarlo en curl
TOKEN=$(curl -s -X POST \
  "http://localhost:8180/realms/{realm}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id={clientId}&client_secret={clientSecret}" \
  | jq -r .access_token)

# Probar un endpoint protegido con el token
curl -s http://localhost:8080/{path} \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

### MinIO / Object Storage (S3-compatible, vía cliente `mc`)

> El generador solo soporta **MinIO** como proveedor; el código de la app es agnóstico
> (AWS SDK v2 apuntando al endpoint S3-compatible). El bucket lógico (`store`) declarado en
> `system.yaml` → `infrastructure.objectStorage[]` se crea por el init container `minio-createbuckets`.
> Las credenciales por defecto del entorno local son `minioadmin` / `minioadmin`.

```bash
# Registrar el alias 'local' (ejecutar una vez por sesión dentro de devtools)
${RUNTIME} exec ${SYSTEM}-devtools \
  mc alias set local http://minio:9000 ${MINIO_ROOT_USER:-minioadmin} ${MINIO_ROOT_PASSWORD:-minioadmin}

# Verificar conectividad / listar buckets
${RUNTIME} exec ${SYSTEM}-devtools mc ls local

# Listar el contenido de un store (reemplaza {store} por el objectStorage[].name, p.ej. product-media)
${RUNTIME} exec ${SYSTEM}-devtools mc ls --recursive local/{store}

# Inspeccionar metadatos de un objeto subido (storageKey persistido en la BD)
${RUNTIME} exec ${SYSTEM}-devtools mc stat local/{store}/{storageKey}

# Verificar la política de acceso del bucket (los stores public-url quedan en 'download')
${RUNTIME} exec ${SYSTEM}-devtools mc anonymous get local/{store}

# Descargar un objeto al contenedor para inspección
${RUNTIME} exec ${SYSTEM}-devtools mc cp local/{store}/{storageKey} /tmp/obj.bin

# Verificar una URL pública (store public-url) — debe responder 200
curl -sI "http://localhost:9000/{store}/{storageKey}" | head -1
```

> Consola web de MinIO: `http://localhost:9001` (usuario/clave = `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`).
> Para stores `signed-url` la URL pública NO funciona: la app emite una presigned URL en el endpoint de lectura.

---

## Validación de la aplicación Spring Boot

```bash
# Compilar
./gradlew compileJava

# Health check (la app debe estar corriendo)
curl -sf http://localhost:8080/actuator/health | jq .status

# Reiniciar app
${COMPOSE} restart app

# Ver logs de la app (últimas 100 líneas)
${COMPOSE} logs --tail=100 app

# Seguir logs en tiempo real
${COMPOSE} logs -f app

# Script de validación completa de infraestructura
./validate-infra.sh
```

---

## Probar endpoints HTTP (plantillas)

```bash
# GET sin autenticación
curl -s http://localhost:8080/{path} | jq .

# GET con parámetros de query
curl -s "http://localhost:8080/{path}?page=0&size=10&status=ACTIVE" | jq .

# POST con JSON
curl -s -X POST http://localhost:8080/{path} \
  -H "Content-Type: application/json" \
  -d '{"field1": "value1", "field2": "value2"}' \
  | jq .

# POST y capturar el Location del recurso creado
curl -si -X POST http://localhost:8080/{path} \
  -H "Content-Type: application/json" \
  -d '{"field1": "value1"}' \
  | grep -i "^location:"

# PUT / PATCH
curl -s -X PUT http://localhost:8080/{path}/{id} \
  -H "Content-Type: application/json" \
  -d '{"field1": "new-value"}' \
  | jq .

# DELETE
curl -si -X DELETE http://localhost:8080/{path}/{id} | head -5

# Con autenticación Bearer
curl -s http://localhost:8080/{path} \
  -H "Authorization: Bearer ${TOKEN}" | jq .

# Verificar código de respuesta
curl -so /dev/null -w "%{http_code}" -X POST http://localhost:8080/{path} \
  -H "Content-Type: application/json" \
  -d '{"field": "value"}'
```

---

## Ver logs de servicios individuales

```bash
# App Spring Boot
${COMPOSE} logs --tail=100 app
${COMPOSE} logs -f app

# Base de datos
${COMPOSE} logs --tail=50 postgres
${COMPOSE} logs --tail=50 mysql

# Kafka
${COMPOSE} logs --tail=50 kafka
${COMPOSE} logs --tail=50 zookeeper

# RabbitMQ
${COMPOSE} logs --tail=50 rabbitmq

# Cache
${COMPOSE} logs --tail=50 cache

# Keycloak
${COMPOSE} logs --tail=50 keycloak

# MinIO (object storage) + init de buckets
${COMPOSE} logs --tail=50 minio
${COMPOSE} logs --tail=50 minio-createbuckets

# Todos los servicios a la vez
${COMPOSE} logs --tail=30
```
