# Especificación de Casos de Uso — BC: customers

> Canasta Shop | Paso 2: Diseño Táctico | Fecha: 2026-04-23

---

## Actores

| Actor | Descripción |
|-------|-------------|
| customer | Consumidor final registrado en la plataforma |
| operator | Administrador interno que gestiona cuentas de clientes |

---

## Agregado: Customer

---

### UC-CUS-001: RegisterCustomer

**Actor principal**: customer

**Precondiciones**:
- No existe ningún cliente con el email proporcionado.

**Flujo principal**:
1. El cliente envía `email`, `firstName`, `lastName`, `phone?` y `password`.
2. El sistema verifica que el `email` no está registrado (CUS-RULE-001).
3. El sistema hashea la contraseña con bcrypt y almacena el resultado en `passwordHash` (internal).
4. El sistema crea el `Customer` con `status: ACTIVE`.
5. El sistema persiste el cliente.
6. El sistema responde `201 Created` con `Location: /api/customers/v1/customers/{id}`.

**Flujos de excepción**:
- **1a** — El email ya está registrado: `409 Conflict` con code `EMAIL_ALREADY_REGISTERED`.

**Postcondiciones**:
- El `Customer` existe con `status: ACTIVE`.
- El `passwordHash` está almacenado; la contraseña en texto plano no es persistida.

**Reglas de negocio**: CUS-RULE-001

**Eventos emitidos**: ninguno

---

### UC-CUS-002: ListCustomers

**Actor principal**: operator

**Precondiciones**:
- El operador tiene acceso al backoffice.

**Flujo principal**:
1. El operador solicita la lista de clientes con filtros opcionales (`status?`) y paginación.
2. El sistema retorna la página de clientes.

**Postcondiciones**:
- Ningún cambio de estado.

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

### UC-CUS-003: GetCustomerById

**Actor principal**: operator

**Precondiciones**:
- El cliente con el ID dado existe.

**Flujo principal**:
1. El operador solicita el perfil del cliente por ID.
2. El sistema retorna los datos del `Customer`.

**Flujos de excepción**:
- **1a** — Cliente no encontrado: `404 Not Found` con code `CUSTOMER_NOT_FOUND`.

**Postcondiciones**:
- Ningún cambio de estado.

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

### UC-CUS-004: UpdateCustomer

**Actor principal**: customer

**Precondiciones**:
- El cliente con el ID dado existe.
- Al menos uno de `firstName`, `lastName`, `phone` está presente en el request.

**Flujo principal**:
1. El cliente envía los campos a actualizar (`firstName?`, `lastName?`, `phone?`).
2. El sistema carga el `Customer` y aplica los cambios.
3. El sistema persiste el cliente actualizado.
4. El sistema responde `204 No Content`.

**Flujos de excepción**:
- **1a** — Cliente no encontrado: `404 Not Found` con code `CUSTOMER_NOT_FOUND`.

**Postcondiciones**:
- Los campos modificados del `Customer` reflejan los nuevos valores.

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

### UC-CUS-005: SuspendCustomer

**Actor principal**: operator

**Precondiciones**:
- El cliente existe y su `status` es `ACTIVE`.

**Flujo principal**:
1. El operador envía la solicitud de suspensión para un cliente.
2. El sistema carga el `Customer` y lo transiciona a `SUSPENDED`.
3. El sistema persiste el cliente.
4. El sistema responde `204 No Content`.

**Flujos de excepción**:
- **1a** — Cliente no encontrado: `404 Not Found` con code `CUSTOMER_NOT_FOUND`.

**Postcondiciones**:
- `Customer.status` es `SUSPENDED`. El cliente no puede iniciar sesión.

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

### UC-CUS-006: ReactivateCustomer

**Actor principal**: operator

**Precondiciones**:
- El cliente existe y su `status` es `SUSPENDED`.

**Flujo principal**:
1. El operador envía la solicitud de reactivación para un cliente.
2. El sistema carga el `Customer` y lo transiciona a `ACTIVE`.
3. El sistema persiste el cliente.
4. El sistema responde `204 No Content`.

**Flujos de excepción**:
- **1a** — Cliente no encontrado: `404 Not Found` con code `CUSTOMER_NOT_FOUND`.

**Postcondiciones**:
- `Customer.status` es `ACTIVE`. El cliente puede volver a iniciar sesión.

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

## Agregado: Customer — Entidad: Address

---

### UC-CUS-007: AddAddress

**Actor principal**: customer

**Precondiciones**:
- El cliente con el ID dado existe.

**Flujo principal**:
1. El cliente envía `label?`, `street`, `district`, `city`, `postalCode?`, `notes?`, `isDefault`.
2. El sistema carga el `Customer`.
3. Si `isDefault: true`, el sistema aplica CUS-RULE-003: establece `isDefault: false` en todas las demás direcciones del cliente.
4. El sistema crea la nueva `Address` con `id` generado y la agrega a la colección.
5. El sistema persiste el `Customer`.
6. El sistema responde `201 Created` con `Location: /api/customers/v1/customers/{id}/addresses/{addressId}`.

**Flujos alternativos**:
- **4a** — `isDefault: false` y no hay ninguna dirección previa con default: la nueva dirección se agrega sin modificar ninguna otra.

**Flujos de excepción**:
- **1a** — Cliente no encontrado: `404 Not Found` con code `CUSTOMER_NOT_FOUND`.

**Postcondiciones**:
- La nueva `Address` existe en la colección del `Customer`.
- Si `isDefault: true`, ninguna otra dirección del cliente tiene `isDefault: true`.

**Reglas de negocio**: CUS-RULE-003

**Eventos emitidos**: ninguno

---

### UC-CUS-008: ListAddresses

**Actor principal**: customer

**Precondiciones**:
- El cliente con el ID dado existe.

**Flujo principal**:
1. El cliente solicita la lista de sus direcciones.
2. El sistema carga el `Customer` y retorna su colección de `Address`.

**Flujos de excepción**:
- **1a** — Cliente no encontrado: `404 Not Found` con code `CUSTOMER_NOT_FOUND`.

**Postcondiciones**:
- Ningún cambio de estado.

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

### UC-CUS-009: GetAddressById

**Actor principal**: customer

**Precondiciones**:
- El cliente con el ID dado existe.
- La dirección con el `addressId` dado existe en la colección del cliente.

**Flujo principal**:
1. El cliente solicita una dirección específica por `addressId`.
2. El sistema carga el `Customer` y busca la `Address` por ID en la colección.
3. El sistema retorna los datos de la `Address`.

**Flujos de excepción**:
- **1a** — Cliente no encontrado: `404 Not Found` con code `CUSTOMER_NOT_FOUND`.
- **1b** — Dirección no encontrada en la colección: `404 Not Found` con code `ADDRESS_NOT_FOUND`.

**Postcondiciones**:
- Ningún cambio de estado.

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

### UC-CUS-010: UpdateAddress

**Actor principal**: customer

**Precondiciones**:
- El cliente con el ID dado existe.
- La dirección con el `addressId` dado existe en la colección del cliente.
- Al menos un campo de la dirección está presente en el request.

**Flujo principal**:
1. El cliente envía los campos a actualizar para la dirección (`label?`, `street?`, `district?`, `city?`, `postalCode?`, `notes?`, `isDefault?`).
2. El sistema carga el `Customer` y localiza la `Address` por `addressId` en la colección.
3. El sistema aplica los cambios a la `Address`.
4. Si `isDefault` fue enviado como `true`, el sistema aplica CUS-RULE-003: establece `isDefault: false` en todas las demás direcciones del cliente.
5. El sistema persiste el `Customer`.
6. El sistema responde `204 No Content`.

**Flujos de excepción**:
- **1a** — Cliente no encontrado: `404 Not Found` con code `CUSTOMER_NOT_FOUND`.
- **2a** — Dirección no encontrada: `404 Not Found` con code `ADDRESS_NOT_FOUND`.

**Postcondiciones**:
- La `Address` refleja los nuevos valores.
- Si `isDefault: true` fue enviado, ninguna otra dirección del cliente tiene `isDefault: true`.

**Reglas de negocio**: CUS-RULE-003

**Eventos emitidos**: ninguno

---

### UC-CUS-011: RemoveAddress

**Actor principal**: customer

**Precondiciones**:
- El cliente con el ID dado existe.
- La dirección con el `addressId` dado existe en la colección del cliente.

**Flujo principal**:
1. El cliente solicita eliminar una dirección por `addressId`.
2. El sistema carga el `Customer` y localiza la `Address` por `addressId` en la colección.
3. El sistema elimina la `Address` de la colección.
4. El sistema persiste el `Customer`.
5. El sistema responde `204 No Content`.

**Flujos de excepción**:
- **1a** — Cliente no encontrado: `404 Not Found` con code `CUSTOMER_NOT_FOUND`.
- **2a** — Dirección no encontrada: `404 Not Found` con code `ADDRESS_NOT_FOUND`.

**Postcondiciones**:
- La `Address` no existe en la colección del `Customer`.
- Si la dirección eliminada era la default, ninguna otra dirección es automáticamente promovida.

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

## Agregado: Session

---

### UC-CUS-012: Login

**Actor principal**: customer

**Precondiciones**:
- El cliente con el email dado existe y tiene `status: ACTIVE`.

**Flujo principal**:
1. El cliente envía `email` y `password`.
2. El sistema busca el `Customer` por email.
3. El sistema verifica la contraseña contra `Customer.passwordHash` usando comparación bcrypt en tiempo constante.
4. El sistema verifica que `Customer.status` es `ACTIVE` (CUS-RULE-002).
5. El sistema genera un token criptográficamente seguro y calcula `expiresAt = now() + 24h`.
6. El sistema crea el `Session` con `status: ACTIVE`.
7. El sistema persiste la sesión.
8. El sistema responde `201 Created` con `Location: /api/customers/v1/auth/sessions/{id}`.

> **Nota de seguridad (OWASP A07):** En los pasos 2 y 3, si el email no existe o la contraseña no coincide, el sistema devuelve siempre `401 INVALID_CREDENTIALS` sin distinguir cuál falló, para prevenir enumeración de usuarios.

**Flujos de excepción**:
- **2a** — Email no encontrado: `401 Unauthorized` con code `INVALID_CREDENTIALS`.
- **3a** — Contraseña incorrecta: `401 Unauthorized` con code `INVALID_CREDENTIALS`.
- **4a** — Cliente suspendido (contraseña correcta): `422 Unprocessable Entity` con code `CUSTOMER_ACCOUNT_SUSPENDED`.

**Postcondiciones**:
- La `Session` existe con `status: ACTIVE`.
- El cliente puede acceder a recursos autenticados usando el token de sesión.

**Reglas de negocio**: CUS-RULE-002

**Eventos emitidos**: ninguno

---

### UC-CUS-013: Logout

**Actor principal**: customer

**Precondiciones**:
- La sesión con el ID dado existe.

**Flujo principal**:
1. El cliente solicita cerrar su sesión por ID.
2. El sistema carga la `Session` y la transiciona a `REVOKED`.
3. El sistema persiste la sesión.
4. El sistema responde `204 No Content`.

**Flujos de excepción**:
- **1a** — Sesión no encontrada: `404 Not Found` con code `SESSION_NOT_FOUND`.

**Postcondiciones**:
- `Session.status` es `REVOKED`. El token de sesión ya no es válido.

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

### UC-CUS-014: RefreshSession

**Actor principal**: customer

**Precondiciones**:
- La sesión con el ID dado existe.
- `Session.status` es `ACTIVE`.
- `Session.expiresAt` es mayor que `now()`.

**Flujo principal**:
1. El cliente solicita extender la vigencia de su sesión por ID.
2. El sistema carga la `Session`.
3. El sistema verifica que `Session.status` es `ACTIVE` (CUS-RULE-004).
4. El sistema verifica que `Session.expiresAt > now()` (CUS-RULE-006).
5. El sistema actualiza `expiresAt = now() + 24h`.
6. El sistema persiste la sesión.
7. El sistema responde `204 No Content`.

**Flujos de excepción**:
- **1a** — Sesión no encontrada: `404 Not Found` con code `SESSION_NOT_FOUND`.
- **3a** — Sesión en estado REVOKED: `422 Unprocessable Entity` con code `SESSION_ALREADY_REVOKED`.
- **4a** — Sesión expirada: `422 Unprocessable Entity` con code `SESSION_EXPIRED`.

**Postcondiciones**:
- `Session.expiresAt` se ha extendido 24 horas a partir del momento de la solicitud.
- El token de sesión no cambia.

**Reglas de negocio**: CUS-RULE-004, CUS-RULE-006

**Eventos emitidos**: ninguno

---

### UC-CUS-015: GetSessionById

**Actor principal**: customer

**Precondiciones**:
- La sesión con el ID dado existe.

**Flujo principal**:
1. El cliente solicita los datos de su sesión por ID.
2. El sistema retorna los datos de la `Session` (incluyendo `token` y `expiresAt`).

> **Uso típico:** El cliente llama a este endpoint inmediatamente después de `POST /auth/sessions`
> para recuperar el token de acceso.

**Flujos de excepción**:
- **1a** — Sesión no encontrada: `404 Not Found` con code `SESSION_NOT_FOUND`.

**Postcondiciones**:
- Ningún cambio de estado.

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno
