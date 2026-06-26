# Infraestructura Local — Canasta Familiar

Este documento explica cómo levantar, usar y detener el cluster de servicios de desarrollo definido en `docker-compose.yaml`.

## Requisitos previos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado y en ejecución.
- Puerto libres: `5432`, `5672`, `8180`, `9000`, `9001`, `15672`.

---

## Levantar el cluster

```bash
docker compose up -d
```

La primera vez descarga las imágenes y ejecuta la inicialización de MinIO automáticamente. Las siguientes veces arranca en segundos.

Para ver los logs en tiempo real:

```bash
docker compose logs -f
```

---

## Servicios disponibles

### PostgreSQL

| Parámetro | Valor |
|-----------|-------|
| Host | `localhost:5432` |
| Base de datos | `canasta_familiar` |
| Usuario | `postgres` |
| Contraseña | `postgres` |

String de conexión JDBC:

```
jdbc:postgresql://localhost:5432/canasta_familiar
```

---

### RabbitMQ

| Parámetro | Valor |
|-----------|-------|
| AMQP | `localhost:5672` |
| Consola web | http://localhost:15672 |
| Usuario | `guest` |
| Contraseña | `guest` |

La consola web permite inspeccionar colas, exchanges y mensajes en tránsito.

---

### Keycloak

| Parámetro | Valor |
|-----------|-------|
| URL | http://localhost:8180 |
| Usuario admin | `admin` |
| Contraseña admin | `admin` |

El realm se importa automáticamente desde `keycloak/realm-export.json` al arrancar.
Para acceder a la consola de administración: http://localhost:8180/admin

---

### MinIO (almacenamiento de objetos)

| Parámetro | Valor |
|-----------|-------|
| API S3 | http://localhost:9000 |
| Consola web | http://localhost:9001 |
| Usuario | `minioadmin` (o variable `MINIO_ROOT_USER`) |
| Contraseña | `minioadmin` (o variable `MINIO_ROOT_PASSWORD`) |

El bucket `product-media` se crea automáticamente con acceso público de lectura.
Las imágenes de producto son accesibles sin autenticación en:

```
http://localhost:9000/product-media/<nombre-archivo>
```

Para usar credenciales personalizadas crea un archivo `.env` en la raíz:

```env
MINIO_ROOT_USER=tu_usuario
MINIO_ROOT_PASSWORD=tu_contraseña
```

---

## Detener el cluster

Detener sin borrar datos:

```bash
docker compose down
```

Detener y borrar todos los datos persistidos (volúmenes):

```bash
docker compose down -v
```

---

## Solución de problemas comunes

**MinIO no está listo y la app falla al arrancar**
El servicio `minio-createbuckets` reintenta la conexión cada 2 segundos hasta que MinIO responde. Si la app arranca antes de que termine, espera unos segundos y vuelve a intentarlo.

**Puerto ocupado**
Si algún puerto ya está en uso, detén el proceso que lo ocupa o cambia el mapeo en `docker-compose.yaml` (formato `"<local>:<contenedor>"`).

**Keycloak no importa el realm**
Verifica que el archivo `keycloak/realm-export.json` exista. Si lo modificaste, elimina el contenedor y vuelve a levantarlo para forzar la reimportación:

```bash
docker compose rm -sf keycloak && docker compose up -d keycloak
```
