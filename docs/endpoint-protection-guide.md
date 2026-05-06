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

**Configuración en Keycloak:**
1. Crear los roles: `ADMIN`, `CATALOG_MANAGER`, `CUSTOMER`
2. Asignar roles a usuarios en la sección "Role Mappings"
3. El generador ya configura Spring para leer `realm_access.roles` del token

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

El token de un `CATALOG_MANAGER` cargaría:
```json
{
  "sub": "john.doe",
  "realm_access": {
    "roles": ["CATALOG_MANAGER", "products:read", "products:create", "products:update"]
  }
}
```

Los permisos granulares viajan **dentro** del token como si fueran roles adicionales.

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

Para que Spring extraiga tanto roles como permisos del token, el `JwtAuthConverter` debe mapear ambos del claim correspondiente. Con Keycloak, todos viajan en `realm_access.roles`, así que el converter estándar ya los recoge sin cambios adicionales.

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

El generador actualmente soporta `rolesAnyOf` en el YAML:

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

Para añadir soporte de scopes, el YAML podría extenderse con:
```yaml
authorization:
  scopesAnyOf:
    - products:write
  rolesAnyOf:
    - ROLE_ADMIN
```

Generando:
```java
@PreAuthorize("hasAuthority('SCOPE_products:write') and hasAnyRole('ADMIN')")
```
