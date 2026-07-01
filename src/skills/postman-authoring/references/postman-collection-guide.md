# Guía de Colecciones Postman — Fase 3 (Paso G)

Lee este documento cuando ejecutes el **Paso G** de la skill: generar las colecciones Postman al
cerrar un bounded context. Define el formato exacto de los dos archivos que debes escribir bajo
`postman/` en la raíz del proyecto:

- `postman/auth-collection.json` — obtiene los tokens de acceso. **Compartido entre BCs; si ya
  existe, NO lo recrees.**
- `postman/{bc-name}-collection.json` — una request por cada escenario de `{bc-name}-flows.md`
  más los endpoints CRUD triviales. **Se regenera siempre.**

Ambos usan el formato **Postman Collection v2.1.0** y comparten tokens vía **globals de Postman**
(`pm.globals.set` en `auth-collection`, `{{token_<rol>}}` en `{bc-name}-collection`). No generes
archivos de environment: las globals bastan.

---

## Convenciones compartidas

- **`{{baseUrl}}`** — variable de colección, default `http://localhost:8080`. Úsala como prefijo de
  toda URL de negocio.
- **`token_<rol-kebab>`** — nombre de la global donde `auth-collection` guarda cada token. El rol
  se toma del `Given` del escenario y de `authorization.rolesAnyOf` en el YAML, en kebab-case sin
  el prefijo `ROLE_`. Ejemplos: `ROLE_ADMIN → token_admin`, `ROLE_CATALOG_MANAGER →
  token_catalog-manager`, `ROLE_CUSTOMER → token_customer`.
- Las requests de negocio referencian el token con el header
  `Authorization: Bearer {{token_<rol>}}`.

---

## Esqueleto Postman Collection v2.1.0

```json
{
  "info": {
    "name": "<nombre de la colección>",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [],
  "variable": [
    { "key": "baseUrl", "value": "http://localhost:8080" }
  ]
}
```

- `item` puede contener requests o **carpetas** (un objeto con `name` + su propio `item[]`).
- Cada request lleva opcionalmente `event[]` con un script `test` (assertions sobre la respuesta).

---

## `auth-collection.json`

### Regla de idempotencia

Antes de escribir, comprueba si `postman/auth-collection.json` ya existe. **Si existe, no lo toques**
(es compartido por todos los BCs del sistema y puede tener ajustes manuales). Solo repórtalo y
continúa con `{bc-name}-collection.json`.

### De dónde sacar realm / clientId / secret / usuarios

<!-- stack:auth=keycloak -->
- **Keycloak:** `keycloak/realm-export.json` y `docker-compose.yml` — realm, `clientId`, secret,
  y los usuarios sembrados con sus roles. Endpoint de token:
  `http://localhost:8180/realms/{realm}/protocol/openid-connect/token`.
<!-- /stack -->
<!-- stack:auth=cognito -->
- **AWS Cognito:** no hay contenedor local; usa un User Pool real. Del `application.yaml`
  (`spring.security.oauth2.resourceserver.jwt.issuer-uri`) sacas la región y el `userPoolId`. El
  `appClientId` (app client con `USER_PASSWORD_AUTH` habilitado, sin secret para pruebas), los
  usuarios y sus grupos (`cognito:groups` → roles) los defines en la consola de Cognito. El token
  se pide al endpoint `InitiateAuth`: `https://cognito-idp.{region}.amazonaws.com/`.
<!-- /stack -->
- **OAuth2 client-credentials:** `tokenEndpoint`, `clientId`/`clientSecret` desde los parámetros
  del proyecto (`parameters/{env}/oauth2.yaml`).

### Una request por rol/credencial

Crea una request por cada rol distinto que los flujos del BC necesiten. Cada una guarda su token en
una global.

<!-- stack:auth=keycloak -->
Plantilla (Keycloak password grant para un usuario con `ROLE_ADMIN`):

```json
{
  "name": "Token — admin",
  "request": {
    "method": "POST",
    "header": [
      { "key": "Content-Type", "value": "application/x-www-form-urlencoded" }
    ],
    "url": "http://localhost:8180/realms/{realm}/protocol/openid-connect/token",
    "body": {
      "mode": "urlencoded",
      "urlencoded": [
        { "key": "grant_type", "value": "password" },
        { "key": "client_id", "value": "{clientId}" },
        { "key": "client_secret", "value": "{clientSecret}" },
        { "key": "username", "value": "{adminUser}" },
        { "key": "password", "value": "{adminPassword}" }
      ]
    }
  },
  "event": [
    {
      "listen": "test",
      "script": {
        "type": "text/javascript",
        "exec": [
          "pm.test('token 200', () => pm.response.to.have.status(200));",
          "pm.globals.set('token_admin', pm.response.json().access_token);"
        ]
      }
    }
  ]
}
```

Variante **client-credentials** (sin usuario): `grant_type=client_credentials` y sin
`username`/`password`. Cuando un solo client emite todos los roles, igual genera una entrada por
rol apuntando al mismo token si el diseño no distingue credenciales.
<!-- /stack -->

<!-- stack:auth=cognito -->
Plantilla (Cognito `InitiateAuth` con `USER_PASSWORD_AUTH` para un usuario en el grupo `admin`).
El grupo del usuario viaja en el claim `cognito:groups` y mapea al rol. Guarda el **access token**
(`AuthenticationResult.AccessToken`), que es el que valida el resource server:

```json
{
  "name": "Token — admin",
  "request": {
    "method": "POST",
    "header": [
      { "key": "Content-Type", "value": "application/x-amz-json-1.1" },
      { "key": "X-Amz-Target", "value": "AWSCognitoIdentityProviderService.InitiateAuth" }
    ],
    "url": "https://cognito-idp.{region}.amazonaws.com/",
    "body": {
      "mode": "raw",
      "raw": "{\n  \"AuthFlow\": \"USER_PASSWORD_AUTH\",\n  \"ClientId\": \"{appClientId}\",\n  \"AuthParameters\": {\n    \"USERNAME\": \"{adminUser}\",\n    \"PASSWORD\": \"{adminPassword}\"\n  }\n}"
    }
  },
  "event": [
    {
      "listen": "test",
      "script": {
        "type": "text/javascript",
        "exec": [
          "pm.test('token 200', () => pm.response.to.have.status(200));",
          "pm.globals.set('token_admin', pm.response.json().AuthenticationResult.AccessToken);"
        ]
      }
    }
  ]
}
```

Notas Cognito: el app client debe tener habilitado el flujo `USER_PASSWORD_AUTH`. Si el app client
tiene *secret*, `InitiateAuth` exige además un `SECRET_HASH` en `AuthParameters` (usa un app client
sin secret para pruebas de Postman). Para flujos máquina-a-máquina usa un app client de tipo
*client-credentials* contra el dominio hospedado: `POST https://{userPoolDomain}/oauth2/token` con
`grant_type=client_credentials` (Cognito no soporta `password` grant en el endpoint `/oauth2/token`).
<!-- /stack -->

---

## `{bc-name}-collection.json`

Una carpeta por flujo y una request por escenario, más una carpeta para el CRUD trivial.

### Carpeta por flujo `FL-{BC}-{N}`, request por escenario

Mapeo desde `{bc-name}-flows.md`:

| Sección del escenario | Qué produce en la request |
|---|---|
| `Given` (rol) | header `Authorization: Bearer {{token_<rol>}}` |
| `Given` (estado previo) | nota en `description`; si requiere datos previos, ordena la request tras la que los crea |
| `When` | `method`, `url` (`{{baseUrl}}` + path del controller), `body` JSON |
| `Then` | script `test`: status esperado + forma de la respuesta |

Plantilla de un escenario **feliz** (`Escenario A — Creación exitosa`):

```json
{
  "name": "FL-CAT-001 · A — Creación exitosa (201)",
  "request": {
    "method": "POST",
    "header": [
      { "key": "Content-Type", "value": "application/json" },
      { "key": "Authorization", "value": "Bearer {{token_admin}}" }
    ],
    "url": "{{baseUrl}}/api/catalog/v1/categories",
    "body": { "mode": "raw", "raw": "{\n  \"name\": \"Lácteos\"\n}" }
  },
  "event": [
    {
      "listen": "test",
      "script": {
        "type": "text/javascript",
        "exec": [
          "pm.test('status 201', () => pm.response.to.have.status(201));"
        ]
      }
    }
  ]
}
```

Plantilla de un escenario **de error** (`Escenario B — Nombre duplicado`): mismo body, pero el
test asserta el status de error y la ausencia de side effect cuando aplique:

```json
{
  "name": "FL-CAT-001 · B — Nombre duplicado (409)",
  "request": { "method": "POST", "header": [ /* … */ ], "url": "{{baseUrl}}/api/catalog/v1/categories", "body": { "mode": "raw", "raw": "{ \"name\": \"Lácteos\" }" } },
  "event": [
    {
      "listen": "test",
      "script": {
        "type": "text/javascript",
        "exec": [ "pm.test('status 409', () => pm.response.to.have.status(409));" ]
      }
    }
  ]
}
```

Mapeo de status para escenarios de error comunes: nombre/recurso duplicado → `409`, recurso
inexistente → `404`, permiso insuficiente → `403`, validación de entrada → `400`. Usa el status que
declare el flujo o el `httpStatus` del error tipado en `{bc-name}.yaml`.

### Carpeta "CRUD" (endpoints triviales)

Incluye los UCs **sin** `implementation: scaffold` que existan en `{bc-name}-open-api.yaml`. Una
request por `operationId`:

- `method` y `path` desde el OpenAPI.
- `Authorization: Bearer {{token_<rol>}}` si el endpoint exige rol (mira `authorization` del UC).
- Body de ejemplo derivado del `requestBody` schema (campos requeridos con valores placeholder).
- Test mínimo: status 2xx esperado.

---

## Checklist antes de cerrar el Paso G

- [ ] `postman/auth-collection.json` existe (creado ahora **o** preexistente y no sobrescrito).
- [ ] Cada rol usado por los flujos tiene su global `token_<rol>` poblada por `auth-collection`.
- [ ] `postman/{bc-name}-collection.json` tiene una carpeta por `FL-{BC}-{N}` y una request por
      cada escenario (felices y de error).
- [ ] Carpeta "CRUD" con los endpoints triviales del OpenAPI.
- [ ] `{{baseUrl}}` declarada como variable de colección.
- [ ] Reportaste al usuario las rutas y el orden de importación (auth primero, luego el BC).
