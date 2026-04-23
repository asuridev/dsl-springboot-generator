# Flujos de Validación — BC: customers

> Canasta Shop | Paso 2: Diseño Táctico | Fecha: 2026-04-23
>
> Prefijo de flujos: FL-CUS-NNN
> Estos flujos son la especificación ejecutable para tests de integración y
> para los agentes de implementación de los UCs con `implementation: scaffold`.

---

## FL-CUS-001: Registro exitoso de cliente

**Cubre**: UC-CUS-001 (scaffold — CUS-RULE-001, password hashing)

**Given**:
- No existe ningún cliente con email `"maria@example.com"` en el sistema.

**When**:
- `POST /api/customers/v1/customers` con body:
  ```json
  {
    "email": "maria@example.com",
    "firstName": "Maria",
    "lastName": "Lopez",
    "phone": "3001234567",
    "password": "Segura123!"
  }
  ```

**Then**:
- Respuesta: `201 Created`
- Header: `Location: /api/customers/v1/customers/{uuid-generado}`
- Body: vacío
- En DB: `Customer` persistido con `status: ACTIVE`, `email: "maria@example.com"`, `passwordHash` almacenado (bcrypt, no el texto plano), `phone: "3001234567"`
- El campo `passwordHash` no es devuelto en ninguna respuesta.

**Casos borde**:
- El email `"maria@example.com"` ya existe en otro cliente → `409 Conflict`
  ```json
  { "code": "EMAIL_ALREADY_REGISTERED", "message": "Email is already registered." }
  ```
- Email con formato inválido (`"notanemail"`) → `422 Unprocessable Entity` (validación de input)
- `password` ausente → `422 Unprocessable Entity`

**Orden de evaluación**:
1. Validaciones de input (campos requeridos, formato email) → 422 si falla
2. CUS-RULE-001: `findByEmail(email)` → si existe: 409 EMAIL_ALREADY_REGISTERED
3. Hashear password con bcrypt (implementación scaffold)
4. `create(email, firstName, lastName, phone?, passwordHash)` + `save(Customer)`

**Efecto secundario de implementación**: la propiedad `password` del request se transforma
en `passwordHash` mediante bcrypt antes de pasarla al método de dominio. El campo
`passwordHash` es `internal: true` — nunca aparece en el response.

---

## FL-CUS-002: Listado de clientes (paginado)

**Cubre**: UC-CUS-002

**Given**:
- Existen 3 clientes: 2 ACTIVE, 1 SUSPENDED.

**When**:
- `GET /api/customers/v1/customers?status=ACTIVE&page=1&size=10`

**Then**:
- Respuesta: `200 OK`
- Body: `{ "data": [{...}, {...}], "total": 2, "page": 1, "size": 10, "pages": 1 }`

**Casos borde**:
- Sin filtro `status` → retorna todos (2 ACTIVE + 1 SUSPENDED)
- `page=2` con `size=10` y solo 2 resultados → `data: []`, `total: 2`

---

## FL-CUS-003: Obtener perfil de cliente por ID

**Cubre**: UC-CUS-003

**Given**:
- Existe un `Customer` con id `"550e8400-e29b-41d4-a716-446655440000"`.

**When**:
- `GET /api/customers/v1/customers/550e8400-e29b-41d4-a716-446655440000`

**Then**:
- Respuesta: `200 OK`
- Body: `{ "id": "550e...", "email": "...", "firstName": "...", "lastName": "...", "status": "ACTIVE", "createdAt": "..." }`
- Los campos `passwordHash` no aparecen en el body (internal).

**Casos borde**:
- ID no existe → `404 Not Found`, `{ "code": "CUSTOMER_NOT_FOUND", "message": "..." }`

---

## FL-CUS-004: Actualizar perfil de cliente

**Cubre**: UC-CUS-004

**Given**:
- Existe un `Customer` con id `"550e..."` y `firstName: "Maria"`, `phone: "3001234567"`.

**When**:
- `PATCH /api/customers/v1/customers/550e...` con body:
  ```json
  { "firstName": "María José", "phone": "3109876543" }
  ```

**Then**:
- Respuesta: `204 No Content`
- En DB: `firstName: "María José"`, `phone: "3109876543"`, `lastName` sin cambio.

**Casos borde**:
- ID no existe → `404 CUSTOMER_NOT_FOUND`
- Body vacío (ningún campo) → `422 Unprocessable Entity` (al menos un campo requerido)

---

## FL-CUS-005: Suspender cliente

**Cubre**: UC-CUS-005

**Given**:
- Existe un `Customer` con `status: ACTIVE`.

**When**:
- `PATCH /api/customers/v1/customers/{id}/suspend`

**Then**:
- Respuesta: `204 No Content`
- En DB: `Customer.status = SUSPENDED`

**Casos borde**:
- Cliente ya SUSPENDED → el sistema puede proceder idempotentemente (el estado ya es el destino) o retornar 422 según decisión de implementación. Para V1: idempotente, 204.
- ID no existe → `404 CUSTOMER_NOT_FOUND`

---

## FL-CUS-006: Reactivar cliente

**Cubre**: UC-CUS-006

**Given**:
- Existe un `Customer` con `status: SUSPENDED`.

**When**:
- `PATCH /api/customers/v1/customers/{id}/reactivate`

**Then**:
- Respuesta: `204 No Content`
- En DB: `Customer.status = ACTIVE`

**Casos borde**:
- ID no existe → `404 CUSTOMER_NOT_FOUND`

---

## FL-CUS-007: Agregar dirección de entrega (con sideEffect de default)

**Cubre**: UC-CUS-007 (scaffold — CUS-RULE-003 sideEffect)

**Given** (caso 1 — primer dirección):
- Existe un `Customer` sin ninguna dirección guardada.

**When**:
- `POST /api/customers/v1/customers/{id}/addresses` con body:
  ```json
  {
    "label": "Casa",
    "street": "Calle 123 # 45-67",
    "district": "Chapinero",
    "city": "Bogota",
    "isDefault": true
  }
  ```

**Then**:
- Respuesta: `201 Created`
- Header: `Location: /api/customers/v1/customers/{id}/addresses/{addressId}`
- En DB: `Address` agregada con `isDefault: true`. No hay otras direcciones para resetear.

---

**Given** (caso 2 — segunda dirección con isDefault: true):
- Existe un `Customer` con 1 dirección `A1` con `isDefault: true`.

**When**:
- `POST /api/customers/v1/customers/{id}/addresses` con body:
  ```json
  { "street": "Carrera 20 # 10-50", "district": "Usaquen", "city": "Bogota", "isDefault": true }
  ```

**Then**:
- Respuesta: `201 Created`
- **Efecto secundario CUS-RULE-003**: `A1.isDefault` cambia a `false` automáticamente.
- En DB: nueva `Address` con `isDefault: true`; `A1.isDefault = false`.

---

**Given** (caso 3 — nueva dirección sin default):
- Existe un `Customer` con 1 dirección `A1` con `isDefault: true`.

**When**:
- `POST /api/customers/v1/customers/{id}/addresses` con body `isDefault: false`

**Then**:
- Respuesta: `201 Created`
- `A1.isDefault` permanece `true`. CUS-RULE-003 no se activa.

**Casos borde**:
- Cliente no encontrado → `404 CUSTOMER_NOT_FOUND`

**Orden de evaluación**:
1. `findById(customerId)` → 404 CUSTOMER_NOT_FOUND si no existe
2. Si `isDefault: true` → iterar colección `customer.addresses` y setear `isDefault = false` en cada una (CUS-RULE-003 sideEffect)
3. Crear nueva `Address` con id generado
4. Agregar a `customer.addresses`
5. `save(Customer)`

---

## FL-CUS-008: Listar direcciones de entrega

**Cubre**: UC-CUS-008

**Given**:
- Existe un `Customer` con 2 direcciones guardadas.

**When**:
- `GET /api/customers/v1/customers/{id}/addresses`

**Then**:
- Respuesta: `200 OK`, array con 2 `AddressResponse`.

**Casos borde**:
- Cliente sin direcciones → `200 OK`, array vacío `[]`
- Cliente no encontrado → `404 CUSTOMER_NOT_FOUND`

---

## FL-CUS-009: Obtener dirección por ID

**Cubre**: UC-CUS-009

**Given**:
- Existe un `Customer` con una `Address` id `"addr-001"`.

**When**:
- `GET /api/customers/v1/customers/{id}/addresses/addr-001`

**Then**:
- Respuesta: `200 OK` con `AddressResponse`.

**Casos borde**:
- Cliente no encontrado → `404 CUSTOMER_NOT_FOUND`
- Dirección no encontrada en la colección → `404 ADDRESS_NOT_FOUND`

---

## FL-CUS-010: Actualizar dirección (con sideEffect condicional de default)

**Cubre**: UC-CUS-010 (scaffold — CUS-RULE-003 sideEffect condicional)

**Given**:
- Existe un `Customer` con dos direcciones:
  - `A1`: `street: "Calle 123"`, `isDefault: true`
  - `A2`: `street: "Carrera 20"`, `isDefault: false`

**When** (caso 1 — actualizar campos sin cambiar default):
- `PATCH /api/customers/v1/customers/{id}/addresses/A2` con body:
  ```json
  { "notes": "Tocar timbre del piso 3" }
  ```

**Then**:
- Respuesta: `204 No Content`
- `A2.notes` actualizado. `isDefault` no cambia. CUS-RULE-003 no se activa.

---

**When** (caso 2 — promover A2 como default):
- `PATCH /api/customers/v1/customers/{id}/addresses/A2` con body:
  ```json
  { "isDefault": true }
  ```

**Then**:
- Respuesta: `204 No Content`
- **Efecto secundario CUS-RULE-003**: `A1.isDefault = false`.
- `A2.isDefault = true`.

**Casos borde**:
- Cliente no encontrado → `404 CUSTOMER_NOT_FOUND`
- Dirección no encontrada → `404 ADDRESS_NOT_FOUND`
- Body vacío → `422 Unprocessable Entity`

**Orden de evaluación**:
1. `findById(customerId)` → 404 si no existe
2. Buscar `addressId` en `customer.addresses` in-memory → 404 ADDRESS_NOT_FOUND si no existe
3. Aplicar campos del request a la Address
4. Si `isDefault` fue enviado como `true` → aplicar CUS-RULE-003: iterar otras addresses y setear `isDefault = false` (solo aplica si `isDefault` fue proporcionado en el request como `true`)
5. `save(Customer)`

---

## FL-CUS-011: Eliminar dirección

**Cubre**: UC-CUS-011

**Given**:
- Existe un `Customer` con una `Address` `A1`.

**When**:
- `DELETE /api/customers/v1/customers/{id}/addresses/A1`

**Then**:
- Respuesta: `204 No Content`
- `A1` ya no existe en la colección del cliente.

**Casos borde**:
- Cliente no encontrado → `404 CUSTOMER_NOT_FOUND`
- Dirección no encontrada → `404 ADDRESS_NOT_FOUND`
- Eliminar la dirección default → `204` sin error; el cliente queda sin dirección default.

---

## FL-CUS-012: Login exitoso y fallido

**Cubre**: UC-CUS-012 (scaffold — verificacion bcrypt + CUS-RULE-002 + generacion token)

**Given**:
- Existe `Customer` con `email: "test@example.com"`, `passwordHash: bcrypt("Pass123!")`,
  `status: ACTIVE`.

**When** (caso 1 — credenciales correctas):
- `POST /api/customers/v1/auth/sessions` con body:
  ```json
  { "email": "test@example.com", "password": "Pass123!" }
  ```

**Then**:
- Respuesta: `201 Created`
- Header: `Location: /api/customers/v1/auth/sessions/{sessionId}`
- Body: vacío
- En DB: `Session` con `status: ACTIVE`, `token` generado criptograficamente, `expiresAt = now() + 24h`, `customerId = customer.id`.

---

**When** (caso 2 — contraseña incorrecta):
- `POST /api/customers/v1/auth/sessions` con body `{ "email": "test@example.com", "password": "WrongPass" }`

**Then**:
- Respuesta: `401 Unauthorized`
  ```json
  { "code": "INVALID_CREDENTIALS", "message": "Invalid email or password." }
  ```

---

**When** (caso 3 — email no registrado):
- `POST /api/customers/v1/auth/sessions` con body `{ "email": "noexiste@example.com", "password": "..." }`

**Then**:
- Respuesta: `401 Unauthorized` con `code: "INVALID_CREDENTIALS"`
- Mismo error que contraseña incorrecta (OWASP A07: no revelar existencia de email)

---

**When** (caso 4 — cliente suspendido con credenciales correctas):
- `POST /api/customers/v1/auth/sessions` con credentials de un cliente con `status: SUSPENDED`

**Then**:
- Respuesta: `422 Unprocessable Entity`
  ```json
  { "code": "CUSTOMER_ACCOUNT_SUSPENDED", "message": "Customer account is suspended." }
  ```

**Orden de evaluación (estricto)**:
1. `findByEmail(email)` — si no existe: usar hash dummy para comparación (prevenir timing attack)
2. `bcrypt.compare(password, passwordHash)` en tiempo constante — si falla: `401 INVALID_CREDENTIALS`
3. `customer.status == ACTIVE` (CUS-RULE-002) — si SUSPENDED: `422 CUSTOMER_ACCOUNT_SUSPENDED`
4. Generar `token = secureRandom()`, `expiresAt = now() + 24h`
5. `Session.create(customerId, token, expiresAt)` + `save(Session)`

> Nota: el paso 1 siempre ejecuta la comparación bcrypt (incluso si el email no existe,
> usando un hash dummy), para que el tiempo de respuesta no varíe entre "email no existe"
> y "contraseña incorrecta". Esto previene ataques de timing (OWASP A07).

---

## FL-CUS-013: Logout

**Cubre**: UC-CUS-013

**Given**:
- Existe una `Session` con `status: ACTIVE`.

**When**:
- `DELETE /api/customers/v1/auth/sessions/{sessionId}`

**Then**:
- Respuesta: `204 No Content`
- En DB: `Session.status = REVOKED`.

**Casos borde**:
- Sesión no encontrada → `404 SESSION_NOT_FOUND`
- Sesión ya REVOKED → `204` idempotente (el estado ya es el destino).

---

## FL-CUS-014: Refresh de sesion

**Cubre**: UC-CUS-014 (scaffold — CUS-RULE-004 + CUS-RULE-006 + calculo de expiresAt)

**Given**:
- Existe una `Session` con `status: ACTIVE`, `expiresAt: 2026-04-24T10:00:00Z`.
- Momento actual: `2026-04-23T15:00:00Z` (sesión vigente).

**When**:
- `PATCH /api/customers/v1/auth/sessions/{sessionId}/refresh`

**Then**:
- Respuesta: `204 No Content`
- En DB: `Session.expiresAt = 2026-04-24T15:00:00Z` (now() + 24h).
- `Session.token` no cambia.

**Casos borde (con orden de evaluacion)**:

1. Sesión no encontrada → `404 SESSION_NOT_FOUND` (evaluado primero)
2. `session.status == REVOKED` → `422 SESSION_ALREADY_REVOKED` (CUS-RULE-004, evaluado segundo)
3. `session.expiresAt <= now()` → `422 SESSION_EXPIRED` (CUS-RULE-006, evaluado tercero)

**Orden de evaluacion**:
1. `findById(sessionId)` → 404 SESSION_NOT_FOUND si no existe
2. `session.status == ACTIVE` → 422 SESSION_ALREADY_REVOKED si REVOKED (CUS-RULE-004)
3. `session.expiresAt > now()` → 422 SESSION_EXPIRED si ha vencido (CUS-RULE-006)
4. `session.expiresAt = now() + 24h`
5. `save(Session)`

---

## FL-CUS-015: Obtener sesion por ID

**Cubre**: UC-CUS-015

**Given**:
- Existe una `Session` creada por login.

**When**:
- `GET /api/customers/v1/auth/sessions/{sessionId}`

**Then**:
- Respuesta: `200 OK`
- Body: `{ "id": "...", "customerId": "...", "token": "...", "expiresAt": "...", "status": "ACTIVE", "createdAt": "..." }`

> **Uso principal**: el cliente llama a este endpoint inmediatamente despues de
> `POST /auth/sessions` (login) para recuperar el token, ya que el comando
> retorna `201` sin body (CQRS).

**Casos borde**:
- Sesión no encontrada → `404 SESSION_NOT_FOUND`
