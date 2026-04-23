# Especificación del Sistema — Canasta Shop
> Plataforma B2C de venta de productos de canasta familiar

---

## BC: catalog

### Propósito
Gestionar el catálogo de productos de canasta familiar — sus categorías, precios y estado de disponibilidad — siendo la fuente autoritativa de datos de producto en toda la plataforma.

### Responsabilidades
- Crear, editar y publicar productos con nombre, descripción, imágenes y precio
- Organizar productos en categorías jerárquicas (ej: Lácteos, Frutas y Verduras, Limpieza)
- Gestionar el ciclo de vida del producto: DRAFT → ACTIVE → DISCONTINUED
- Publicar eventos cuando un producto cambia de precio o estado
- Exponer búsqueda y filtrado de productos al canal de ventas

### No Responsabilidades
- No controla el stock disponible — eso es responsabilidad de **inventory**
- No gestiona precios de promoción ni cupones — fuera del alcance de V1
- No procesa pedidos ni pagos

### Lenguaje Ubícuo
| Término | Definición en este BC |
|---------|----------------------|
| Product | Artículo de canasta familiar vendible en la plataforma |
| Category | Agrupación temática de productos (ej: Lácteos, Higiene) |
| ProductImage | Imagen asociada a un producto, con orden de visualización |
| ACTIVE | Estado que indica que el producto está visible y disponible para compra |
| DISCONTINUED | Estado que indica que el producto fue retirado del catálogo definitivamente |

### Agregados Principales
| Agregado | Root | Entidades internas |
|----------|------|-------------------|
| Product | Product | ProductImage |
| Category | Category | — |

### Dependencias Externas
Ninguna

---

## BC: orders

### Propósito
Gestionar el ciclo de vida completo del pedido — desde el carrito hasta la confirmación de entrega — siendo el orquestador del flujo de checkout y la fuente de verdad del estado del pedido.

### Responsabilidades
- Gestionar el carrito de compras (agregar, modificar y eliminar ítems)
- Ejecutar el checkout: calcular totales usando el CatalogSnapshot local y crear el Order
- Coordinar el flujo de pago y reserva de stock a través de eventos (CheckoutSaga)
- Mantener el historial de estados del pedido (PLACED → CONFIRMED → DELIVERED / CANCELLED)
- Registrar OrderLine.unitPrice como snapshot inmutable al momento de crear el pedido
- Mantener un CatalogSnapshot (Local Read Model) con precios vigentes alimentado por eventos de catalog
- Cerrar el ciclo del pedido al recibir el evento de entrega confirmada

### No Responsabilidades
- No procesa pagos — eso es responsabilidad de **payments**
- No gestiona despacho ni asignación de repartidor — eso es **delivery**
- No valida stock directamente — lo hace **inventory** en respuesta a eventos

### Lenguaje Ubícuo
| Término | Definición en este BC |
|---------|----------------------|
| Cart | Cesta temporal de productos antes de formalizar el pedido |
| CartItem | Producto con cantidad dentro del carrito |
| Order | Pedido formalizado e inamovible una vez confirmado |
| OrderLine | Línea de ítem en el pedido con precio unitario congelado al momento de la compra |
| CatalogSnapshot | Copia local de precios de catálogo, actualizada por eventos, usada para calcular totales |
| Checkout | Proceso de transformar el Cart en un Order y disparar el saga de pago |

### Agregados Principales
| Agregado | Root | Entidades internas |
|----------|------|-------------------|
| Cart | Cart | CartItem |
| Order | Order | OrderLine, OrderStatusHistory |
| CatalogSnapshot | CatalogSnapshot | — |

### Dependencias Externas
Ninguna directa. Consume eventos de `catalog`, `inventory` y `payments`.

---

## BC: customers

### Propósito
Gestionar perfiles de clientes, autenticación y direcciones de entrega registradas.

### Responsabilidades
- Registro e inicio de sesión de clientes
- Gestión de datos de perfil (nombre, email, teléfono)
- Gestión de direcciones de entrega guardadas (agregar, editar, eliminar)
- Gestión de sesiones activas

### No Responsabilidades
- No gestiona el historial de pedidos — eso es responsabilidad de **orders**
- No maneja autorización a recursos del sistema (ej: backoffice) — fuera de V1
- No gestiona programas de fidelización ni puntos

### Lenguaje Ubícuo
| Término | Definición en este BC |
|---------|----------------------|
| Customer | Consumidor final registrado en la plataforma |
| Address | Dirección de entrega guardada por el cliente |
| Session | Sesión autenticada activa de un cliente |

### Agregados Principales
| Agregado | Root | Entidades internas |
|----------|------|-------------------|
| Customer | Customer | Address |
| Session | Session | — |

### Dependencias Externas
Ninguna

---

## BC: inventory

### Propósito
Controlar el stock disponible de cada producto, reservando unidades cuando se realiza un pedido y liberándolas cuando se cancela.

### Responsabilidades
- Crear un StockItem al recibir el evento ProductActivated de catalog
- Cerrar permanentemente el StockItem al recibir ProductDiscontinued
- Reservar stock cuando recibe OrderPlaced (emite StockReserved o StockReservationFailed)
- Liberar stock cuando recibe OrderCancelled
- Registrar movimientos de stock (entradas manuales, reservas, liberaciones)

### No Responsabilidades
- No gestiona la información descriptiva del producto — eso es **catalog**
- No genera pedidos de reabastecimiento automáticos — fuera de V1
- No decide si un pedido avanza o no — solo informa el resultado de la reserva

### Lenguaje Ubícuo
| Término | Definición en este BC |
|---------|----------------------|
| StockItem | Unidad de control de stock asociada a un producto de catálogo |
| StockMovement | Registro auditable de un cambio en el nivel de stock |
| StockReserved | Evento que indica que las unidades requeridas por un pedido fueron reservadas exitosamente |
| StockReservationFailed | Evento que indica que no hay stock suficiente para el pedido |
| StockReleased | Evento que indica que las unidades reservadas fueron liberadas por cancelación |

### Agregados Principales
| Agregado | Root | Entidades internas |
|----------|------|-------------------|
| StockItem | StockItem | StockMovement |

### Dependencias Externas
Ninguna. Reacciona a eventos de `catalog` y `orders`.

---

## BC: payments

### Propósito
Procesar cobros con tarjeta a través de una pasarela externa y registrar intenciones de pago en efectivo contra entrega. Mantiene un Local Read Model del monto de cada pedido para operar de forma autónoma.

### Responsabilidades
- Mantener OrderAmountSnapshot (Local Read Model) con el monto total de cada pedido, alimentado por el evento OrderPaymentRequired de orders
- Procesar cobros con tarjeta delegando a la pasarela de pago externa (ACL)
- Registrar la intención de pago en efectivo contra entrega
- Registrar intentos de pago (exitosos y fallidos)
- Emitir PaymentApproved o PaymentFailed al finalizar el intento
- Gestionar reembolsos en caso de cancelación post-cobro

### No Responsabilidades
- No valida ni calcula el monto a cobrar — lo toma del OrderAmountSnapshot local
- No gestiona devoluciones de productos — fuera de V1
- No emite facturas — fuera de V1

### Lenguaje Ubícuo
| Término | Definición en este BC |
|---------|----------------------|
| Payment | Registro del proceso de cobro asociado a un pedido |
| PaymentAttempt | Intento individual de cobro (puede haber más de uno por Payment) |
| OrderAmountSnapshot | Copia local del monto total del pedido, mantenida para independencia operativa |
| Cash on Delivery | Modalidad de pago en efectivo al momento de la entrega física |

### Agregados Principales
| Agregado | Root | Entidades internas |
|----------|------|-------------------|
| Payment | Payment | PaymentAttempt |
| OrderAmountSnapshot | OrderAmountSnapshot | — |

### Dependencias Externas
| Sistema | Tipo de integración | Descripción |
|---------|--------------------|----|
| payment-gateway | ACL / HTTP | Delega cobros y reembolsos con tarjeta al procesador externo |

---

## BC: delivery

### Propósito
Gestionar las órdenes de entrega a domicilio ejecutadas por la flota propia de la empresa, desde la asignación del repartidor hasta la confirmación de entrega.

### Responsabilidades
- Crear una DeliveryOrder al recibir el evento OrderConfirmed de orders
- Asignar un repartidor disponible a la orden de entrega
- Registrar el historial de estados de la entrega (PENDING → ASSIGNED → IN_TRANSIT → DELIVERED)
- Cancelar la entrega si se recibe OrderCancelled antes de que inicie el despacho
- Emitir eventos de cambio de estado para que notifications informe al cliente

### No Responsabilidades
- No gestiona rutas de reparto ni optimización logística — fuera de V1
- No controla el pago (incluyendo el cobro en efectivo en la puerta) — eso es **payments**
- No gestiona flota de vehículos ni mantenimiento

### Lenguaje Ubícuo
| Término | Definición en este BC |
|---------|----------------------|
| DeliveryOrder | Orden de entrega física asignada a un repartidor para un pedido confirmado |
| DeliveryDriver | Repartidor de la flota propia habilitado para recibir asignaciones |
| DeliveryStatusHistory | Registro cronológico de los cambios de estado de la entrega |

### Agregados Principales
| Agregado | Root | Entidades internas |
|----------|------|-------------------|
| DeliveryOrder | DeliveryOrder | DeliveryStatusHistory |
| DeliveryDriver | DeliveryDriver | — |

### Dependencias Externas
Ninguna. Reacciona a eventos de `orders`.

---

## BC: notifications

### Propósito
Despachar notificaciones transaccionales (email, SMS, push) al cliente en respuesta a eventos clave del ciclo de vida del pedido y la entrega.

### Responsabilidades
- Recibir eventos de `orders` y `delivery` y mapearlos a plantillas de notificación
- Seleccionar el canal de envío apropiado (email / SMS / push) según las preferencias del cliente
- Registrar el historial de notificaciones enviadas
- Gestionar plantillas de mensajes por tipo de evento

### No Responsabilidades
- No genera lógica de negocio propia — solo formatea y despacha mensajes
- No decide cuándo enviar una notificación — eso lo determina el evento recibido
- No gestiona notificaciones de marketing o campañas — fuera de V1

### Lenguaje Ubícuo
| Término | Definición en este BC |
|---------|----------------------|
| Notification | Registro de una notificación enviada a un cliente |
| NotificationTemplate | Plantilla de mensaje para un tipo de evento específico |

### Agregados Principales
| Agregado | Root | Entidades internas |
|----------|------|-------------------|
| Notification | Notification | — |
| NotificationTemplate | NotificationTemplate | — |

### Dependencias Externas
Ninguna declarada en V1 (el canal de envío puede ser una librería interna o un proveedor HTTP — a definir en Paso 2).

---

## Mapa de Integraciones — Resumen

```
[Customer] ──────────────────────────────────────────────────────────────┐
                                                                         │
catalog ──ProductActivated/Discontinued──► inventory                     │
catalog ──ProductPriceChanged/Activated/Discontinued──► orders           │
                                           (CatalogSnapshot LRM)         │
                                                                         │
[Customer] → orders (cart / checkout)                                    │
orders ──OrderPlaced/Cancelled──► inventory                              │
inventory ──StockReserved/Failed/Released──► orders                      │
orders ──OrderPaymentRequired/Cancelled──► payments                      │
                                           (OrderAmountSnapshot LRM)     │
payments ──PaymentApproved/Failed──► orders                              │
payments ──processCardPayment──► [payment-gateway] (ACL/HTTP)            │
                                                                         │
orders ──OrderConfirmed/Cancelled──► delivery                            │
delivery ──OrderDelivered──► orders                                      │
                                                                         │
orders ──OrderConfirmed/Cancelled──► notifications                       │
delivery ──DeliveryAssigned/OrderDelivered──► notifications              │
                                                                         │
[Customer] ◄── email/SMS/push ── notifications                          │
```

**CheckoutSaga:** OrderPlaced → StockReserved → PaymentApproved → OrderConfirmed
(compensaciones: StockReservationFailed → OrderCancelled | PaymentFailed → StockReleased + OrderCancelled)
