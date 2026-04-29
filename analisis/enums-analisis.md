# Análisis de robustez — sección `enums`

> Fecha: 2026-04-29
> Diseño analizado: `C:/Users/antonio.suarez/Desktop/test-dsl/arch/catalog/catalog.yaml`
> Código analizado: `C:/Users/antonio.suarez/Desktop/test-dsl/src/main/java/co/com/asuarez/catalog/domain/enums/`
> Generador: [src/generators/enum-generator.js](src/generators/enum-generator.js), template [templates/domain/Enum.java.ejs](templates/domain/Enum.java.ejs)

---

## 1. Contrato actual del generador

### 1.1 YAML que el generador entiende

```yaml
enums:
  - name: <PascalCase>            # obligatorio
    description: <texto>          # opcional → Javadoc de la clase
    values:
      - value: <SCREAMING_SNAKE>  # obligatorio
        description: <texto>      # IGNORADO por el generador
        transitions:              # opcional
          - to: <SCREAMING_SNAKE> # único campo consumido
            triggeredBy: <...>    # IGNORADO
            condition: <RULE-ID>  # IGNORADO
            rules: [<RULE-ID>]    # IGNORADO
            emits: <EventName>    # IGNORADO
```

### 1.2 Java que el generador produce

- Clase `enum` en `domain/enums/<Name>.java`.
- Constantes en orden de declaración.
- Si **algún** valor tiene `transitions` no vacío:
  - Mapa estático `VALID_TRANSITIONS = Map.ofEntries(...)` con una entrada **por cada** valor (estados terminales → `Set.of()` vacío).
  - Método `canTransitionTo(target)` → boolean.
  - Método `transitionTo(target)` → lanza `InvalidStateTransitionException(currentState, target)` si no es válida.
- Si ningún valor tiene transiciones → enum plano sin métodos.

### 1.3 Verificación contra el output real

`ProductStatus` y `CategoryStatus` se generaron correctamente: constantes, mapa estable, terminal `DISCONTINUED` con `Set.of()` vacío, transiciones reflejas (`ACTIVE↔INACTIVE`) presentes. **Determinismo y forma básica: OK.**

---

## 2. Escenarios soportados HOY

| # | Escenario | Soporte |
|---|---|---|
| 1 | Enum de clasificación simple (sin `transitions`) | ✅ |
| 2 | Enum de ciclo de vida con transiciones lineales | ✅ |
| 3 | Estado terminal sin salidas (`transitions: []`) | ✅ |
| 4 | Transiciones bidireccionales (`A↔B`) | ✅ |
| 5 | Múltiples transiciones desde un mismo estado | ✅ |
| 6 | Deduplicación de transiciones con mismo `to` | ✅ (`includes` en template) |
| 7 | Enums sin descripción | ✅ |

---

## 3. Gaps detectados

A continuación los huecos ordenados por **impacto en la cobertura de diseños posibles**.

> **Nota de alcance.** Los gaps de esta sección se evaluaron originalmente mirando sólo `domain/enums/`. Tras revisar el método `Product.activate()` del aggregate, se confirma que parte de la trazabilidad y la emisión de eventos **sí** se generan — pero en el aggregate, no en el enum. G-2 y G-3 se reescriben en consecuencia y bajan de severidad.

### 3.1 — CRÍTICOS (afectan corrección semántica del código generado)

#### G-1. La excepción de transición inválida pierde el `errorCode` declarado en `domainRules`

`PRD-RULE-004` declara `errorCode: PRODUCT_ALREADY_DISCONTINUED` para “cualquier transición desde DISCONTINUED”. El enum generado sin embargo lanza siempre la genérica `InvalidStateTransitionException(this.name(), target.name())`, sin el `errorCode` específico.

Consecuencia: el handler global de errores no puede mapear esto a un código HTTP/respuesta estable, y se pierde la trazabilidad del contrato.

**Subsanación:**
- Permitir que cada estado declare opcionalmente `terminalErrorCode` (o derivar de `domainRules` con `type: stateGuard`).
- O bien que cada `transition` declare un `errorCode` para el caso “transición no permitida”.
- El template debería invocar `new InvalidStateTransitionException(currentState, target, errorCode)`.

---

### 3.2 — ALTOS (impactan cobertura de diseños)

#### G-2 (revisado). Trazabilidad de `condition` / `rules` en el aggregate: incompleta

**Hallazgo corregido.** Contrario a lo afirmado en la primera versión de este análisis, el generador **sí** materializa la trazabilidad de las reglas de transición — pero en el método de negocio del aggregate, no en el enum. Ejemplo real generado:

```java
/** derived_from: UC-PRD-006 ActivateProduct */
public void activate() {
    // TODO: implement business logic — ver catalog-flows.md
    // Validate: PRD-RULE-001, PRD-RULE-002
    raise(new ProductActivatedEvent(this.getId(), this.getName(), ...));
}
```

Esto es semánticamente correcto: el guardián de invariantes es el aggregate, no el enum. La Fase 3 recibe una indicación clara de qué reglas implementar.

Quedan, sin embargo, refinamientos pendientes:

- **G-2.a** — El comentario `// Validate: PRD-RULE-001, PRD-RULE-002` lista IDs sin descripción ni `errorCode`. La Fase 3 debe abrir el YAML para entender cada regla. Más útil:
  ```java
  // Validate (ver catalog-flows.md):
  //   PRD-RULE-001 [gate]    PRODUCT_NAME_ALREADY_EXISTS — Name uniqueness on activation
  //   PRD-RULE-002           PRODUCT_SKU_ALREADY_EXISTS  — SKU uniqueness on activation
  ```

- **G-2.b** — El YAML distingue `condition` (gate de la transición) de `rules` (conjunto evaluado en el UC). En el comentario actual ambos roles se mezclan, perdiendo la semántica de “gate vs side-effect”. Marcar el gate explícitamente con `[gate]` resuelve esto.

- **G-2.c** — El método no contiene la llamada al transition del enum. El generador conoce la transición destino (`emits: ProductActivated` ⇒ `to: ACTIVE`) y podría emitir automáticamente:
  ```java
  this.status = this.status.transitionTo(ProductStatus.ACTIVE);
  ```
  La Fase 3 sólo añadiría la validación de reglas. Hoy ese paso queda implícito en el `// TODO`, con riesgo de omitirse.

- **G-2.d** — Orden de operaciones inseguro. El `raise(ProductActivatedEvent)` se generó **fuera** del `// TODO`. Si la Fase 3 olvida añadir la guarda antes, el evento se publica aunque la transición sea inválida. Orden seguro:
  ```java
  // TODO: validate PRD-RULE-001 (gate), PRD-RULE-002
  this.status = this.status.transitionTo(ProductStatus.ACTIVE);   // protege grafo
  raise(new ProductActivatedEvent(...));                          // sólo si transición OK
  ```

#### G-3 (revisado). Trazabilidad de `emits` en el aggregate: presente, con orden cuestionable

**Hallazgo corregido.** El generador **sí** emite el evento declarado en `emits:` desde el método de negocio del aggregate (`raise(new ProductActivatedEvent(...))`). La duplicación de fuente de verdad que se reportaba en la primera versión no existe.

Lo que sí queda pendiente — y es el mismo punto que G-2.d — es el **orden** del `raise(...)` respecto al bloque `// TODO`: hoy se publica antes de que la Fase 3 haya tenido oportunidad de validar la transición y las reglas. Subsanación = la propuesta de G-2.c + G-2.d (transición primero, evento después, dentro del bloque protegido).

#### G-4. No se soporta persistencia diferenciada (`code` ≠ nombre Java)

Patrón muy común: el nombre Java es `PENDING_PAYMENT` pero la columna BD/contrato API guarda `"pending_payment"` o `"P"`. Hoy es imposible declararlo.

**Subsanación:** soportar en YAML
```yaml
- value: PENDING_PAYMENT
  code: P
  label: "Pending payment"
```
Y generar campo `code`, `label`, constructor privado, getters, y método `fromCode(String)`.

#### G-5. No se soporta `default` declarativo a nivel de enum

Hoy el default vive en el aggregate (`defaultValue: ACTIVE`). Si dos agregados usan el mismo enum con el mismo default, la información se duplica. Conveniente: `defaultValue:` a nivel del enum como fallback.

#### G-6. No se soporta marcar valores `deprecated`

Cuando un valor se retira pero debe permanecer por compatibilidad con datos persistidos:
```yaml
- value: LEGACY_DRAFT
  deprecated: true
  replacedBy: DRAFT
```
Hoy no hay forma. Debe traducirse a `@Deprecated` y omitirse de `VALID_TRANSITIONS` para nuevos flujos.

#### G-7. Pierde el `description` por valor

El YAML lleva descripción por cada valor (e incluso por transición). Se descarta. Debería emitirse como Javadoc encima de cada constante:
```java
/** Product is being prepared; not visible to customers. */
DRAFT,
```
Es información de diseño valiosa para humanos leyendo el código.

#### G-8. Falta helper `isTerminal()`

Patrón frecuente en código de aplicación. Trivial de derivar: `VALID_TRANSITIONS.get(this).isEmpty()`. Hoy el consumidor debe duplicar la lógica.

#### G-9. Falta helper `allowedTargets()` / `Set<X> reachableStates()`

Útil para construir UI dinámica (qué botones de acción mostrar). Trivial de exponer.

---

### 3.3 — MEDIOS (calidad y consistencia)

#### G-10. No hay validación de integridad referencial en transiciones

Si el YAML declara `to: PRROCESSED` (typo), el generador produce código que **no compila** (`ProductStatus.PRROCESSED` no existe), pero sin un mensaje del DSL que apunte al error en el YAML. Debería validarse en el reader/validador.

#### G-11. No hay validación de `triggeredBy` apuntando a use cases existentes

Si `triggeredBy: UC-PRD-006` referencia un UC inexistente en el mismo BC YAML, el generador no detecta la inconsistencia.

#### G-12. No hay validación de `emits` apuntando a eventos declarados

`emits: ProductActivated` debería existir en `domainEvents` o `events`. Sin chequeo cruzado, los YAMLs y AsyncAPI se desalinean silenciosamente.

#### G-13. No hay validación de `condition`/`rules` apuntando a `domainRules` existentes

Mismo problema. El reader debería rechazar referencias a `RULE-ID` no declarados.

#### G-14. No se emiten comentarios `// derived_from:` requeridos por AGENTS.md §3

La regla #3 de AGENTS.md exige trazabilidad obligatoria. El enum generado no contiene comentarios `derived_from` aunque la información está disponible (`triggeredBy`, `rules`).

#### G-15. Sin guard contra valores duplicados

Si por error el YAML declara dos veces `value: ACTIVE`, el código generado es Java inválido. Sin error amigable.

#### G-16. Sin guard contra lista de valores vacía

`enums: [{ name: Foo, values: [] }]` produce un enum sin constantes (Java válido pero inservible) sin advertencia.

#### G-17. Sin guard contra reserved keywords / valores no SCREAMING_SNAKE

`value: new` o `value: lowercase` rompen la convención y, en el caso de keywords, no compilan.

---

### 3.4 — BAJOS (extensibilidad futura)

#### G-18. No soporta enums con propiedades arbitrarias

Patrón rico:
```yaml
- value: MAIN
  properties:
    sortOrder: 1
    requiresApproval: false
```
Útil cuando el enum lleva metadatos estables. Hoy imposible.

#### G-19. No soporta enums “API-only” vs “Domain”

Algunos enums sólo viven en DTOs (filtros, sort orders) y no pertenecen a `domain/enums`. No hay forma de declarar `scope: api`.

#### G-20. No soporta i18n / messageKey por valor

Para etiquetas user-facing.

#### G-21. No genera `@Converter` JPA cuando el enum requiere persistirse por `code` y no por `name()`

Dependiente de G-4.

#### G-22. Sin estrategia para enums que cambian su grafo según contexto

Un mismo `OrderStatus` puede tener transiciones diferentes para Order Físico vs Digital. El modelo actual asume un único grafo por enum. Resolución: out-of-scope o vía sub-enums.

#### G-23. Self-transitions intencionales

`A → A` (idempotente, p.ej. “re-activar lo activo”) hoy hay que declararlo explícitamente; el generador lo soporta, pero no hay convención sobre si debe ser permitido por defecto. Documentar.

---

## 4. Resumen ejecutivo

| Área | Cobertura actual | Gap principal |
|---|---|---|
| Forma básica del enum | Sólida | — |
| Ciclo de vida (grafo en enum + reglas en aggregate) | Funcional con refinamientos | G-1, G-2.a–d |
| Persistencia / contratos externos | Inexistente | G-4, G-21 |
| Trazabilidad (AGENTS.md §3) | Parcial: presente en aggregate, ausente en enum | G-7, G-14 |
| Validación cruzada con otras secciones del YAML | Inexistente | G-10..G-13 |
| Robustez frente a YAML mal formado | Débil | G-15, G-16, G-17 |
| Riqueza expresiva (metadatos por valor) | Limitada | G-18, G-20 |

### Prioridad recomendada de implementación

1. **G-10..G-13** — validaciones cruzadas en el reader. Coste bajo, evita generar código incorrecto silenciosamente.
2. **G-1** — `errorCode` específico en `InvalidStateTransitionException`. Alto impacto en contratos de error.
3. **G-2.c + G-2.d** — generar la llamada a `transitionTo(...)` en el método de negocio del aggregate y reordenar el `raise(...)` para que quede después del `// TODO` y de la transición. Coste bajo, cierra un agujero de seguridad real.
4. **G-2.a + G-2.b** — enriquecer el comentario `// Validate:` con descripción, `errorCode` y marca `[gate]`. Cumple AGENTS.md §3 y reduce la dependencia del YAML en Fase 3.
5. **G-7, G-14** — Javadoc por valor en el enum + comentarios `derived_from` en transiciones. Cumplimiento completo de AGENTS.md §3.
6. **G-4 / G-21** — soporte `code`/`label` + `@Converter` JPA. Habilita la mayoría de diseños reales con persistencia/API estables.
7. Resto — incrementos opcionales.

### Decisiones que requieren confirmación del humano (AGENTS.md §“Cuándo notificar al usuario”)

- ¿Se acepta que el generador emita automáticamente `this.status = this.status.transitionTo(<TARGET>)` en los métodos de negocio del aggregate, derivando `<TARGET>` del campo `emits` de la transición? (G-2.c)
- ¿La estrategia de persistencia por defecto es `EnumType.STRING` con `name()`, o se introduce `code` (G-4)?
- ¿Se acepta extender el schema YAML con `code`, `label`, `deprecated`, `defaultValue` a nivel enum? Si sí, hay que actualizar [docs/bc-yaml-guide.md](docs/bc-yaml-guide.md).
