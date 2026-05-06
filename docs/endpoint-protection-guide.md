# Guía de protección de endpoints — RBAC vs OAuth2 Scopes

## Conceptos previos

Antes de comparar estrategias, hay que separar dos conceptos que frecuentemente se confunden:

| Concepto | Pregunta que responde | Ejemplo |
|---|---|---|
| **Autenticación** | ¿Quién eres? | El token JWT identifica al usuario `john.doe` |
| **Autorización** | ¿Qué puedes hacer? | `john.doe` puede leer productos pero no eliminarlos |

Las dos estrategias que veremos son estrategias de **autorización**. La autenticación (validar el JWT) es la misma en ambas.

---

## Estrategia 1 — RBAC (Role-Based Access Control)

### ¿Qué es un rol?

Un **rol** es una etiqueta que representa una función dentro del sistema. Se asigna a usuarios en el servidor de identidad (Keycloak, Cognito, etc.) y viaja en el token JWT.

```
Usuario john.doe  → tiene rol CATALOG_MANAGER
Usuario jane.admin → tiene roles ADMIN, CATALOG_MANAGER
```

El token JWT de `john.doe` incluye en su payload:
```json
{
  "sub": "john.doe",
  "realm_access": {
    "roles": ["CATALOG_MANAGER"]
  }
}
```

### Cómo funciona en Spring Boot

Spring Security extrae los roles del token (vía `JwtAuthConverter`) y los convierte en `GrantedAuthority` con el prefijo `ROLE_`. Luego `@PreAuthorize` evalúa la expresión antes de ejecutar el método del controlador.

```
Request HTTP
    │
    ▼
BearerTokenAuthenticationFilter   ← valida la firma del JWT
    │
    ▼
JwtAuthConverter                   ← extrae "realm_access.roles" → ["CATALOG_MANAGER"]
    │                                 añade prefijo → [ROLE_CATALOG_MANAGER]
    ▼
SecurityContext                    ← guarda la autenticación en el hilo actual
    │
    ▼
@PreAuthorize("hasAnyRole(...)")   ← evalúa contra SecurityContext
    │
    ▼
Método del controlador             ← se ejecuta solo si la expresión es true
```

### Ejemplo completo

**Diseño en YAML:**
```yaml
useCases:
  - id: UC-PRD-001
    name: CreateProduct
    type: command
    authorization:
      rolesAnyOf:
        - ROLE_ADMIN
        - ROLE_CATALOG_MANAGER

  - id: UC-PRD-002
    name: DeleteProduct
    type: command
    authorization:
      rolesAnyOf:
        - ROLE_ADMIN              # solo admin puede eliminar

  - id: UC-PRD-010
    name: GetProductById
    type: query
    authorization:
      rolesAnyOf:
        - ROLE_ADMIN
        - ROLE_CATALOG_MANAGER
        - ROLE_CUSTOMER           # cualquier usuario autenticado puede leer
```

**Código generado en el controlador:**
```java
@RestController
@RequestMapping("/api/v1/products")
public class ProductV1Controller {

    @PostMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'CATALOG_MANAGER')")
    public ResponseEntity<Void> createProduct(@RequestBody CreateProductRequest request) {
        // ...
    }

    @DeleteMapping("/{productId}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> deleteProduct(@PathVariable UUID productId) {
        // ...
    }

    @GetMapping("/{productId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'CATALOG_MANAGER', 'CUSTOMER')")
    public ResponseEntity<ProductDetailResponse> getProductById(@PathVariable UUID productId) {
        // ...
    }
}
```

**Configuración en Keycloak — paso a paso:**

**Paso 1 — Crear los Realm Roles**

1. Abre la consola de Keycloak (`http://localhost:8180`) y selecciona tu realm (ej. `my-realm`)
2. Navega a **Realm roles** → **Create role**
3. Crea un rol por cada función de negocio:
   - `ADMIN`
   - `CATALOG_MANAGER`
   - `CUSTOMER`

**Paso 2 — Asignar roles a usuarios**

1. Navega a **Users** → selecciona el usuario de prueba
2. Pestaña **Role mapping** → **Assign role**
3. Filtra por **"Filter by realm roles"** y asigna el rol correspondiente

**Paso 3 — Verificar el token**

Solicita un token para ese usuario y decodifícalo en [jwt.io](https://jwt.io). Deberías ver:
```json
{
  "realm_access": {
    "roles": ["CATALOG_MANAGER", "default-roles-my-realm"]
  }
}
```

> No se requiere ninguna configuración adicional en el cliente ni mappers especiales.
> El generador ya configura Spring para leer `realm_access.roles` y añadir el prefijo
> `ROLE_` automáticamente vía `JwtAuthConverter`.

### Cuándo usar RBAC

✅ Sistemas internos con usuarios humanos  
✅ Equipos pequeños/medianos con roles bien definidos  
✅ Cuando los permisos se agrupan naturalmente por función (admin, operador, cliente)  
✅ Primera implementación de seguridad  

### El problema de RBAC cuando escala

Imagina que el sistema crece:

```
ROLE_ADMIN
ROLE_SUPER_ADMIN
ROLE_READ_ONLY_ADMIN
ROLE_CATALOG_MANAGER
ROLE_CATALOG_VIEWER
ROLE_CUSTOMER
ROLE_PREMIUM_CUSTOMER
ROLE_GUEST
```

Ahora `@PreAuthorize` se vuelve:
```java
@PreAuthorize("hasAnyRole('ADMIN', 'SUPER_ADMIN', 'CATALOG_MANAGER', 'PREMIUM_CUSTOMER')")
```

Y si mañana añades `ROLE_REGIONAL_MANAGER`, tienes que modificar código en múltiples controladores. A esto se le llama **role explosion**.

La solución es RBAC con **permisos granulares** (variante más madura).

### RBAC con permisos granulares

La idea central es introducir un nivel intermedio entre el rol y el código:

```
USUARIO  →  tiene  →  ROLES  →  contienen  →  PERMISOS  →  protegen  →  ENDPOINTS
```

Los **permisos** son atómicos e inmutables: describen una operación concreta sobre un recurso. Los **roles** son agrupaciones de permisos que pueden cambiar sin tocar código.

#### Definición de permisos

La convención más extendida es `recurso:accion`:

```
products:read
products:create
products:update
products:delete
orders:read
orders:create
orders:cancel
```

#### Asignación de permisos a roles (en Keycloak)

```
ROLE_ADMIN
  └── products:read, products:create, products:update, products:delete
  └── orders:read, orders:create, orders:cancel

ROLE_CATALOG_MANAGER
  └── products:read, products:create, products:update
  └── (NO tiene products:delete, NO tiene acceso a orders)

ROLE_CUSTOMER
  └── products:read
  └── orders:read, orders:create, orders:cancel  (solo sus propias órdenes)

ROLE_REGIONAL_MANAGER          ← nuevo rol, zero cambios en código
  └── products:read
  └── orders:read
```

En Keycloak esto se implementa con **Client Scopes** o **Composite Roles**: un rol puede incluir a otros roles o a permisos declarados como roles especiales.

#### El token JWT resultante

Con la configuración correcta (Client Roles + Protocol Mapper, explicada más abajo),
el token de un `CATALOG_MANAGER` contiene **dos claims separados**:
```json
{
  "sub": "john.doe",
  "realm_access": {
    "roles": ["CATALOG_MANAGER"]
  },
  "permissions": ["products:read", "products:create", "products:update"]
}
```

- `realm_access.roles` lleva el rol de función → `extractRoles()` → `ROLE_CATALOG_MANAGER`
- `permissions` lleva los permisos atómicos → `extractPermissions()` → `products:read`, `products:create`, `products:update`

> **Por qué claims separados y no todo en `realm_access.roles`:**
> El `JwtAuthConverter` generado añade el prefijo `ROLE_` a todo lo que extrae de
> `realm_access.roles`. Si los permisos viajaran ahí, se convertirían en
> `ROLE_products:create`, y `hasAnyAuthority('products:create')` nunca coincidiría.
> El claim `permissions` se extrae sin prefijo, resolviendo el problema.

#### Código en el controlador

En lugar de verificar el rol, se verifica el permiso:

```java
// ❌ RBAC simple — frágil, hay que actualizar cuando cambian los roles
@PreAuthorize("hasAnyRole('ADMIN', 'SUPER_ADMIN', 'CATALOG_MANAGER', 'REGIONAL_MANAGER')")
public ResponseEntity<Void> createProduct(...) { ... }

// ✅ RBAC con permisos granulares — estable, nunca cambia
@PreAuthorize("hasAuthority('products:create')")
public ResponseEntity<Void> createProduct(...) { ... }
```

Si mañana se crea `ROLE_REGIONAL_MANAGER` y necesita crear productos, solo se le asigna el permiso `products:create` en Keycloak. El código Java no se toca.

#### Implementación en Spring Boot

Spring Security trata los permisos granulares como `GrantedAuthority` (sin prefijo `ROLE_`), por eso se usa `hasAuthority` en lugar de `hasRole`:

```
hasRole('ADMIN')          → busca GrantedAuthority "ROLE_ADMIN"  (añade prefijo automáticamente)
hasAuthority('ADMIN')     → busca GrantedAuthority "ADMIN"       (literal, sin prefijo)
```

Para que Spring extraiga tanto roles como permisos del token, el `JwtAuthConverter` generado
implementa tres métodos de extracción independientes:

```
extractRoles()       → lee realm_access.roles    → GrantedAuthority("ROLE_" + rol)
extractScopes()      → lee claim "scope"          → GrantedAuthority("SCOPE_" + scope)
extractPermissions() → lee claim "permissions"    → GrantedAuthority(permiso)  ← sin prefijo
```

Por eso `hasAnyAuthority('products:create')` funciona: el permiso viaja en el claim
`permissions` y se almacena como authority exacta, sin prefijo.

#### Ejemplo completo con tres roles y permisos granulares

**Keycloak — configuración de roles compuestos:**
```
ROLE_ADMIN (composite)
  ├── products:create
  ├── products:read
  ├── products:update
  └── products:delete

ROLE_CATALOG_MANAGER (composite)
  ├── products:create
  ├── products:read
  └── products:update

ROLE_CUSTOMER (composite)
  └── products:read
```

**Controlador:**
```java
@PostMapping
@PreAuthorize("hasAuthority('products:create')")
public ResponseEntity<Void> createProduct(...) { ... }

@PutMapping("/{id}")
@PreAuthorize("hasAuthority('products:update')")
public ResponseEntity<Void> updateProduct(...) { ... }

@DeleteMapping("/{id}")
@PreAuthorize("hasAuthority('products:delete')")
public ResponseEntity<Void> deleteProduct(...) { ... }

@GetMapping("/{id}")
@PreAuthorize("hasAuthority('products:read')")
public ResponseEntity<ProductDetailResponse> getProductById(...) { ... }
```

**Resultado:** un `CATALOG_MANAGER` puede crear y leer pero no eliminar. Si se crea un nuevo rol `SUPERVISOR` que necesita solo leer y eliminar, se configura en Keycloak y el código no cambia.

#### Comparación directa

| | RBAC simple | RBAC con permisos granulares |
|---|---|---|
| `@PreAuthorize` verifica | Rol | Permiso |
| Añadir nuevo rol | Hay que modificar código | Solo configurar en Keycloak |
| Legibilidad del código | Rol de negocio visible | Operación visible |
| Complejidad inicial | Baja | Media |
| Escalabilidad | Baja (role explosion) | Alta |
| Estándar industria | Común en proyectos pequeños | Estándar en sistemas enterprise |

#### Cuándo adoptar esta variante

Empieza con RBAC simple. Migra a permisos granulares cuando:
- Tienes más de 5 roles distintos
- Los mismos endpoints empiezan a aparecer en listas de `hasAnyRole` largas
- Añadir un rol requiere búsqueda y reemplazo en el código
- El equipo de seguridad necesita controlar permisos sin involucrar a desarrollo

#### Configuración en Keycloak — paso a paso

Esta configuración requiere tres pasos: crear los permisos atómicos como Client Roles,
agruparlos en Realm Roles compuestos, y añadir un Protocol Mapper que inyecte los
Client Roles del usuario en el claim `permissions` del JWT.

**Paso 1 — Crear los Client Roles (permisos atómicos)**

Los permisos atómicos se crean como roles del cliente, no del realm. Esto evita
contaminar el namespace de roles globales con nombres de operaciones.

1. Navega a **Clients** → selecciona tu cliente (ej. `catalog-service`)
2. Pestaña **Roles** → **Create role**
3. Crea un rol por cada permiso atómico:
   - `products:read`
   - `products:create`
   - `products:update`
   - `products:delete`

**Paso 2 — Crear los Realm Roles compuestos (funciones de negocio)**

Los roles de función son Realm Roles que agrupan Client Roles como "Associated roles":

1. Navega a **Realm roles** → **Create role**
2. Crea `CATALOG_MANAGER`:
   - Activa **Composite role**: ON
   - Pestaña **Associated roles** → **Add associated roles**
   - Filtra por **"Filter by clients"** → selecciona tu cliente
   - Marca: `products:read`, `products:create`, `products:update` → **Assign**
3. Crea `ADMIN`:
   - Composite role: ON
   - Associated roles (mismo cliente): `products:read`, `products:create`, `products:update`, `products:delete`
4. Crea `CUSTOMER`:
   - Composite role: ON
   - Associated roles: `products:read`

> El usuario recibe el Realm Role (`CATALOG_MANAGER`). Keycloak expande automáticamente
> los Client Roles asociados cuando se solicita el token.

**Paso 3 — Crear el Protocol Mapper**

El mapper toma los Client Roles del usuario para este cliente y los inyecta en
el claim `permissions` del access token:

1. Navega a **Clients** → tu cliente → pestaña **Client scopes**
2. Haz clic en el scope **`{tu-cliente}-dedicated`** (el scope privado del cliente)
3. Pestaña **Mappers** → **Add mapper** → **By configuration**
4. Selecciona **"User Client Role"**
5. Configura los campos:

   | Campo | Valor |
   |---|---|
   | Name | `permissions-mapper` |
   | Client ID | tu cliente (ej. `catalog-service`) |
   | Token Claim Name | `permissions` |
   | Claim JSON Type | `String` |
   | Multivalued | **ON** |
   | Add to access token | **ON** |
   | Add to userinfo | opcional |

6. Click **Save**

**Paso 4 — Asignar el rol de función al usuario**

1. **Users** → selecciona el usuario → **Role mapping** → **Assign role**
2. Filtra por **"Filter by realm roles"**
3. Asigna `CATALOG_MANAGER` (nunca los Client Roles directamente — el composite los expande)

**Paso 5 — Verificar el token**

Decodifica el access token del usuario en [jwt.io](https://jwt.io). Deberías ver:
```json
{
  "realm_access": {
    "roles": ["CATALOG_MANAGER"]
  },
  "permissions": ["products:read", "products:create", "products:update"]
}
```

Si `permissions` no aparece, verifica que:
- El Protocol Mapper esté en el scope **`{cliente}-dedicated`**, no en otro scope
- **Multivalued** esté activado
- El usuario tenga asignado el Realm Role (no los Client Roles directamente)
- El campo **Client ID** del mapper coincida exactamente con el nombre del cliente

---

## Estrategia 2 — OAuth2 Scopes

### ¿Qué es un scope?

Un **scope** (alcance) no describe quién eres sino qué **operaciones** autoriza un token concreto. Se define cuando el cliente (una app, un microservicio) solicita el token.

```
App móvil solicita token con scope → products:read
Microservicio de inventario solicita token con scope → products:write
```

El token JWT incluye:
```json
{
  "sub": "inventory-service",
  "scope": "products:read products:write"
}
```

### La diferencia clave con roles

| | RBAC (roles) | OAuth2 Scopes |
|---|---|---|
| Responde a | ¿Qué puede hacer este **usuario**? | ¿Qué puede hacer este **token/cliente**? |
| Lo asigna | El administrador del IdP al usuario | El cliente al solicitar el token |
| Granularidad | Por función de negocio | Por operación sobre recurso |
| Estándar | Propietario (cada IdP lo hace diferente) | RFC 6749 — estándar OAuth2 |

### Cómo funcionan los scopes en Spring Boot

Spring Security mapea los scopes a `GrantedAuthority` con el prefijo `SCOPE_`:

```
Token con scope "products:write"
    │
    ▼
JwtGrantedAuthoritiesConverter     ← extrae "scope" claim
    │                                 añade prefijo → [SCOPE_products:write]
    ▼
@PreAuthorize("hasAuthority('SCOPE_products:write')")
```

### Ejemplo completo

**Diseño del scope:**
```
products:read   → leer productos
products:write  → crear y modificar productos
products:delete → eliminar productos
```

**Código en el controlador:**
```java
@RestController
@RequestMapping("/api/v1/products")
public class ProductV1Controller {

    @PostMapping
    @PreAuthorize("hasAuthority('SCOPE_products:write')")
    public ResponseEntity<Void> createProduct(@RequestBody CreateProductRequest request) {
        // ...
    }

    @DeleteMapping("/{productId}")
    @PreAuthorize("hasAuthority('SCOPE_products:delete')")
    public ResponseEntity<Void> deleteProduct(@PathVariable UUID productId) {
        // ...
    }

    @GetMapping("/{productId}")
    @PreAuthorize("hasAuthority('SCOPE_products:read')")
    public ResponseEntity<ProductDetailResponse> getProductById(@PathVariable UUID productId) {
        // ...
    }
}
```

**Solicitud de token con scope (Client Credentials — M2M):**
```http
POST /realms/my-realm/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=inventory-service
&client_secret=secret
&scope=products:read products:write
```

El token resultante solo tiene alcance sobre lectura y escritura, no eliminación.

**Configuración en Keycloak — paso a paso:**

Los OAuth2 Scopes se configuran como **Client Scopes** en Keycloak, que son entidades
de primer nivel separadas de los roles.

**Paso 1 — Crear los Client Scopes**

1. Navega a **Client scopes** → **Create client scope**
2. Crea un scope por operación:

   | Name | Type | Include in token scope |
   |---|---|---|
   | `products:read` | `Optional` | ON |
   | `products:write` | `Optional` | ON |
   | `products:delete` | `Optional` | ON |

   > El campo **Type** en `Optional` significa que el scope no se incluye en el
   > token a menos que el cliente lo solicite explícitamente. `Default` lo incluiría
   > siempre, lo que elimina el control granular.

3. No es necesario añadir mappers — Keycloak incluye los Client Scopes concedidos
   en el claim `scope` del token automáticamente como una cadena espacio-separada.

**Paso 2 — Añadir los Client Scopes al cliente**

1. **Clients** → tu cliente → pestaña **Client scopes**
2. Click **Add client scope**
3. Agrega cada scope y selecciona **Optional** (no Default):
   - `products:read` → Optional
   - `products:write` → Optional
   - `products:delete` → Optional

**Paso 3 — Solicitar el token con los scopes necesarios**

Para flujo M2M (Client Credentials):
```bash
curl -s -X POST http://localhost:8180/realms/my-realm/protocol/openid-connect/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=client_credentials' \
  -d 'client_id=inventory-service' \
  -d 'client_secret=<secret>' \
  -d 'scope=products:read products:write'
```

Para flujo de usuario (Authorization Code con PKCE), el parámetro `scope` se incluye
en la URL de autorización inicial:
```
GET /realms/my-realm/protocol/openid-connect/auth
  ?client_id=catalog-ui
  &redirect_uri=https://app.example.com/callback
  &response_type=code
  &code_challenge=<challenge>
  &code_challenge_method=S256
  &scope=openid products:read products:write
```

**Paso 4 — Verificar el token**

Decodifica el access token. El claim `scope` es una cadena espacio-separada:
```json
{
  "sub": "inventory-service",
  "scope": "products:read products:write"
}
```

El `JwtAuthConverter` generado (método `extractScopes()`) lo divide por espacios y
produce:
- `GrantedAuthority("SCOPE_products:read")`
- `GrantedAuthority("SCOPE_products:write")`

Que coinciden exactamente con `hasAnyAuthority('SCOPE_products:write')` en `@PreAuthorize`.

> Si el cliente solicita un scope que no está en la lista **Optional** del cliente
> en Keycloak, Keycloak lo ignora silenciosamente (no devuelve error — simplemente
> no incluye ese scope en el token).

### Cuándo usar OAuth2 Scopes

✅ APIs públicas o semi-públicas consumidas por terceros  
✅ Comunicación machine-to-machine (microservicio → microservicio)  
✅ Cuando el consumidor del API no es un humano sino una aplicación  
✅ Cuando necesitas limitar qué puede hacer un token específico (no solo quién lo tiene)  
✅ Ecosistemas multi-tenant con clientes externos  

### Escenario ilustrativo

Una empresa tiene:
- App móvil de clientes → solo necesita `products:read`
- Dashboard de administradores → necesita `products:read`, `products:write`
- Microservicio de sincronización → necesita `products:read`, `products:write`, `products:delete`

Con scopes, cada cliente solicita solo los permisos que necesita. Si el token del microservicio de sincronización es comprometido, el atacante no puede hacer más de lo que ese scope permite.

Con roles, cualquier usuario con `ROLE_ADMIN` tendría acceso completo desde cualquier cliente.

---

## Estrategia 3 — Ownership (verificación por recurso)

### ¿Qué problema resuelve?

Las estrategias anteriores responden a la pregunta ¿tiene este usuario/token permiso para
ejecutar esta operación en general? El ownership responde a una pregunta más estricta:
¿tiene este usuario permiso para ejecutar esta operación **sobre este recurso concreto**?

Ejemplos donde roles y scopes no son suficientes:
- Un cliente puede cancelar pedidos, pero **solo los suyos**, no los de otros clientes
- Un usuario puede editar perfiles, pero **solo su propio perfil**
- Un driver puede actualizar el estado de una entrega, pero **solo las que le están asignadas**

### Cómo funciona

A diferencia de `rolesAnyOf`, `permissionsAnyOf` y `scopesAnyOf` —que generan una
anotación `@PreAuthorize` en el **controller**—, `ownership` genera una guarda
imperativa en el **handler**, ejecutada **después** de cargar el agregado.

```
Request HTTP
    │
    ▼
@PreAuthorize (si se declaró rolesAnyOf / permissionsAnyOf / scopesAnyOf)
    │
    ▼
Handler.handle(command)
    │
    ▼
aggregado = repository.findById(...).orElseThrow()
    │
    ▼
[G3] Ownership guard                    ← se ejecuta aquí
    │   compara: agregado.field() == JWT.claim
    │   si no coincide y no tiene bypass role → throw ForbiddenException
    ▼
lógica de negocio / persistencia
```

### Declaración en YAML

```yaml
useCases:
  - id: UC-ORD-003
    name: CancelOrder
    type: command
    aggregate: Order
    method: cancel
    input:
      - name: orderId
        type: Uuid
        source: path
        required: true
        loadAggregate: true     # obligatorio — el guard compara contra el agregado cargado
    notFoundError: ORDER_NOT_FOUND
    authorization:
      rolesAnyOf:               # opcional: restricción previa por rol
        - ROLE_CUSTOMER
        - ROLE_ADMIN
      ownership:
        field: customerId       # propiedad del agregado Order (getter: order.customerId())
        claim: userId           # nombre del claim en el JWT del usuario autenticado
        allowRoleBypass:        # opcional: roles que omiten la verificación de ownership
          - ROLE_ADMIN
          - ROLE_SUPPORT
    implementation: scaffold
```

### Propiedades de `ownership`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `field` | camelCase | ✅ | Nombre de la **propiedad** del agregado cuyo valor se compara con el claim. El generador construye el getter automáticamente: `field: customerId` → `aggregate.getCustomerId()`. |
| `claim` | string | ✅ | Nombre del claim JWT que identifica al usuario actual. Valor típico: `userId`, `sub`, `preferred_username`. |
| `allowRoleBypass` | lista strings | no | Roles que pueden saltarse la verificación. Acepta con o sin prefijo `ROLE_` — el generador elimina el prefijo al generar `hasAnyRole(...)`. |

> **Restricción:** `ownership` requiere que el agregado esté cargado antes de ejecutar
> la guarda. Esto ocurre automáticamente cuando el use case declara `loadAggregate: true`
> en uno de sus inputs, o cuando usa `lookups[]`. Sin carga previa del agregado, el
> generador no puede producir la comparación.

### Código Java generado

**Sin `allowRoleBypass`:**
```yaml
authorization:
  ownership:
    field: customerId
    claim: userId
```
```java
// [G3] Ownership guard — derived_from: useCases[UC-ORD-003].authorization
if (!Objects.equals(String.valueOf(order.getCustomerId()), SecurityContextUtil.currentUserClaim("userId"))) {
    throw new ForbiddenException();
}
```

**Con `allowRoleBypass: [ROLE_ADMIN, ROLE_SUPPORT]`:**
```yaml
authorization:
  ownership:
    field: customerId
    claim: userId
    allowRoleBypass:
      - ROLE_ADMIN
      - ROLE_SUPPORT
```
```java
// [G3] Ownership guard — derived_from: useCases[UC-ORD-003].authorization
if (!Objects.equals(String.valueOf(order.getCustomerId()), SecurityContextUtil.currentUserClaim("userId"))
        && !SecurityContextUtil.hasAnyRole("ADMIN", "SUPPORT")) {
    throw new ForbiddenException();
}
```

La condición se lee: “lanza `ForbiddenException` si el usuario actual **no** es el
dueño del recurso **Y** tampoco tiene uno de los roles de bypass”.

### `SecurityContextUtil` — la clase que usa la guarda

El generador produce siempre (en todos los proyectos con `authServer: true`) la clase
`shared/infrastructure/security/SecurityContextUtil.java`. Es el helper estático que
la guarda de ownership invoca:

```java
// Lee un claim del JWT del usuario autenticado (devuelve null si no existe)
public static String currentUserClaim(String claim) {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth == null || !auth.isAuthenticated()) return null;
    Object principal = auth.getPrincipal();
    if (principal instanceof Jwt jwt) {
        Object value = jwt.getClaim(claim);
        return value == null ? null : String.valueOf(value);
    }
    return null;
}

// Verifica si el usuario tiene alguno de los roles indicados (sin prefijo ROLE_)
public static boolean hasAnyRole(String... roles) {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth == null || !auth.isAuthenticated()) return false;
    for (GrantedAuthority granted : auth.getAuthorities()) {
        String authority = granted.getAuthority();
        for (String role : roles) {
            String expected = role.startsWith("ROLE_") ? role : "ROLE_" + role;
            if (expected.equals(authority)) return true;
        }
    }
    return false;
}
```

### Ejemplo completo: handler generado para `CancelOrder`

YAML del use case:
```yaml
- id: UC-ORD-003
  name: CancelOrder
  type: command
  aggregate: Order
  method: cancel
  input:
    - name: orderId
      type: Uuid
      source: path
      required: true
      loadAggregate: true
  notFoundError: ORDER_NOT_FOUND
  authorization:
    rolesAnyOf:
      - ROLE_CUSTOMER
      - ROLE_ADMIN
    ownership:
      field: customerId
      claim: userId
      allowRoleBypass:
        - ROLE_ADMIN
  implementation: scaffold
```

Código Java generado — `CancelOrderCommandHandler.java`:
```java
@ApplicationComponent
public class CancelOrderCommandHandler implements CommandHandler<CancelOrderCommand> {

    private final OrderRepository orderRepository;

    @Override
    @Transactional
    @LogExceptions
    public void handle(CancelOrderCommand command) {
        Order order = orderRepository.findById(UUID.fromString(command.orderId()))
                .orElseThrow(OrderNotFoundError::new);

        // [G3] Ownership guard — derived_from: useCases[UC-ORD-003].authorization
        if (!Objects.equals(String.valueOf(order.getCustomerId()), SecurityContextUtil.currentUserClaim("userId"))
                && !SecurityContextUtil.hasAnyRole("ADMIN")) {
            throw new ForbiddenException();
        }

        // TODO: implement business logic — ver orders-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
```

Código Java generado — `CancelOrderController` (fragmento):
```java
@DeleteMapping("/orders/{orderId}")
@PreAuthorize("hasAnyRole('CUSTOMER', 'ADMIN')")
public void cancelOrder(@PathVariable String orderId) {
    log.info("cancelOrder");
    useCaseMediator.dispatch(new CancelOrderCommand(orderId));
}
```

Flujo completo para un cliente intentando cancelar el pedido de otro:
1. `@PreAuthorize("hasAnyRole('CUSTOMER', 'ADMIN')")` — pasa (tiene `ROLE_CUSTOMER`)
2. Handler carga `Order` con `orderId` — encuentra el pedido
3. Ownership guard: `order.getCustomerId()` es `"uuid-de-otro-usuario"`, `currentUserClaim("userId")` es `"uuid-del-cliente"` — no coinciden
4. El cliente no tiene `ROLE_ADMIN` (bypass) — lanza `ForbiddenException` → **HTTP 403**

Flujo para un administrador cancelando el mismo pedido:
1. `@PreAuthorize` — pasa (tiene `ROLE_ADMIN`)
2. Handler carga `Order`
3. Ownership guard: `getCustomerId()` no coincide, pero `SecurityContextUtil.hasAnyRole("ADMIN")` es `true` — **pasa la guarda**
4. Se ejecuta la lógica de negocio

### Configuración en Keycloak para `ownership`

No se requiere ninguna configuración especial en Keycloak más allá de lo que ya se
configura para la estrategia de roles. El claim que `ownership.claim` referencia
(ej. `userId`) debe estar presente en el access token.

Keycloak incluye por defecto el claim `sub` (UUID del usuario) en todos los tokens.
Si el sistema usa un claim personalizado como `userId`, hay que añadir un Protocol
Mapper:

1. **Clients** → tu cliente → **Client scopes** → `{cliente}-dedicated`
2. **Mappers** → **Add mapper** → **By configuration** → **User Attribute**
3. Configura:

   | Campo | Valor |
   |---|---|
   | Name | `userId-mapper` |
   | User Attribute | `userId` |
   | Token Claim Name | `userId` |
   | Claim JSON Type | `String` |
   | Add to access token | ON |

4. En el usuario: **Users** → usuario → pestaña **Attributes** → añadir `userId` = `<valor>`

> Si usas `claim: sub`, el UUID generado por Keycloak para el usuario ya está
> disponible sin ningún mapper adicional. Es la opción más sencilla cuando el
> dominio no necesita un ID propio separado del ID de Keycloak.

### Cuándo usar `ownership`

✅ Portales de clientes donde cada usuario gestiona solo sus propios recursos  
✅ Aplicaciones multi-usuario donde los recursos tienen propietario (pedidos, perfiles, documentos)  
✅ Cuando `rolesAnyOf` no es suficiente porque el mismo rol puede ver los recursos de todos  
❌ No aplica en APIs puramente internas M2M (sin concepto de usuario propietario)  
❌ No aplica cuando todos los recursos son globales (catálogo, configuración del sistema)  

---

## Combinación — La práctica real en sistemas complejos

En la industria, las dos estrategias se usan juntas en capas:

```
Capa 1 (Gateway / Resource Server):   Scope válido → el token tiene permiso para esta API
Capa 2 (Controlador):                  Rol correcto → el usuario tiene la función requerida
Capa 3 (Servicio/Dominio):             Lógica de negocio → el usuario es dueño del recurso
```

```java
// Capa 1: el gateway ya verificó que el scope "products:write" está presente
// Capa 2: verificación de rol en el controlador
@PostMapping
@PreAuthorize("hasAuthority('SCOPE_products:write') and hasAnyRole('ADMIN', 'CATALOG_MANAGER')")
public ResponseEntity<Void> createProduct(...) { ... }
```

Esto significa:
- El **token** tiene autorización para operar sobre productos (scope)
- El **usuario** tiene la función de gestor de catálogo (rol)

---

## Resumen de decisión

```
¿Quién consume tu API?
    │
    ├── Usuarios humanos internos
    │       └── RBAC con roles  ✓
    │
    ├── Aplicaciones de terceros / clientes externos
    │       └── OAuth2 Scopes  ✓
    │
    └── Ambos
            └── Scopes en el token + Roles en la capa de negocio  ✓
```

## Soporte en el generador

El generador soporta las tres estrategias mediante el bloque `authorization` del YAML.
Pueden combinarse: cuando se declaran varios campos, se unen con `and` en la expresión
SpEL. El orden en la expresión generada es siempre `scopesAnyOf` → `rolesAnyOf` → `permissionsAnyOf`.

### RBAC simple (`rolesAnyOf`)

```yaml
authorization:
  rolesAnyOf:
    - ROLE_ADMIN
    - ROLE_CATALOG_MANAGER
```

Genera:
```java
@PreAuthorize("hasAnyRole('ADMIN', 'CATALOG_MANAGER')")
```

Requisito Keycloak: Realm Roles `ADMIN` y `CATALOG_MANAGER` asignados al usuario.

### RBAC con permisos granulares (`permissionsAnyOf`)

```yaml
authorization:
  permissionsAnyOf:
    - products:create
    - products:write
```

Genera:
```java
@PreAuthorize("hasAnyAuthority('products:create', 'products:write')")
```

Requisito Keycloak: Client Roles con esos nombres + Protocol Mapper `permissions` + Realm Roles compuestos que los agrupan. Ver [Configuración en Keycloak — RBAC granular](#configuración-en-keycloak--paso-a-paso-1).

### OAuth2 Scopes (`scopesAnyOf`)

```yaml
authorization:
  scopesAnyOf:
    - products:write      # escribir el nombre limpio; el generador añade SCOPE_ automáticamente
```

Genera:
```java
@PreAuthorize("hasAnyAuthority('SCOPE_products:write')")
```

Requisito Keycloak: Client Scopes `products:write` configurados como Optional en el cliente.

### Combinación de las tres estrategias

```yaml
authorization:
  scopesAnyOf:
    - catalog:admin
  rolesAnyOf:
    - ROLE_ADMIN
  permissionsAnyOf:
    - catalog:archive
```

Genera (Prettier puede formatear en varias líneas si la expresión supera ~80 chars):
```java
@PreAuthorize(
    "hasAnyAuthority('SCOPE_catalog:admin') and hasAnyRole('ADMIN') and hasAnyAuthority('catalog:archive')"
)
```

Significa: el token debe tener el scope `catalog:admin` **Y** el usuario debe tener
el rol `ADMIN` **Y** el usuario debe tener el permiso `catalog:archive`.

### Ownership (`ownership`)

```yaml
authorization:
  rolesAnyOf:
    - ROLE_CUSTOMER
    - ROLE_ADMIN
  ownership:
    field: customerId       # getter del agregado: order.customerId()
    claim: userId           # claim del JWT del usuario autenticado
    allowRoleBypass:
      - ROLE_ADMIN
```

No genera `@PreAuthorize`. Genera en el **handler**, después de cargar el agregado:
```java
// [G3] Ownership guard — derived_from: useCases[UC-ORD-003].authorization
if (!Objects.equals(String.valueOf(order.customerId()), SecurityContextUtil.currentUserClaim("userId"))
        && !SecurityContextUtil.hasAnyRole("ADMIN")) {
    throw new ForbiddenException();
}
```

Requisito: el input que carga el agregado debe declarar `loadAggregate: true`.
Ver [Estrategia 3 — Ownership](#estrategia-3--ownership-verificaci%C3%B3n-por-recurso) para la explicación completa.
