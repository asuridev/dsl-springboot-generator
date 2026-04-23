# Catalog BC — Flujos de Validación (Given/When/Then)

> Bounded Context: **catalog** | Versión: 1.0.0

---

## Matriz de Cobertura Scaffold

| UC scaffold | FL-IDs planificados |
|-------------|-------------------|
| UC-CAT-001 CreateCategory | FL-CAT-001, FL-CAT-002 |
| UC-CAT-002 UpdateCategory | FL-CAT-003, FL-CAT-004 |
| UC-CAT-009 DeleteCategory | FL-CAT-005, FL-CAT-006 |
| UC-CAT-014 CreateProduct | FL-CAT-007, FL-CAT-008 |
| UC-CAT-003 ActivateProduct | FL-CAT-009, FL-CAT-010 |
| UC-CAT-004 DiscontinueProduct | FL-CAT-011, FL-CAT-012 |
| UC-CAT-005 UpdateProductDetails | FL-CAT-013, FL-CAT-014 |
| UC-CAT-006 UpdateProductPrice | FL-CAT-015, FL-CAT-016 |
| UC-CAT-008 DeleteProduct | FL-CAT-017 |

---

## Aggregate: Category

---

### FL-CAT-001: Crear categoría exitosamente

**Given**:
- No existe categoría con nombre "Lácteos".
- No existe categoría con slug "lacteos".

**When**:
- POST /api/catalog/v1/categories con `{ "name": "Lácteos", "description": "Leches y derivados", "displayOrder": 1 }`

**Then**:
- HTTP 201 Created.
- Header `Location: /api/catalog/v1/categories/{new-id}`.
- Categoría persistida en estado ACTIVE con `slug: "lacteos"`.

**Casos borde**:
- `displayOrder` omitido → categoría creada con `displayOrder: null`. HTTP 201.
- `description` omitida → categoría creada con `description: null`. HTTP 201.

---

### FL-CAT-002: Crear categoría con nombre duplicado

**Given**:
- Existe categoría con nombre "Lácteos" (slug "lacteos").

**When**:
- POST /api/catalog/v1/categories con `{ "name": "Lácteos" }`

**Then**:
- HTTP 409 Conflict.
- Body: `{ "code": "CATEGORY_NAME_ALREADY_EXISTS", "message": "..." }`

**Casos borde**:
- Nombre igual pero diferente capitalización "lácteos" con slug "lacteos" ya existente → HTTP 409 con code `CATEGORY_SLUG_ALREADY_EXISTS`.
  - Orden de evaluación: CAT-RULE-005 (nombre) se evalúa primero; si pasa, CAT-RULE-006 (slug) se evalúa segundo.

---

### FL-CAT-003: Actualizar nombre de categoría con re-derivación de slug

**Given**:
- Existe categoría id=`c1` con `name: "Frutas"`, `slug: "frutas"`.
- No existe otra categoría con nombre "Frutas y Verduras".
- No existe otra categoría con slug "frutas-y-verduras".

**When**:
- PATCH /api/catalog/v1/categories/c1 con `{ "name": "Frutas y Verduras" }`

**Then**:
- HTTP 204 No Content.
- Categoría actualizada: `name: "Frutas y Verduras"`, `slug: "frutas-y-verduras"`.
- Efecto secundario (CAT-RULE-007): slug re-derivado automáticamente.

**Casos borde**:
- Solo `description` enviada (sin `name`) → slug no cambia. HTTP 204.
- Solo `displayOrder` enviado → slug no cambia. HTTP 204.
- Nuevo nombre igual al actual → sin cambio efectivo. HTTP 204.

---

### FL-CAT-004: Actualizar nombre a uno ya existente

**Given**:
- Existe categoría id=`c1` con `name: "Frutas"`.
- Existe categoría id=`c2` con `name: "Lácteos"`.

**When**:
- PATCH /api/catalog/v1/categories/c1 con `{ "name": "Lácteos" }`

**Then**:
- HTTP 409 Conflict.
- Body: `{ "code": "CATEGORY_NAME_ALREADY_EXISTS", "message": "..." }`

**Casos borde**:
- Categoría id=`c1` no existe → HTTP 404 con code `CATEGORY_NOT_FOUND` (evaluado antes de la validación de unicidad).

---

### FL-CAT-005: Eliminar categoría sin productos

**Given**:
- Existe categoría id=`c1` en estado ACTIVE sin productos asociados.

**When**:
- DELETE /api/catalog/v1/categories/c1

**Then**:
- HTTP 204 No Content.
- Categoría marcada con `deletedAt = now()` (borrado lógico).
- No visible en consultas posteriores.

**Casos borde**:
- Categoría en estado INACTIVE sin productos → HTTP 204 (estado no bloquea el borrado).

---

### FL-CAT-006: Eliminar categoría con productos activos

**Given**:
- Existe categoría id=`c1` con 2 productos en estado ACTIVE.

**When**:
- DELETE /api/catalog/v1/categories/c1

**Then**:
- HTTP 409 Conflict.
- Body: `{ "code": "CATEGORY_HAS_ACTIVE_PRODUCTS", "message": "..." }`

**Casos borde**:
- Categoría con solo productos DISCONTINUED → HTTP 204 (no se bloquea; DISCONTINUED no cuenta como activo a efectos de CAT-RULE-008).
- Categoría con productos DRAFT → HTTP 409 (DRAFT sí cuenta como activo para este guard).

---

## Aggregate: Product

---

### FL-CAT-007: Crear producto exitosamente

**Given**:
- Existe categoría id=`cat1` en estado ACTIVE.
- No existe producto con SKU "LAC-001".
- No existe producto con slug "leche-entera-1l".

**When**:
- POST /api/catalog/v1/products con:
  ```json
  {
    "name": "Leche Entera 1L",
    "sku": "LAC-001",
    "price": { "amount": "3500.0000", "currency": "COP" },
    "categoryId": "cat1"
  }
  ```

**Then**:
- HTTP 201 Created.
- Header `Location: /api/catalog/v1/products/{new-id}`.
- Producto persistido en estado DRAFT con `slug: "leche-entera-1l"`.
- Efectos secundarios: ninguno (no emite eventos; DRAFT no activa inventory).

**Casos borde**:
- `description` omitida → HTTP 201, `description: null`.

**Orden de evaluación de reglas**:
1. CAT-RULE-003 (unicidad de SKU) — evaluado primero.
2. CAT-RULE-004 (unicidad de slug) — evaluado segundo.
3. FK `categoryId` → CATEGORY_NOT_FOUND — evaluado tercero.

---

### FL-CAT-008: Crear producto con SKU duplicado

**Given**:
- Existe producto con SKU "LAC-001".

**When**:
- POST /api/catalog/v1/products con `{ "sku": "LAC-001", ... }`

**Then**:
- HTTP 409 Conflict.
- Body: `{ "code": "SKU_ALREADY_EXISTS", "message": "..." }`

**Casos borde**:
- Categoría inexistente + SKU válido → HTTP 404 con code `CATEGORY_NOT_FOUND`.
- Slug derivado duplicado (SKU único) → HTTP 409 con code `PRODUCT_SLUG_ALREADY_EXISTS`.

---

### FL-CAT-009: Activar producto exitosamente

**Given**:
- Existe producto id=`p1` en estado DRAFT.
- La categoría del producto (id=`cat1`) está en estado ACTIVE.

**When**:
- PATCH /api/catalog/v1/products/p1/activate

**Then**:
- HTTP 204 No Content.
- Producto en estado ACTIVE.
- Evento `ProductActivated` emitido con payload: `{ productId: p1, categoryId: cat1, sku, name, price }`.

**Orden de evaluación de reglas**:
1. CAT-RULE-002 (¿ya DISCONTINUED?) — evaluado primero.
2. CAT-RULE-001 (¿categoría ACTIVE?) — evaluado segundo.

---

### FL-CAT-010: Activar producto con categoría inactiva

**Given**:
- Existe producto id=`p1` en estado DRAFT.
- La categoría del producto está en estado INACTIVE.

**When**:
- PATCH /api/catalog/v1/products/p1/activate

**Then**:
- HTTP 422 Unprocessable Entity.
- Body: `{ "code": "PRODUCT_CATEGORY_NOT_ACTIVE", "message": "..." }`

**Casos borde**:
- Producto ya DISCONTINUED → HTTP 409 con code `PRODUCT_ALREADY_DISCONTINUED` (evaluado antes de CAT-RULE-001).
- Producto no encontrado → HTTP 404 con code `PRODUCT_NOT_FOUND`.

---

### FL-CAT-011: Discontinuar producto exitosamente

**Given**:
- Existe producto id=`p1` en estado ACTIVE.

**When**:
- PATCH /api/catalog/v1/products/p1/discontinue

**Then**:
- HTTP 204 No Content.
- Producto en estado DISCONTINUED (permanente; sin retorno posible).
- Evento `ProductDiscontinued` emitido con payload: `{ productId: p1, sku }`.

---

### FL-CAT-012: Intentar discontinuar un producto ya DISCONTINUED

**Given**:
- Existe producto id=`p1` en estado DISCONTINUED.

**When**:
- PATCH /api/catalog/v1/products/p1/discontinue

**Then**:
- HTTP 409 Conflict.
- Body: `{ "code": "PRODUCT_ALREADY_DISCONTINUED", "message": "..." }`

**Casos borde**:
- Producto en DRAFT → puede discontinuarse (transición no bloqueada por CAT-RULE-002 en este sentido). HTTP 204.

---

### FL-CAT-013: Actualizar detalles del producto — nombre re-deriva slug

**Given**:
- Existe producto id=`p1` en estado ACTIVE con `name: "Leche Entera 1L"`, `slug: "leche-entera-1l"`.
- No existe producto con slug "leche-semidescremada-1l".

**When**:
- PATCH /api/catalog/v1/products/p1/details con `{ "name": "Leche Semidescremada 1L" }`

**Then**:
- HTTP 204 No Content.
- Producto actualizado: `name: "Leche Semidescremada 1L"`, `slug: "leche-semidescremada-1l"`.
- Efecto secundario (CAT-RULE-010): slug re-derivado.

**Orden de evaluación de reglas**:
1. CAT-RULE-002 (¿DISCONTINUED?) — evaluado primero.
2. CAT-RULE-004 (unicidad de slug, solo si `name` enviado) — evaluado segundo.
3. CAT-RULE-010 (re-derivar slug) — efecto secundario del happy path.

---

### FL-CAT-014: Actualizar detalles — slug duplicado

**Given**:
- Existe producto id=`p1` en estado ACTIVE.
- Existe producto id=`p2` con slug "leche-semidescremada-1l".

**When**:
- PATCH /api/catalog/v1/products/p1/details con `{ "name": "Leche Semidescremada 1L" }`

**Then**:
- HTTP 409 Conflict.
- Body: `{ "code": "PRODUCT_SLUG_ALREADY_EXISTS", "message": "..." }`

**Casos borde**:
- Producto DISCONTINUED → HTTP 409 con code `PRODUCT_ALREADY_DISCONTINUED` (evaluado antes del slug check).
- Solo `description` enviada (sin `name`) → sin validación de slug. HTTP 204.

---

### FL-CAT-015: Actualizar precio del producto

**Given**:
- Existe producto id=`p1` en estado ACTIVE con precio `{ "amount": "3500.0000", "currency": "COP" }`.

**When**:
- PATCH /api/catalog/v1/products/p1/price con `{ "amount": "3800.0000", "currency": "COP" }`

**Then**:
- HTTP 204 No Content.
- Precio actualizado a `3800.0000 COP`.
- Efecto secundario (CAT-RULE-009): entrada en `PriceHistory` creada con `previousPrice: 3500.0000 COP`, `newPrice: 3800.0000 COP`, `changedAt: now()`.
- Evento `ProductPriceChanged` emitido con payload: `{ productId: p1, previousPrice: {3500.0000, COP}, newPrice: {3800.0000, COP} }`.

---

### FL-CAT-016: Actualizar precio de producto DISCONTINUED

**Given**:
- Existe producto id=`p1` en estado DISCONTINUED.

**When**:
- PATCH /api/catalog/v1/products/p1/price con `{ "amount": "3800.0000", "currency": "COP" }`

**Then**:
- HTTP 409 Conflict.
- Body: `{ "code": "PRODUCT_ALREADY_DISCONTINUED", "message": "..." }`

**Casos borde**:
- Producto no encontrado → HTTP 404 con code `PRODUCT_NOT_FOUND`.

---

### FL-CAT-017: Eliminar producto en estado DRAFT

**Given**:
- Existe producto id=`p1` en estado DRAFT.

**When**:
- DELETE /api/catalog/v1/products/p1

**Then**:
- HTTP 204 No Content.
- Producto marcado con `deletedAt = now()`.

**Orden de evaluación de reglas**:
1. `findById` → si no existe: HTTP 404 `PRODUCT_NOT_FOUND`.
2. CAT-RULE-002 (¿DISCONTINUED?) — si DISCONTINUED: HTTP 409 `PRODUCT_ALREADY_DISCONTINUED`.
3. Borrado lógico aplicado.

**Casos borde**:
- Producto en estado ACTIVE → CAT-RULE-002 no aplica directamente (ACTIVE no es DISCONTINUED). HTTP 204 (el operador puede eliminar productos ACTIVE vía borrado lógico).
- Producto en estado DISCONTINUED → HTTP 409 con code `PRODUCT_ALREADY_DISCONTINUED` (estado terminal protege contra eliminaciones).

---

## Flujos de Integración (Eventos Salientes)

---

### FL-CAT-018: ProductActivated publicado correctamente

**Given**:
- Producto id=`p1` en DRAFT, categoría id=`cat1` en ACTIVE.

**When**:
- PATCH /api/catalog/v1/products/p1/activate → HTTP 204.

**Then**:
- Mensaje `ProductActivated` publicado en canal `catalog.product.activated`.
- Payload contiene: `productId`, `categoryId`, `sku`, `name`, `price.amount`, `price.currency`.
- Headers contienen: `eventId` (UUID), `eventType: ProductActivated`, `occurredAt` (timestamp), `sourceBC: catalog`.

---

### FL-CAT-019: ProductPriceChanged publicado correctamente

**Given**:
- Producto id=`p1` en ACTIVE con precio `3500.0000 COP`.

**When**:
- PATCH /api/catalog/v1/products/p1/price → HTTP 204.

**Then**:
- Mensaje `ProductPriceChanged` publicado en canal `catalog.product.price-changed`.
- Payload contiene: `productId`, `previousPrice`, `newPrice`.
