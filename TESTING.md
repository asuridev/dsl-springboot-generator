# Testing — dsl-springboot-generator

## Estructura

```
test/
├── runner.js                  ← CLI del runner
├── utils/
│   └── scenario-runner.js     ← lógica de ejecución, assertions y diff
└── scenarios/
    ├── .gitignore
    └── {scenario-name}/
        ├── scenario.json          ← metadatos del escenario
        ├── dsl-springboot.json    ← config del generator (packageName, java, db…)
        ├── assertions.json        ← comprobaciones de contenido sobre archivos específicos
        ├── arch/                  ← fixtures YAML de entrada (system.yaml + bc YAMLs)
        └── expected/              ← golden files del output generado (src/main/java/)
```

---

## Comandos

```bash
# Correr todos los escenarios
npm test

# Correr un escenario concreto
npm run test:scenario -- ext-full

# Ver el stdout/stderr del build durante la ejecución
npm run test:verbose

# Aceptar el output generado como golden files (ver sección Flujo de aceptación)
npm run test:accept
npm run test:accept -- --scenario ext-full
```

---

## Cómo funciona un escenario

1. El runner lee `scenario.json` para saber si el escenario espera éxito o fallo.
2. Copia `arch/` y `dsl-springboot.json` a un directorio temporal del SO.
3. Ejecuta `bin/dsl-springboot.js build --strict` en ese directorio (**proceso hijo** — nunca termina el propio runner).
4. Si el build falla con exit code ≠ 0: **FAIL** (a menos que `expectFailure: true`).
5. Verifica las **assertions** declaradas en `assertions.json`.
6. Compara el `src/main/java/` generado contra los golden files en `expected/`.
7. Limpia el directorio temporal.

---

## Flujo de primer escenario (crear golden files)

Al crear un escenario nuevo, `expected/` no existe todavía. Pasos:

```bash
# 1. Primera ejecución — el build debe pasar, las assertions deben cumplirse
npm run test:scenario -- mi-escenario
# → "ℹ No expected/ directory — run with --accept to create golden files"

# 2. Inspeccionar el output manualmente (opcional — usa --verbose para ver el path del temp)
npm run test:verbose -- --scenario mi-escenario

# 3. Aceptar el output como golden files
npm run test:accept -- --scenario mi-escenario
# → "✓ ACCEPTED  (N files → expected/)"

# 4. Revisar el diff en git y confirmar que todo es correcto
git diff test/scenarios/mi-escenario/expected/
git add test/scenarios/mi-escenario/expected/
```

---

## Flujo de actualización de golden files

Cuando un cambio intencional en los templates modifica el output esperado:

```bash
# 1. Si el cambio afecta algún pattern de assertions.json, actualízalo manualmente primero

# 2. Re-aceptar el escenario (emptyDir + copia del nuevo output)
npm run test:accept -- --scenario ext-full

# 3. Revisar el diff en git — solo deben aparecer los cambios esperados
git diff test/scenarios/ext-full/expected/
```

> **Importante:** el `--accept` **no ocurre** si alguna assertion falla.
> Corrige primero `assertions.json` y luego acepta.

---

## assertions.json

Comprueba la **presencia o ausencia de texto exacto** en archivos generados concretos.
Es más ligero que el diff completo y da errores de regresión descriptivos.

```json
{
  "src/main/java/com/test/.../FooDto.java": {
    "_comment": "Descripción opcional del propósito de este bloque",
    "contains": [
      "public record FooDto(",
      "BigDecimal amount",
      "import java.math.BigDecimal"
    ],
    "notContains": [
      "Object amount",
      "class FooDto"
    ]
  }
}
```

| Campo | Descripción |
|---|---|
| `contains` | Cada string debe estar presente en el archivo. Si falta → FAIL. |
| `notContains` | Cada string no debe estar presente. Si aparece → FAIL. |
| `_comment` | Ignorado por el runner. Documentación inline. |

Los paths en las claves usan `/` (cross-platform). El runner los traduce a separadores del SO.

---

## scenario.json

```json
{
  "description": "Descripción del escenario",
  "expectFailure": false,
  "expectedErrorPattern": "INT-022"
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `description` | string | Documentación del propósito del escenario. |
| `expectFailure` | boolean | Si `true`, el build debe terminar con exit code ≠ 0. |
| `expectedErrorPattern` | string | (Solo si `expectFailure: true`) Texto que debe aparecer en stdout/stderr. |

---

## Escenarios actuales

| Escenario | Descripción |
|---|---|
| `ext-full` | Happy path: `externalSystems` con `schemas` anidados (`List<SchemaName>`), `domain` block, auth `api-key`, resilience `circuitBreaker` + `retries`, path variable. |

---

## Convenciones para nuevos escenarios

- Un escenario por feature o caso de error a validar.
- Nombre en kebab-case descriptivo: `ext-oauth2`, `ext-schema-validation-error`, `bc-cqrs-full`.
- Los fixtures YAML en `arch/` deben ser **mínimos**: solo lo necesario para el caso de prueba.
- Las assertions deben cubrir los archivos clave del feature, no toda la salida.
- Los golden files en `expected/` se commitean al repositorio.
- Archivos generados accidentalmente fuera de `expected/` están cubiertos por `test/scenarios/.gitignore`.
