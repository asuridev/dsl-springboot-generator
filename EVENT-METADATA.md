# Estructura de metadata en eventos de Kafka

## Resumen

Los eventos que el código generado publica al broker de Kafka llevan **dos bloques `metadata` anidados**, uno en el sobre externo y otro dentro de `data`. Esto es **intencional**: cada capa cubre una preocupación distinta.

- La `metadata` **externa** describe el **transporte** (el sobre del mensaje en el broker).
- La `metadata` **interna** (`data.metadata`) describe el **dominio** (el hecho de negocio canónico).

---

## Capa externa — sobre de transporte (`EventEnvelope`)

Es la preocupación de **infraestructura / integración**: identifica el mensaje en el broker, lo enruta y registra cuándo el servicio lo emitió. Es lo que ven los consumidores externos a nivel de transporte.

- **Origen:** `templates/shared/eventEnvelope/EventMetadata.java.ejs`
- **Ensamblado en:** `templates/messaging/KafkaMessageBroker.java.ejs` vía `EventEnvelope.of(...)`

| Campo | Significado |
|---|---|
| `eventId` | Identificador del mensaje en el broker (`UUID.randomUUID()`). |
| `eventType` | Nombre del **canal/topic** en notación punteada, p. ej. `catalog.product.discontinued` (proviene del AsyncAPI). |
| `timestamp` | Cuándo **salió** el mensaje al broker. |
| `correlationId` | Tomado del MDC para tracing entre servicios. |
| `source` | Servicio/app que publicó, p. ej. `canasta-familiar-api`. |

---

## Capa interna — metadata canónica del evento de dominio (`data.metadata`)

Es la preocupación de **dominio / negocio**: captura el hecho en sí, su versión de schema, cuándo ocurrió realmente dentro del agregado y la cadena de causalidad.

- **Origen:** `templates/shared/domain/EventMetadata.java.ejs`
- **Inyectada en:** `src/generators/aggregate-generator.js`, con `EventMetadata.now(...)` durante el `raise(...)` del agregado.

| Campo | Significado |
|---|---|
| `eventId` | Identificador de la instancia del evento de dominio (`UUID.randomUUID()`). |
| `eventType` | Nombre de la **clase** del evento de dominio, p. ej. `ProductDiscontinued`. |
| `eventVersion` | Versión del schema del evento (default `1`). |
| `occurredAt` | Cuándo **ocurrió** el hecho dentro del agregado. |
| `sourceBc` | Bounded context que originó el evento, p. ej. `catalog`. |
| `correlationId` | Cadena de tracing (puede venir del MDC o `null`). |
| `causationId` | Evento que causó este evento (cadena de causalidad). |

---

## Diferencia de roles

| | Externa (`metadata`) | Interna (`data.metadata`) |
|---|---|---|
| **Preocupación** | Transporte / broker | Dominio / negocio |
| **`eventType`** | Canal: `catalog.product.discontinued` | Clase: `ProductDiscontinued` |
| **Momento** | Cuándo se **envió** (`timestamp`) | Cuándo **ocurrió** (`occurredAt`) |
| **Origen** | App/servicio (`source`) | Bounded context (`sourceBc`) |
| **Versionado** | — | `eventVersion` |
| **Causalidad** | — | `correlationId` / `causationId` |

La intención del diseño es que el **modelo de dominio pueda evolucionar independientemente** del formato de serialización del broker, y mantener tracing/routing fuera de la lógica de negocio.

---

## Ejemplo

```jsonc
{
    "metadata": {                                    // ← sobre de transporte (EventEnvelope)
        "eventId": "22556313-b5a7-488c-9f55-abdfe49ca7f9",
        "eventType": "catalog.product.discontinued", // nombre del CANAL/topic
        "timestamp": "2026-06-27T11:41:47.5155983",  // cuándo se ENVIÓ
        "correlationId": "288ea0e4-f7ca-4f0c-bd77-9804b1d59c01",
        "source": "canasta-familiar-api"             // servicio publicador
    },
    "data": {
        "metadata": {                                // ← evento de dominio canónico
            "eventId": "6175f0d4-75ab-4e42-8f2c-09410505e803",
            "eventType": "ProductDiscontinued",      // nombre de la CLASE
            "eventVersion": 1,
            "occurredAt": "2026-06-27T16:41:47.490901100Z", // cuándo OCURRIÓ
            "sourceBc": "catalog",                   // bounded context
            "correlationId": null,
            "causationId": null
        },
        "productId": "54a2a49b-2153-4d44-8e61-fd0de1ca980b", // payload del evento
        "sku": "LECHE-1L"
    }
}
```

---

## ¿Son necesarias ambas?

Es una **decisión de diseño, no una obligación**. Existe solape conceptual entre las dos capas: `eventId`, `eventType` (en dos formas), `correlationId` y el tiempo (`timestamp` / `occurredAt`).

- **A favor de mantener ambas:** la externa es un contrato de integración estándar (envelope/transport) y la interna es el evento canónico versionado — separación limpia entre transporte y dominio.
- **En contra:** para muchos sistemas puede ser sobre-ingeniería; un solo sobre basta y la metadata duplicada puede confundir a los consumidores.

El generador permite **desactivar la capa interna** con el flag de configuración:

```yaml
config:
  events:
    metadata:
      enabled: false
```

Ver `src/commands/build.js`. Con `enabled: false`, los eventos de dominio e integración no llevan la metadata interna, pero el sobre externo (`EventEnvelope`) se sigue generando para el transporte.
