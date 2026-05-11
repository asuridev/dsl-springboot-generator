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

# Forzar compilación Java generada en escenarios happy path
npm run test:compile
npm run test:compile -- --scenario domain-enums

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
6. Compara el `src/main/java/` generado contra los golden files en `expected/`. En escenarios exitosos, `expected/` es obligatorio salvo `allowNoExpected: true`.
7. Si `scenario.json` declara `compileGeneratedJava: true` o el runner se ejecuta con `--compile`, ejecuta el Gradle wrapper del proyecto generado.
8. Limpia el directorio temporal.

La compilación Java es una compuerta opt-in por escenario para controlar el coste de la suite. En escenarios seleccionados ejecuta `compileJava --no-daemon` por defecto y resume errores de compilación sin volcar todo el log, salvo que se use `--verbose`.

Los escenarios `cs-http-full` y `event-kafka-outbox` ejecutan `gradle build --no-daemon` como compuerta pesada representativa: cubren REST/integración HTTP y mensajería Kafka/outbox respectivamente. No se activa `build` en todos los escenarios para mantener la suite razonable en tiempo.

Prerequisito local: debe existir un JDK válido para los escenarios que compilan Java. Esta resolución no la hace el generador principal, sino el runner de tests antes de invocar el Gradle wrapper del proyecto generado.

El runner resuelve la ruta de Java en este orden:

1. `javaHome` declarado en `scenario.json`.
2. Variable de entorno `DSL_TEST_JAVA_HOME`.
3. Variable de entorno `JAVA_HOME`, solo si apunta a un JDK usable.
4. Fallback local `C:\java\jdk-17`, solo en Windows y solo si existe.

Un `JAVA_HOME` se considera usable si existe `{JAVA_HOME}/bin/java.exe` en Windows o `{JAVA_HOME}/bin/java` en Linux/macOS. Cuando el runner encuentra una ruta válida, ejecuta Gradle con ese valor en `JAVA_HOME` y antepone `{JAVA_HOME}/bin` al `PATH` del proceso hijo. Si no encuentra ninguna ruta, no fuerza `JAVA_HOME`; Gradle usará el entorno actual y puede fallar si no hay Java disponible.

Ejemplo mínimo de `scenario.json` para activar la compilación Java con un JDK local fijo:

```json
{
  "compileGeneratedJava": true,
  "javaHome": "C:\\java\\jdk-17"
}
```

---

## Flujo de primer escenario (crear golden files)

Al crear un escenario nuevo, `expected/` no existe todavía. Pasos:

```bash
# 1. Primera ejecución — el build y las assertions deben pasar, pero faltará expected/
npm run test:scenario -- mi-escenario
# → "[diff] Missing expected/ directory..."

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
  "expectedErrorPattern": "INT-022",
  "compileGeneratedJava": true,
  "allowNoExpected": false,
  "gradleTask": "compileJava",
  "javaHome": "C:\\java\\jdk-17"
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `description` | string | Documentación del propósito del escenario. |
| `expectFailure` | boolean | Si `true`, el build debe terminar con exit code ≠ 0. |
| `expectedErrorPattern` | string | (Solo si `expectFailure: true`) Texto que debe aparecer en stdout/stderr. |
| `compileGeneratedJava` | boolean | Si `true`, compila el proyecto Java generado después de assertions/diff. Se ignora en escenarios con `expectFailure: true`. |
| `allowNoExpected` | boolean | Si `true`, permite un escenario exitoso sin `expected/`. Debe reservarse para smokes intencionales; por defecto un happy path sin golden files falla. |
| `gradleTask` | string | Tarea Gradle a ejecutar cuando se compila. Default: `compileJava`. Para escenarios MVP completos puede usarse `build`. |
| `javaHome` | string | Override de `JAVA_HOME` para el escenario. Tiene prioridad sobre `DSL_TEST_JAVA_HOME`, `process.env.JAVA_HOME` y el fallback local `C:\java\jdk-17` en Windows. |

---

## Escenarios actuales

| Escenario | Descripción |
|---|---|
| `cs-http-full` | Happy path customer-supplier HTTP con OpenAPI, internal API, resiliencia completa y `gradle build` del proyecto generado. |
| `event-kafka-outbox` | Happy path/event regression con Kafka, outbox transaccional, consumidor y `gradle build` del proyecto generado. |
| `ext-full` | Happy path: `externalSystems` con `schemas` anidados (`List<SchemaName>`), `domain` block, auth `api-key`, resilience `circuitBreaker` + `retries`, path variable. |

---

## Convenciones para nuevos escenarios

- Un escenario por feature o caso de error a validar.
- Nombre en kebab-case descriptivo: `ext-oauth2`, `ext-schema-validation-error`, `bc-cqrs-full`.
- Los fixtures YAML en `arch/` deben ser **mínimos**: solo lo necesario para el caso de prueba.
- Las assertions deben cubrir los archivos clave del feature, no toda la salida.
- Los golden files en `expected/` se commitean al repositorio.
- Archivos generados accidentalmente fuera de `expected/` están cubiertos por `test/scenarios/.gitignore`.
