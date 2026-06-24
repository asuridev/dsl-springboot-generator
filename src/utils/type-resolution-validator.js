'use strict';

/**
 * GEN-001 / GEN-002 — Validador de resolución de tipos (pre-generación).
 *
 * Comprobación cruzada: toda referencia de tipo en un `bc.yaml` debe resolver a
 * un tipo canónico o a un nombre declarado (enum / valueObject / projection /
 * eventDto / aggregate / entity) del mismo BC. Cubre los contextos que el reader
 * `bc-yaml-reader.js` NO valida de forma fuerte (sí valida valueObjects[],
 * projections[] y eventDtos[] property types):
 *
 *   - aggregates[].properties[].type        (jpa-entity degradaba a String)
 *   - aggregates[].entities[].properties[].type
 *   - domainEvents.published[].payload[].type  (messaging importaba un paquete inexistente)
 *   - domainEvents.consumed[].payload[].type
 *
 * Se excluyen deliberadamente useCases[].input/returns: esos tipos pueden
 * resolver a un schema de OpenAPI/Internal API (no visible para este validador
 * local) y application-generator ya falla-rápido ante uno irresoluble.
 *
 * Sin esta validación, un tipo no declarado se cuela y el generador emite un
 * import a un paquete inexistente (o degrada silenciosamente a String), por lo
 * que el proyecto generado no compila.
 *
 * Reglas:
 *   GEN-001 (error)  Tipo que no resuelve a canónico ni a un nombre declarado.
 *   GEN-002 (error)  Tipo `Map[K,V]`: el generador no tiene mapeo para Map
 *                    (type-mapper lo trataría como un domain type espurio).
 *
 * Cada diagnóstico tiene la forma { code, level, message, location } y se inyecta
 * en el array `diagnostics` de build.js junto a validateOpenApiUseCases, por lo
 * que hereda el gate `--strict` (error en strict, warning en --no-strict).
 */

// Escalares canónicos (unión permisiva de los que aceptan type-mapper.js,
// application-generator.javaTypeForDto y messaging-generator.javaTypeForEventField).
// Ser permisivo aquí evita falsos positivos: GEN-001 solo marca nombres que no
// resuelven en NINGUNA capa.
const CANONICAL_SCALARS = new Set([
  'Uuid', 'String', 'Text', 'Integer', 'Long', 'Decimal', 'Boolean',
  'Date', 'DateTime', 'Duration', 'Email', 'Url', 'Money', 'StoredObject', 'PageRequest',
  'File', 'BinaryStream', 'SearchText', 'BigInt', 'BigInteger', 'Json', 'JSON',
  'void',
]);

const STRING_N_RE = /^String\(\d+\)$/;
// Envoltorios estructurales cuyo tipo interno se resuelve recursivamente.
const WRAPPER_RE = /^(List|Page|Slice|Stream|Set|Optional|Range)\[(.+)\]$/;
const ENUM_WRAP_RE = /^Enum<(.+)>$/;
const MAP_RE = /^Map\[(.+)\]$/;
const RESPONSE_SUFFIX = 'Response';

/**
 * Construye el registro de nombres declarados de un BC.
 * @returns {{ names: Set<string>, aggregateNames: Set<string> }}
 */
function buildRegistry(bcYaml) {
  const names = new Set();
  const aggregateNames = new Set();
  for (const e of bcYaml.enums || []) if (e && e.name) names.add(e.name);
  for (const v of bcYaml.valueObjects || []) if (v && v.name) names.add(v.name);
  for (const p of bcYaml.projections || []) if (p && p.name) names.add(p.name);
  for (const d of bcYaml.eventDtos || []) if (d && d.name) names.add(d.name);
  for (const a of bcYaml.aggregates || []) {
    if (a && a.name) {
      names.add(a.name);
      aggregateNames.add(a.name);
    }
    for (const ent of (a && a.entities) || []) {
      if (ent && ent.name) names.add(ent.name);
    }
  }
  return { names, aggregateNames };
}

/**
 * Devuelve null si el tipo resuelve; en caso contrario un objeto
 * { code, reason } describiendo por qué no resuelve.
 */
function resolutionError(type, reg) {
  if (type == null || typeof type !== 'string') return null; // schema inline u omitido
  const t = type.trim();
  if (!t || t === 'void') return null;

  // Sufijo opcional "T?"
  if (t.endsWith('?')) return resolutionError(t.slice(0, -1).trim(), reg);

  // Map[K,V] — no soportado por el generador (G-D / GEN-002)
  if (MAP_RE.test(t)) {
    return {
      code: 'GEN-002',
      reason: `usa "Map[K,V]", que el generador no soporta. Modela un Value Object específico en su lugar`,
    };
  }

  // Envoltorios estructurales: resuelve el tipo interno
  const wrap = WRAPPER_RE.exec(t);
  if (wrap) return resolutionError(wrap[2].trim(), reg);

  // String(n)
  if (STRING_N_RE.test(t)) return null;

  // Enum<X>
  const em = ENUM_WRAP_RE.exec(t);
  if (em) {
    const inner = em[1].trim();
    if (reg.names.has(inner)) return null;
    return { code: 'GEN-001', reason: `referencia al enum no declarado "${inner}"` };
  }

  // Escalar canónico
  if (CANONICAL_SCALARS.has(t)) return null;

  // Nombre declarado (enum / VO / projection / eventDto / aggregate / entity)
  if (reg.names.has(t)) return null;

  // Forma "<Agg>Response" usada en returns de queries
  if (t.endsWith(RESPONSE_SUFFIX)) {
    const agg = t.slice(0, -RESPONSE_SUFFIX.length);
    if (reg.aggregateNames.has(agg)) return null;
  }

  return {
    code: 'GEN-001',
    reason: `el tipo "${t}" no resuelve a un tipo canónico ni a un enum/valueObject/projection/eventDto/aggregate declarado en el BC`,
  };
}

/**
 * Valida la resolución de tipos de un bc.yaml.
 * @param {object} bcYaml - documento bc.yaml normalizado (debe tener `.bc`)
 * @returns {Array<{code,level,message,location}>}
 */
function validateTypeResolution(bcYaml) {
  const diagnostics = [];
  if (!bcYaml || typeof bcYaml !== 'object') return diagnostics;
  const bcName = bcYaml.bc || '<unknown-bc>';
  const reg = buildRegistry(bcYaml);

  const check = (type, location) => {
    const err = resolutionError(type, reg);
    if (err) {
      diagnostics.push({
        code: err.code,
        level: 'error',
        message: `BC "${bcName}": ${err.reason}.`,
        location: `arch/${bcName}/${bcName}.yaml ${location}`,
      });
    }
  };

  // ── Aggregates + entities ──────────────────────────────────────────────────
  for (const agg of bcYaml.aggregates || []) {
    if (!agg) continue;
    for (const prop of agg.properties || []) {
      if (prop && prop.type) check(prop.type, `aggregates[${agg.name}].properties[${prop.name}].type`);
    }
    for (const ent of agg.entities || []) {
      if (!ent) continue;
      for (const prop of ent.properties || []) {
        if (prop && prop.type) {
          check(prop.type, `aggregates[${agg.name}].entities[${ent.name}].properties[${prop.name}].type`);
        }
      }
    }
  }

  // Nota: useCases[].input[].type y useCases[].returns NO se validan aquí. Esos
  // tipos pueden resolver a un schema de OpenAPI/Internal API (p.ej. una query
  // que devuelve `ProductDetail` definido en components.schemas), camino que este
  // validador local no conoce. Además application-generator.javaTypeForDto ya
  // falla-rápido ante un input/returns realmente irresoluble en generación.

  // ── Domain events: payloads ────────────────────────────────────────────────
  const events = bcYaml.domainEvents || {};
  for (const ev of events.published || []) {
    if (!ev) continue;
    for (const pf of ev.payload || []) {
      if (pf && typeof pf.type === 'string') {
        check(pf.type, `domainEvents.published[${ev.name}].payload[${pf.name}].type`);
      }
    }
  }
  for (const ev of events.consumed || []) {
    if (!ev) continue;
    for (const pf of ev.payload || []) {
      if (pf && typeof pf.type === 'string') {
        check(pf.type, `domainEvents.consumed[${ev.name}].payload[${pf.name}].type`);
      }
    }
  }

  // ── Value object reference cycles (GEN-003) ────────────────────────────────
  diagnostics.push(...detectVoCycles(bcYaml));

  return diagnostics;
}

/**
 * Devuelve el nombre del value object referenciado por `type` (desempaquetando
 * List/Set/Optional/…, ignorando Enum<X> y String(n)), o null si no referencia un VO.
 */
function voReference(type, voNames) {
  if (type == null || typeof type !== 'string') return null;
  let t = type.trim();
  if (!t) return null;
  if (t.endsWith('?')) t = t.slice(0, -1).trim();
  const wrap = WRAPPER_RE.exec(t);
  if (wrap) return voReference(wrap[2].trim(), voNames);
  if (ENUM_WRAP_RE.test(t)) return null; // un enum nunca es un VO
  const head = t.replace(/\(.*\)/, ''); // strip String(n)
  return voNames.has(head) ? head : null;
}

/**
 * GEN-003 — Detecta ciclos en el grafo dirigido VO→VO.
 *
 * Una referencia circular (A→B→A, o A→A) genera `equals`/`hashCode`/`toString`
 * mutuamente recursivos y una expansión @Embeddable infinita en JPA: el proyecto
 * generado no compila o desborda la pila en runtime. Por eso se rechaza.
 *
 * @param {object} bcYaml
 * @returns {Array<{code,level,message,location}>}
 */
function detectVoCycles(bcYaml) {
  const diagnostics = [];
  const vos = (bcYaml.valueObjects || []).filter((v) => v && v.name);
  if (vos.length === 0) return diagnostics;
  const bcName = bcYaml.bc || '<unknown-bc>';
  const voNames = new Set(vos.map((v) => v.name));

  const edges = new Map();
  for (const vo of vos) {
    const targets = new Set();
    for (const prop of vo.properties || []) {
      const ref = voReference(prop && prop.type, voNames);
      if (ref) targets.add(ref);
    }
    edges.set(vo.name, targets);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(vos.map((v) => [v.name, WHITE]));
  const stack = [];
  let reported = false;

  function visit(node) {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of edges.get(node) || []) {
      if (reported) break;
      if (color.get(next) === GRAY) {
        const idx = stack.indexOf(next);
        const cyclePath = stack.slice(idx).concat(next).join(' -> ');
        diagnostics.push({
          code: 'GEN-003',
          level: 'error',
          message: `BC "${bcName}": circular value object reference detected: ${cyclePath}. ` +
            `Break the cycle (e.g. reference a Uuid instead of embedding the value object).`,
          location: `arch/${bcName}/${bcName}.yaml valueObjects`,
        });
        reported = true;
        return;
      }
      if (color.get(next) === WHITE) {
        visit(next);
        if (reported) return;
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }

  for (const vo of vos) {
    if (reported) break;
    if (color.get(vo.name) === WHITE) visit(vo.name);
  }
  return diagnostics;
}

module.exports = { validateTypeResolution, buildRegistry, resolutionError, detectVoCycles };
