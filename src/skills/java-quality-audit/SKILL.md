---
name: java-quality-audit
description: >
  Audita y ajusta la calidad del código Java de un bounded context ya implementado y validado:
  imports faltantes o sin usar, inyección de dependencias por constructor, campos `final`, tipado de
  excepciones de dominio, uso correcto de `@Transactional`, convenciones de `AGENTS.md` (sin Lombok
  ni setters en dominio). Aplica **solo cambios no-conductuales** que preserven el comportamiento ya
  validado por `flow-validator`, y define la frontera "no-conductual vs conductual". La usa el
  especialista `java-quality-auditor`. Úsala al pulir/limpiar el código Java de un BC sin cambiar su
  comportamiento.
---

> **Antes de empezar**, lee las **reglas inviolables** y **convenciones** en la skill compartida
> `.agents/skills/orchestration/SKILL.md`. Las convenciones de arquitectura están en `AGENTS.md`.

# Auditoría de calidad de código Java (Fase 3)

Define **qué auditar y ajustar** en el código Java de un bounded context ya implementado y validado,
y la **frontera de "cambio no-conductual"**: lo que `flow-validator` dejó pasando debe seguir
pasando.

> **Premisa:** esta auditoría corre **después** de que todos los escenarios están verdes. El
> objetivo es higiene del código, no corregir comportamiento. Cualquier hallazgo que requiera
> cambiar comportamiento se **reporta** (`remaining[]`), no se aplica.

---

## Checklist de auditoría

### 1. Imports
- Elimina imports **no usados**.
- Añade imports **faltantes** (clases de error, value objects, DTOs de proyección, excepciones).
- Evita imports con comodín (`import x.*`) si la convención del proyecto usa imports explícitos.
- Ordena según la convención del código vecino.

### 2. Inyección de dependencias
- **Inyección por constructor**, no field injection (`@Autowired` sobre campos).
- Campos de dependencia `private final`.
- Un único constructor → no requiere `@Autowired` explícito en Spring.
- No inyectar más colaboradores de los que el handler/service realmente usa.

### 3. Inmutabilidad y estado
- `final` en campos y variables locales que no se reasignan.
- Dominio **sin setters públicos**; modificación de estado solo por métodos de negocio (ver
  `AGENTS.md`).
- Al exponer colecciones, preferir vistas inmutables (`List.copyOf`, `Collections.unmodifiableList`)
  cuando aplique sin cambiar el contrato.

### 4. Manejo de excepciones
- Usar las **excepciones de dominio tipadas** del BC en vez de genéricas (`RuntimeException`,
  `Exception`, `IllegalStateException` sin contexto).
- Nada de `catch` vacíos ni que traguen la excepción sin re-lanzar/registrar.
- No capturar `Throwable`/`Exception` de forma demasiado amplia salvo en bordes justificados.

### 5. Transacciones
- Handlers de command: `@Transactional`.
- Handlers de query: `@Transactional(readOnly = true)`.
- Coherencia con el patrón de los handlers ya implementados; no añadir/quitar transaccionalidad de
  forma que cambie la semántica (eso sería conductual → reportar).

### 6. Convenciones de arquitectura (`AGENTS.md`)
- **Dominio**: sin Lombok, sin constructor vacío, sin setters; getters públicos; constructor de
  reconstrucción + constructor/factory de creación.
- **Entidades JPA (infraestructura)**: con el patrón Lombok/`@Entity` esperado; nombre `{Entity}Jpa`.
- Aislamiento de BC: ningún import de clases de dominio/JPA/repositorios de **otro** BC.

### 7. Optimistic locking (consistencia dominio ↔ JPA)
- Si la JPA entity del aggregate tiene `@Version Long version`, el aggregate de dominio debe
  declarar `Long version` con getter y el mapper propagarlo en `toDomain()` y `toJpa()`.
- Si falta el round-trip, es un **defecto del generador Fase 2** (causa `OptimisticLockException`):
  no lo "arregles" cambiando comportamiento aquí → repórtalo en `remaining[]`.

### 8. Higiene general
- Sin código muerto evidente, variables sin usar ni warnings triviales del compilador.
- Nombres coherentes con el resto del BC.
- Formato consistente con el código vecino (sangría, llaves, longitud de línea).

---

## Frontera: cambio no-conductual vs conductual

**Permitido (no-conductual)** — aplícalo:
- Reordenar/añadir/quitar imports.
- Pasar field injection a constructor injection.
- Añadir `final`.
- Reemplazar una excepción genérica por la de dominio **equivalente ya existente** sin cambiar el
  status HTTP resultante ni el flujo.
- Eliminar código muerto, normalizar formato.

**Prohibido aquí (conductual)** — repórtalo en `remaining[]`, no lo apliques:
- Añadir/eliminar validaciones o invariantes.
- Cambiar firmas públicas, contratos, DTOs o mapeos de persistencia.
- Cambiar el status HTTP, los eventos emitidos o los side effects.
- Reescribir lógica de negocio "para que quede mejor".
- Añadir dependencias o clases nuevas.

---

## Cierre

Al terminar, ejecuta `./gradlew compileJava`. Debe quedar **limpio**. Si un ajuste rompió la
compilación, corrígelo o revíértelo. Devuelve `compiles: true` solo con compilación verde, junto con
`issuesFixed[]` (lo aplicado) y `remaining[]` (lo que requiere decisión humana o cambio conductual).
