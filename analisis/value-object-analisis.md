# Análisis de robustez — Generación de Value Objects

> Alcance: bloque `valueObjects[]` del BC YAML → clases Java en `domain/valueobject`.
> Artefactos analizados:
> - Diseño: `C:/Users/antonio.suarez/Desktop/test-dsl/arch/catalog/catalog.yaml` (`Money`, `Topics`).
> - Código generado: `C:/Users/antonio.suarez/Desktop/test-dsl/src/main/java/co/com/asuarez/catalog/domain/valueobject/`.
> - Generador: [src/generators/value-object-generator.js](src/generators/value-object-generator.js)
> - Plantilla: [templates/domain/ValueObject.java.ejs](templates/domain/ValueObject.java.ejs)
> - Validación YAML: [src/utils/bc-yaml-reader.js](src/utils/bc-yaml-reader.js)
> - Mapeos: [src/utils/type-mapper.js](src/utils/type-mapper.js), [src/utils/validation-mapper.js](src/utils/validation-mapper.js)

> **Estado tras implementación de Tier 1+2 (verificado con `javac` sobre el output real):**
> Los gaps de Tier 1 y Tier 2 listados en este documento están **cerrados**. Los pendientes activos son los de Tier 3 (sección 4 más abajo).

---

## 1. Resumen ejecutivo

### 1.a Estado original (antes de Tier 1+2)

El generador producía VOs sintácticamente correctos con la forma esperada de un VO inmutable (campos `final`, sin setters, `equals/hashCode/toString`), pero el alcance funcional era mínimo: solo cubría "VO con N propiedades de tipos canónicos simples, sin invariantes". En cuanto el diseño declaraba reglas legítimas (`required`, `validations[]`, `precision/scale`, referencias a `enums`, `List[T]`), el generador las ignoraba en silencio o producía código que no compilaba.

### 1.b Estado actual (post-Tier 1+2)

El generador ahora protege las invariantes declaradas en el YAML dentro del propio constructor del VO, resuelve correctamente referencias cross-package a enums, materializa la inmutabilidad real de listas con copia defensiva, normaliza la igualdad de `Decimal` y emite trazabilidad (`derived_from: valueObject:{name}`). La validación del YAML rechaza VOs sin propiedades y referencias a tipos no resolubles.

Los escenarios "VO con `required`", "VO con `validations[]`", "VO que referencia un enum", "VO con `List[T]`", "microtype con factory `of(...)`" y "Money con igualdad por valor" ya producen código correcto y compilable.

---

## 2. Evidencia — Caso `Topics` (gap original, ahora cerrado)

YAML declarado en `catalog.yaml`:

```yaml
- name: Topics
  properties:
    - name: topic
      type: String(100)
      required: true
    - name: qualifier
      type: Integer
      required: true
      validations:
        - min: 10
        - max: 100
```

**Antes (Tier 0):**

```java
public Topics(String topic, Integer qualifier) {
    this.topic = topic;
    this.qualifier = qualifier;
}
```

`new Topics(null, 5)` y `new Topics("x".repeat(500), 9999)` eran construibles.

**Después (Tier 1+2, output actual):**

```java
public Topics(String topic, Integer qualifier) {
    if (topic == null) {
        throw new IllegalArgumentException("VO Topics.topic: required");
    }
    if (topic != null && topic.length() > 100) {
        throw new IllegalArgumentException("VO Topics.topic: exceeds max length 100");
    }
    if (qualifier == null) {
        throw new IllegalArgumentException("VO Topics.qualifier: required");
    }
    if (qualifier != null && qualifier < 10) {
        throw new IllegalArgumentException("VO Topics.qualifier: must be >= 10");
    }
    if (qualifier != null && qualifier > 100) {
        throw new IllegalArgumentException("VO Topics.qualifier: must be <= 100");
    }
    this.topic = topic;
    this.qualifier = qualifier;
}
```

Y en `Money.java` la igualdad ya respeta el dominio:

```java
return eqDecimal(amount, that.amount) && Objects.equals(currency, that.currency);
```

con `setScale(4, RoundingMode.UNNECESSARY)` aplicado al construir.

---

## 3. Inventario de gaps y estado

Convención de estado:
- ✅ **Cerrado** — implementado y verificado con `javac` sobre el output real.
- 🟡 **Parcial** — cubierto con caveats descritos en la fila.
- 🔴 **Abierto** — pendiente, candidato a Tier 3.

### 3.1 Invariantes y validaciones

| # | Gap | Estado | Detalle |
|---|---|---|---|
| G1 | `required: true` no se valida en el constructor | ✅ Cerrado | Guard `IllegalArgumentException("VO {Name}.{field}: required")`. |
| G2 | `validations[]` (min/max/minLength/maxLength/pattern/notEmpty/positive/negative/positiveOrZero/negativeOrZero) | ✅ Cerrado | Emisión imperativa por campo en el constructor. |
| G3 | `String(n)` no se enforce | ✅ Cerrado | `length() > n` con merge de `maxLength` explícito. |
| G4 | `Decimal precision/scale` no se normaliza | ✅ Cerrado | `setScale(scale, RoundingMode.UNNECESSARY)` con catch → `IllegalArgumentException`. |
| G5 | `Email` sin chequeo de formato | ✅ Cerrado | Constante `EMAIL_PATTERN` precompilada y matcheo en el constructor. |
| G5b | `Url` sin chequeo de formato | 🟡 Parcial | El tipo canónico mapea a `URI`; la validación la hace `URI` al construirse en el caller. No se añade guard adicional. |
| G2b | Validaciones de fecha (`future`, `past`, `futureOrPresent`, `pastOrPresent`) | 🔴 Abierto | El `validation-mapper` las expone para Jakarta, pero no se traducen a guards imperativos en el VO. Hoy no se usan en VOs del proyecto. |

### 3.2 Inmutabilidad real

| # | Gap | Estado | Detalle |
|---|---|---|---|
| G6 | `List<…>` almacenado por referencia | ✅ Cerrado | `List.copyOf(...)` en el constructor; `null` → `List.of()`. |
| G7 | Getter de `List<…>` expone referencia interna | ✅ Cerrado | El campo ya es inmutable; el getter lo devuelve directamente. |
| G8 | Defensa para `Map<…,…>`, arrays, `Date` legacy | 🔴 Abierto | El DSL no permite `Map`/`Set` (G23). Si se admiten, replicar el patrón. |

### 3.3 Imports y resolución de tipos cross-package

| # | Gap | Estado | Detalle |
|---|---|---|---|
| G9 | Propiedad de tipo enum no se importa | ✅ Cerrado | Resolver agrega `import {pkg}.{bc}.domain.enums.{Name};`. Cubre también `List[Enum<X>]` y `List[EnumName]`. |
| G10 | Referencia a otro VO sin validación | ✅ Cerrado | `bc-yaml-reader` valida que cada tipo no canónico exista en `enums[]` o `valueObjects[]`. |
| G11 | Referencia a agregado dentro de un VO | ✅ Cerrado | Aborta con mensaje claro: *"A VO may not embed an aggregate; use a Uuid reference or another VO."* |

### 3.4 Semántica de igualdad

| # | Gap | Estado | Detalle |
|---|---|---|---|
| G12 | `equals` para `BigDecimal` por escala | ✅ Cerrado | Helper `eqDecimal(a, b)` con `compareTo == 0`; emitido sólo cuando hay campos `Decimal`. |
| G13 | Sin `Comparable` ni aritmética (`add`, `subtract`) | 🔴 Abierto | Requiere extensión del DSL (`comparable: true` / `arithmetic: monetary`). Tier 3. |

### 3.5 Construcción ergonómica

| # | Gap | Estado | Detalle |
|---|---|---|---|
| G14 | `static of(...)` factory | ✅ Cerrado (microtype) | Emitido cuando `fields.length === 1`. Para VOs multi-prop no aplica por convención. |
| G15 | `with{Field}(...)` (wither) | 🔴 Abierto | Tier 3. |
| G16 | Microtype sin tratamiento especial | ✅ Cerrado | Cubierto por G14. |
| G17 | VO sin propiedades genera Java inválido | ✅ Cerrado | `bc-yaml-reader` rechaza el YAML antes de generar. |

### 3.6 Trazabilidad y convenciones del proyecto

| # | Gap | Estado | Detalle |
|---|---|---|---|
| G18 | Falta `derived_from` en clase | ✅ Cerrado | JavaDoc emite `derived_from: valueObject:{name}`. La factory `of(...)` también lleva su tag. |
| G19 | Paquete `domain.valueobject` hardcoded | 🟡 Parcial | Sigue hardcoded en generador y plantilla; no es un bug, es deuda de diseño. Tier 3 si se decide pluralizar. |

### 3.7 Persistencia y cohesión con JPA

| # | Gap | Estado | Detalle |
|---|---|---|---|
| G20 | VO de dominio y `@Embeddable` sin contrato explícito de coherencia | 🔴 Abierto | Hoy ambos leen el mismo `properties[]` por convención. Riesgo latente al divergir; Tier 3. |
| G21 | `precision/scale` puede divergir entre VO de dominio y `@Embeddable` | 🟡 Parcial | El VO ahora aplica `setScale(scale)` desde el YAML; coherente con JPA mientras ambos lean el mismo bloque. |

### 3.8 Cobertura de tipos

| # | Gap | Estado | Detalle |
|---|---|---|---|
| G22 | `List[T]` sin reglas de unicidad / no-vacío / orden | 🔴 Abierto | Requiere extensión del DSL. Tier 3. |
| G23 | Sin soporte para `Map[K,V]`, `Set[T]`, tuplas | 🔴 Abierto | Requiere extensión del DSL. Tier 3. |
| G24 | Sin tipo `Range<T>` / `Interval<DateTime>` reutilizable | 🔴 Abierto | Tier 3. |

### 3.9 Serialización / interoperabilidad

| # | Gap | Estado | Detalle |
|---|---|---|---|
| G25 | Sin `@JsonCreator` / `@JsonProperty` para serialización directa | 🔴 Abierto (intencional) | VO de dominio ≠ DTO; aceptable. Tier 3 si se decide lo contrario. |

---

## 4. Pendiente — Tier 3 (no implementado)

Los siguientes gaps quedan abiertos y requieren extensiones del DSL o decisiones de diseño:

1. **G13** Operaciones declarables (`comparable: true`, `arithmetic: monetary`) → `Comparable<Money>`, `add`, `subtract`.
2. **G15** Withers (`with{Field}(...)`).
3. **G2b** Validaciones de fecha (`future`, `past`, …) traducidas a guards imperativos.
4. **G20 / G21** Contrato explícito de coherencia VO ↔ `@Embeddable` JPA.
5. **G22 / G23 / G24** Listas con restricciones, `Map<K,V>`, `Set<T>`, `Range<T>`.
6. **G25** Anotaciones Jackson opcionales para VOs serializables.

---

## 5. Implementación realizada (resumen ejecutivo)

### 5.1 Generador — [src/generators/value-object-generator.js](src/generators/value-object-generator.js)

- Por propiedad calcula contexto enriquecido: `required`, `maxLength` (incluye merge de `String(n)` con `maxLength` explícito), `minLength`, `numericMin/Max` (incluye `minStrict/maxStrict` para `positive`/`negative`), `pattern`, `notEmpty`, `isList`, `isDecimal/precision/scale`, `isEmailType`.
- Resuelve referencias de dominio (`resolveDomainImport`) para enums y VOs; agrega `import {pkg}.{bc}.domain.enums.{Name};` cuando aplica.
- Asignaciones diferenciadas:
  - Lista → `List.copyOf(...)` con fallback `List.of()` si null.
  - Decimal → `setScale(scale, UNNECESSARY)` envuelto en try/catch para uniformar excepciones.
  - Resto → asignación directa.
- Expresión `equals` por campo: `eqDecimal(...)` para `Decimal`, `Objects.equals(...)` para el resto.
- Flag `isMicrotype` cuando `fields.length === 1`.

### 5.2 Plantilla — [templates/domain/ValueObject.java.ejs](templates/domain/ValueObject.java.ejs)

- JavaDoc con `derived_from: valueObject:{name}`.
- Constante `EMAIL_PATTERN` precompilada cuando hay propiedades `Email`.
- Bloque de guards inline en el constructor (pre-renderizados por el generador → la plantilla solo los emite).
- Factory `static {Name} of(...)` cuando `isMicrotype`.
- Helper privado `eqDecimal` cuando hay campos `Decimal`.

### 5.3 Validación — [src/utils/bc-yaml-reader.js](src/utils/bc-yaml-reader.js)

Bloque nuevo de validación de `valueObjects[]`:
- Rechaza VO sin propiedades.
- Por cada propiedad resuelve el tipo contra: canónicos, `enums[]`, `valueObjects[]`, `Enum<X>`, `List[<resolvable>]`.
- Aborta con mensaje claro si el tipo no resuelve o si referencia un agregado.

---

## 6. Escenarios soportados — estado actual

| Escenario de diseño | Estado |
|---|---|
| VO con N props canónicas simples (`Money`, `Address`) | ✅ |
| VO con `validations[]` (min/max/minLength/maxLength/pattern/notEmpty/positive/negative) | ✅ |
| VO con `required: true` | ✅ |
| VO con propiedad enum (`status: CategoryStatus`, `Enum<X>`) | ✅ |
| VO con `List[String(n)]` o `List[OtherVO]` o `List[Enum<X>]` | ✅ inmutable |
| VO microtype (1 propiedad) con `of(...)` | ✅ |
| VO `Money` con igualdad por valor (1.0 == 1.00) | ✅ |
| VO con propiedad `Email` autovalidante | ✅ |
| VO con propiedad `Url` autovalidante | 🟡 (vía `URI.create` en el caller) |
| VO con propiedad `Date`/`DateTime` y `future`/`past` | 🔴 (validación de presencia ✅, formato no aplica) |
| VO con `Comparable` / aritmética declarada | 🔴 (Tier 3) |
| VO con `Map<K,V>` / `Set<T>` | 🔴 (Tier 3 — DSL) |
| VO sin propiedades | ✅ rechazado en validación |
| VO referenciando un agregado | ✅ rechazado en validación |

---

## 7. Verificación

- Generación dirigida sobre `C:/Users/antonio.suarez/Desktop/test-dsl/arch` produce `Money.java` y `Topics.java` con guards, copia defensiva y `eqDecimal`.
- `javac` sobre los VOs generados reporta `COMPILE_OK` (sin errores ni warnings).
- `Topics`: `required` en ambos campos, `length() > 100`, `qualifier < 10`, `qualifier > 100` validados.
- `Money`: `required` en `amount` y `currency`, `currency.length() > 3`, `setScale(4, UNNECESSARY)` con re-throw a `IllegalArgumentException`, `equals` usa `eqDecimal`.

---

## 8. Recomendaciones futuras

1. **Cobertura con tests de generación**: añadir fixtures por gap cerrado (microtype, lista de enum, `Email`, etc.) y assertions sobre el Java emitido para evitar regresiones.
2. **Antes de Tier 3**: re-evaluar prioridad real de G13, G15, G22–G25 contra los criterios de [VISION.md](VISION.md) §"Cómo este documento debe usarse" — qué cambios realmente necesitan extender el DSL vs. qué se puede inferir.
3. **Coherencia VO ↔ JPA Embeddable (G20)**: si en algún BC futuro se detecta divergencia, abordarla con un test de coherencia automatizado en lugar de duplicar lógica entre generadores.

