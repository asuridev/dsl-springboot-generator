# Catalog BC — Especificación de Casos de Uso

> Bounded Context: **catalog** | Tipo: core
> Propósito: Fuente autoritativa de productos, categorías, precios y disponibilidad.

---

## Actores

| Actor | Descripción |
|-------|-------------|
| Operator | Administrador interno que gestiona el catálogo |
| Customer | Consumidor final que navega el catálogo activo |

---

## Aggregate: Category

---

### UC-CAT-001: CreateCategory

**Actor principal**: Operator

**Precondiciones**:
- El operador está autenticado.

**Flujo principal**:
1. El operador envía nombre, descripción opcional y orden de visualización opcional.
2. El sistema verifica que no existe otra categoría con el mismo nombre (CAT-RULE-005).
3. El sistema deriva el slug a partir del nombre.
4. El sistema verifica que el slug derivado es único (CAT-RULE-006).
5. El sistema crea la categoría en estado ACTIVE y responde `201 Created` con `Location`.

**Flujos de excepción**:
- **1a** — Nombre ya registrado: `409 Conflict` con code `CATEGORY_NAME_ALREADY_EXISTS`.
- **1b** — Slug derivado ya existe: `409 Conflict` con code `CATEGORY_SLUG_ALREADY_EXISTS`.

**Postcondiciones**:
- Categoría creada en estado ACTIVE con slug derivado del nombre.

**Reglas de negocio**: CAT-RULE-005, CAT-RULE-006

**Eventos emitidos**: ninguno

---

### UC-CAT-002: UpdateCategory

**Actor principal**: Operator

**Precondiciones**:
- La categoría existe.

**Flujo principal**:
1. El operador envía uno o más campos opcionales: `name`, `description`, `displayOrder`.
2. El sistema carga la categoría (`findById`).
3. Si `name` fue enviado: verifica unicidad de nombre (CAT-RULE-005) y re-deriva el slug.
4. Si el nuevo slug difiere del actual: verifica unicidad de slug (CAT-RULE-006).
5. Aplica los cambios y responde `204 No Content`.

**Flujos de excepción**:
- **2a** — Categoría no encontrada: `404 Not Found` con code `CATEGORY_NOT_FOUND`.
- **3a** — Nuevo nombre ya usado: `409 Conflict` con code `CATEGORY_NAME_ALREADY_EXISTS`. (Solo aplica si `name` fue proporcionado en el request.)
- **4a** — Slug derivado ya existe: `409 Conflict` con code `CATEGORY_SLUG_ALREADY_EXISTS`. (Solo aplica si `name` fue proporcionado en el request.)

**Postcondiciones**:
- Categoría actualizada. Slug re-derivado si el nombre cambió (CAT-RULE-007).

**Reglas de negocio**: CAT-RULE-005, CAT-RULE-006, CAT-RULE-007

**Eventos emitidos**: ninguno

---

### UC-CAT-009: DeleteCategory

**Actor principal**: Operator

**Precondiciones**:
- La categoría existe.
- No tiene productos en estado DRAFT o ACTIVE.

**Flujo principal**:
1. El operador solicita eliminar la categoría.
2. El sistema carga la categoría (`findById`).
3. El sistema verifica que no existen productos asociados en DRAFT o ACTIVE (CAT-RULE-008).
4. El sistema aplica borrado lógico (`deletedAt = now()`) y responde `204 No Content`.

**Flujos de excepción**:
- **2a** — Categoría no encontrada: `404 Not Found` con code `CATEGORY_NOT_FOUND`.
- **3a** — Categoría tiene productos activos: `409 Conflict` con code `CATEGORY_HAS_ACTIVE_PRODUCTS`.

**Postcondiciones**:
- Categoría marcada como eliminada lógicamente (invisible a consultas).

**Reglas de negocio**: CAT-RULE-008

**Eventos emitidos**: ninguno

---

### UC-CAT-010: DeactivateCategory

**Actor principal**: Operator

**Precondiciones**:
- La categoría existe y está en estado ACTIVE.

**Flujo principal**:
1. El operador solicita desactivar la categoría.
2. El sistema carga la categoría y transiciona a INACTIVE.
3. Responde `204 No Content`.

**Flujos de excepción**:
- **1a** — Categoría no encontrada: `404 Not Found` con code `CATEGORY_NOT_FOUND`.

**Postcondiciones**:
- Categoría en estado INACTIVE; los productos existentes no se eliminan pero no pueden activarse.

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

### UC-CAT-011: ReactivateCategory

**Actor principal**: Operator

**Precondiciones**:
- La categoría existe y está en estado INACTIVE.

**Flujo principal**:
1. El operador solicita reactivar la categoría.
2. El sistema carga la categoría y transiciona a ACTIVE.
3. Responde `204 No Content`.

**Flujos de excepción**:
- **1a** — Categoría no encontrada: `404 Not Found` con code `CATEGORY_NOT_FOUND`.

**Postcondiciones**:
- Categoría en estado ACTIVE; productos pueden volver a activarse.

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

### UC-CAT-012: GetCategoryById

**Actor principal**: Operator

**Precondiciones**:
- La categoría existe.

**Flujo principal**:
1. El operador solicita el detalle de una categoría por ID.
2. El sistema retorna la categoría completa.

**Flujos de excepción**:
- **1a** — Categoría no encontrada: `404 Not Found` con code `CATEGORY_NOT_FOUND`.

**Postcondiciones**: ninguna (operación de solo lectura).

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

### UC-CAT-013: ListCategories

**Actor principal**: Operator

**Precondiciones**: ninguna.

**Flujo principal**:
1. El operador solicita el listado de categorías con filtro opcional por `status` y paginación.
2. El sistema retorna la página solicitada.

**Postcondiciones**: ninguna (operación de solo lectura).

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

## Aggregate: Product

---

### UC-CAT-014: CreateProduct

**Actor principal**: Operator

**Precondiciones**:
- La categoría referenciada existe.

**Flujo principal**:
1. El operador envía nombre, SKU, precio (amount + currency), `categoryId`, y descripción opcional.
2. El sistema verifica que el SKU no está registrado (CAT-RULE-003).
3. El sistema deriva el slug del nombre.
4. El sistema verifica que el slug derivado es único (CAT-RULE-004).
5. El sistema verifica que `categoryId` referencia una categoría existente.
6. El sistema crea el producto en estado DRAFT y responde `201 Created` con `Location`.

**Flujos de excepción**:
- **2a** — SKU ya registrado: `409 Conflict` con code `SKU_ALREADY_EXISTS`.
- **4a** — Slug derivado ya existe: `409 Conflict` con code `PRODUCT_SLUG_ALREADY_EXISTS`.
- **5a** — Categoría no encontrada: `404 Not Found` con code `CATEGORY_NOT_FOUND`.

**Postcondiciones**:
- Producto creado en estado DRAFT.

**Reglas de negocio**: CAT-RULE-003, CAT-RULE-004

**Eventos emitidos**: ninguno

---

### UC-CAT-003: ActivateProduct

**Actor principal**: Operator

**Precondiciones**:
- El producto existe y está en estado DRAFT.

**Flujo principal**:
1. El operador solicita activar el producto.
2. El sistema carga el producto y su categoría.
3. El sistema verifica que el producto no está DISCONTINUED (CAT-RULE-002).
4. El sistema verifica que la categoría está en estado ACTIVE (CAT-RULE-001).
5. El sistema transiciona el producto a ACTIVE.
6. El sistema emite `ProductActivated`.
7. Responde `204 No Content`.

**Flujos de excepción**:
- **1a** — Producto no encontrado: `404 Not Found` con code `PRODUCT_NOT_FOUND`.
- **3a** — Producto ya DISCONTINUED: `409 Conflict` con code `PRODUCT_ALREADY_DISCONTINUED`.
- **4a** — Categoría no activa: `422 Unprocessable Entity` con code `PRODUCT_CATEGORY_NOT_ACTIVE`.

**Postcondiciones**:
- Producto en estado ACTIVE. `ProductActivated` emitido a inventory y orders.

**Reglas de negocio**: CAT-RULE-001, CAT-RULE-002

**Eventos emitidos**: ProductActivated

---

### UC-CAT-004: DiscontinueProduct

**Actor principal**: Operator

**Precondiciones**:
- El producto existe y está en estado ACTIVE.

**Flujo principal**:
1. El operador solicita discontinuar el producto.
2. El sistema carga el producto.
3. El sistema verifica que el producto no está ya DISCONTINUED (CAT-RULE-002).
4. El sistema transiciona el producto a DISCONTINUED (estado terminal).
5. El sistema emite `ProductDiscontinued`.
6. Responde `204 No Content`.

**Flujos de excepción**:
- **1a** — Producto no encontrado: `404 Not Found` con code `PRODUCT_NOT_FOUND`.
- **3a** — Producto ya DISCONTINUED: `409 Conflict` con code `PRODUCT_ALREADY_DISCONTINUED`.

**Postcondiciones**:
- Producto en estado DISCONTINUED (permanente). `ProductDiscontinued` emitido.

**Reglas de negocio**: CAT-RULE-002

**Eventos emitidos**: ProductDiscontinued

---

### UC-CAT-005: UpdateProductDetails

**Actor principal**: Operator

**Precondiciones**:
- El producto existe y no está DISCONTINUED.

**Flujo principal**:
1. El operador envía campos opcionales: `name`, `description`.
2. El sistema carga el producto.
3. El sistema verifica que el producto no está DISCONTINUED (CAT-RULE-002).
4. Si `name` fue enviado: re-deriva el slug (CAT-RULE-010) y verifica unicidad (CAT-RULE-004).
5. Aplica los cambios y responde `204 No Content`.

**Flujos de excepción**:
- **2a** — Producto no encontrado: `404 Not Found` con code `PRODUCT_NOT_FOUND`.
- **3a** — Producto DISCONTINUED: `409 Conflict` con code `PRODUCT_ALREADY_DISCONTINUED`.
- **4a** — Slug derivado ya existe: `409 Conflict` con code `PRODUCT_SLUG_ALREADY_EXISTS`. (Solo aplica si `name` fue proporcionado en el request.)

**Postcondiciones**:
- Producto actualizado. Slug re-derivado si el nombre cambió.

**Reglas de negocio**: CAT-RULE-002, CAT-RULE-004, CAT-RULE-010

**Eventos emitidos**: ninguno

---

### UC-CAT-006: UpdateProductPrice

**Actor principal**: Operator

**Precondiciones**:
- El producto existe y no está DISCONTINUED.

**Flujo principal**:
1. El operador envía el nuevo precio (`amount`, `currency`).
2. El sistema carga el producto.
3. El sistema verifica que el producto no está DISCONTINUED (CAT-RULE-002).
4. El sistema actualiza el precio y crea una entrada en `PriceHistory` con el precio anterior y nuevo (CAT-RULE-009).
5. El sistema emite `ProductPriceChanged`.
6. Responde `204 No Content`.

**Flujos de excepción**:
- **2a** — Producto no encontrado: `404 Not Found` con code `PRODUCT_NOT_FOUND`.
- **3a** — Producto DISCONTINUED: `409 Conflict` con code `PRODUCT_ALREADY_DISCONTINUED`.

**Postcondiciones**:
- Precio actualizado. Entrada en PriceHistory creada. `ProductPriceChanged` emitido a orders.

**Reglas de negocio**: CAT-RULE-002, CAT-RULE-009

**Eventos emitidos**: ProductPriceChanged

---

### UC-CAT-007: UpdateProductCategory

**Actor principal**: Operator

**Precondiciones**:
- El producto existe, no está DISCONTINUED, y la nueva categoría existe.

**Flujo principal**:
1. El operador envía el nuevo `categoryId`.
2. El sistema carga el producto y verifica que no está DISCONTINUED (CAT-RULE-002).
3. El sistema verifica que la categoría existe.
4. El sistema actualiza `categoryId` y responde `204 No Content`.

**Flujos de excepción**:
- **2a** — Producto no encontrado: `404 Not Found` con code `PRODUCT_NOT_FOUND`.
- **2b** — Producto DISCONTINUED: `409 Conflict` con code `PRODUCT_ALREADY_DISCONTINUED`.
- **3a** — Categoría no encontrada: `404 Not Found` con code `CATEGORY_NOT_FOUND`.

**Postcondiciones**:
- Producto asociado a la nueva categoría.

**Reglas de negocio**: CAT-RULE-002

**Eventos emitidos**: ninguno

---

### UC-CAT-008: DeleteProduct

**Actor principal**: Operator

**Precondiciones**:
- El producto existe y está en estado DRAFT (productos ACTIVE o DISCONTINUED no se eliminan).

**Flujo principal**:
1. El operador solicita eliminar el producto.
2. El sistema carga el producto.
3. El sistema verifica que el producto no está DISCONTINUED (CAT-RULE-002).
4. El sistema aplica borrado lógico (`deletedAt = now()`) y responde `204 No Content`.

**Flujos de excepción**:
- **2a** — Producto no encontrado: `404 Not Found` con code `PRODUCT_NOT_FOUND`.
- **3a** — Producto DISCONTINUED: `409 Conflict` con code `PRODUCT_ALREADY_DISCONTINUED`.

**Postcondiciones**:
- Producto marcado como eliminado lógicamente.

**Reglas de negocio**: CAT-RULE-002

**Eventos emitidos**: ninguno

---

### UC-CAT-015: AddProductImage

**Actor principal**: Operator

**Precondiciones**:
- El producto existe y no está DISCONTINUED.

**Flujo principal**:
1. El operador envía `url`, `displayOrder`, y `altText` opcional.
2. El sistema carga el producto y verifica que no está DISCONTINUED (CAT-RULE-002).
3. El sistema añade la imagen a la colección de imágenes del producto.
4. Responde `201 Created` con `Location`.

**Flujos de excepción**:
- **2a** — Producto no encontrado: `404 Not Found` con code `PRODUCT_NOT_FOUND`.
- **2b** — Producto DISCONTINUED: `409 Conflict` con code `PRODUCT_ALREADY_DISCONTINUED`.

**Postcondiciones**:
- Imagen añadida al producto.

**Reglas de negocio**: CAT-RULE-002

**Eventos emitidos**: ninguno

---

### UC-CAT-016: RemoveProductImage

**Actor principal**: Operator

**Precondiciones**:
- El producto existe y la imagen pertenece al producto.

**Flujo principal**:
1. El operador solicita eliminar la imagen por `imageId`.
2. El sistema carga el producto.
3. El sistema busca la imagen en la colección del producto.
4. El sistema elimina la imagen y responde `204 No Content`.

**Flujos de excepción**:
- **2a** — Producto no encontrado: `404 Not Found` con code `PRODUCT_NOT_FOUND`.
- **3a** — Imagen no encontrada: `404 Not Found` con code `PRODUCT_IMAGE_NOT_FOUND`.

**Postcondiciones**:
- Imagen eliminada de la colección del producto.

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

### UC-CAT-017: GetProductById

**Actor principal**: Operator

**Precondiciones**:
- El producto existe.

**Flujo principal**:
1. El operador solicita el detalle de un producto por ID.
2. El sistema retorna el producto completo incluyendo imágenes.

**Flujos de excepción**:
- **1a** — Producto no encontrado: `404 Not Found` con code `PRODUCT_NOT_FOUND`.

**Postcondiciones**: ninguna (solo lectura).

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

### UC-CAT-018: ListProducts

**Actor principal**: Operator

**Precondiciones**: ninguna.

**Flujo principal**:
1. El operador solicita el listado de productos con filtros opcionales `categoryId`, `status` y paginación.
2. El sistema retorna la página solicitada.

**Postcondiciones**: ninguna (solo lectura).

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

### UC-CAT-019: SearchProducts

**Actor principal**: Customer

**Precondiciones**: ninguna.

**Flujo principal**:
1. El cliente envía un término de búsqueda (`q`).
2. El sistema busca productos ACTIVE cuyo nombre o SKU contenga el término.
3. El sistema retorna la página de resultados.

**Postcondiciones**: ninguna (solo lectura).

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno

---

### UC-CAT-020: GetActiveProductById

**Actor principal**: Customer

**Precondiciones**:
- El producto existe y está en estado ACTIVE.

**Flujo principal**:
1. El cliente solicita el detalle de un producto por ID (storefront).
2. El sistema carga el producto y verifica que está ACTIVE (CAT-RULE-002 inverso — DISCONTINUED bloquea).
3. El sistema retorna el producto con imágenes.

**Flujos de excepción**:
- **2a** — Producto no encontrado: `404 Not Found` con code `PRODUCT_NOT_FOUND`.
- **2b** — Producto no está ACTIVE (DRAFT o DISCONTINUED): `404 Not Found` con code `PRODUCT_NOT_FOUND`.

**Postcondiciones**: ninguna (solo lectura).

**Reglas de negocio**: ninguna

**Eventos emitidos**: ninguno
