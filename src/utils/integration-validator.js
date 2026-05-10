'use strict';

const fs = require('fs-extra');
const path = require('path');
const { toKebabCase } = require('./naming');

/**
 * Validador cruzado entre `system.yaml`, los `<bc>.yaml` y los artefactos
 * de la carpeta arch/.
 *
 * Reglas implementadas (Fase 0 — gaps G0, G12 del integrations-analisis.md):
 *
 *   INT-001  Todo `system.integrations[]` con `pattern: event` debe declarar
 *            cada contract.name en `domainEvents.published[]` del BC `from`.
 *   INT-002  Idem para `domainEvents.consumed[]` del BC `to`.
 *   INT-003  `pattern: customer-supplier` + `channel: http` requiere
 *            arch/<to>/<to>-internal-api.yaml + entrada recíproca en
 *            `bc.<to>.integrations.inbound[]` y en `bc.<from>.integrations.outbound[]`.
 *   INT-004  `pattern: acl` + `channel: http` requiere `system.externalSystems[]`
 *            con name === to.
 *   INT-005  Channel declarado discrepa de la convención
 *            `<from>.<kebab(eventName).replaceAll(-, .)>` (severidad: warn).
 *   INT-006  Cada `bc.integrations.outbound[]` debe tener su recíproco en
 *            `system.integrations[]` (from=bc, to=outbound.name).
 *   INT-007  Cada `bc.domainEvents.consumed[].name` debe estar en
 *            `domainEvents.published[]` de algún otro BC.
 *   INT-010  Toda projection con `persistent: true` debe declarar
 *            `source: { kind: event, event, from }` y el evento debe estar
 *            publicado por el BC `from`.
 *   INT-011  Toda projection persistente debe declarar `keyBy` y la propiedad
 *            referida debe existir en `properties[]`.
 *   INT-012  additionalSources de una projection persistente deben referenciar
 *            eventos publicados por los BCs `from` correspondientes.
 *   INT-013  saga.trigger.event debe estar en `domainEvents.published[]` del
 *            BC `saga.trigger.bc`.
 *   INT-014  step.onSuccess / step.onFailure / step.compensation deben estar
 *            publicados por el BC `step.bc` (o por algún BC, en el caso de
 *            compensation que puede emitirse desde otro BC).
 *   INT-015  Toda integración HTTP con `auth.type: oauth2-cc` debe declarar
 *            `tokenEndpoint` y `credentialKey`. Aplica a `system.integrations[].auth`,
 *            `system.externalSystems[].auth` y `bc.integrations.outbound[].auth`.
 *   INT-027  (warn) Projection con `upsertStrategy: versionGuarded` cuyo evento
 *            fuente no incluye el campo de versión en su `payload[]`. El guard
 *            degenera silenciosamente a `lastWriteWins` en runtime.
 *
 * Reglas Fase 2 (cross-YAML AsyncAPI ↔ bc.yaml — gaps G4, G7, G12):
 *
 *   INT-016  Cada `components.messages.{X}` referenciado por algún canal del
 *            AsyncAPI del BC debe estar declarado en `domainEvents.published[]`
 *            o `domainEvents.consumed[]` del mismo BC.
 *   INT-017  Cada `domainEvents.published[].name` debe tener una entrada en el
 *            AsyncAPI del BC (mensaje + canal con `message.$ref` válido).
 *   INT-018  El `channel` declarado en `domainEvents.published[]` debe matchear
 *            la dirección de un canal en el AsyncAPI que referencie el mensaje
 *            correspondiente (warn).
 *   INT-019  Los nombres de campo de `domainEvents.published[].payload[]` deben
 *            existir en el schema del payload del mensaje AsyncAPI; los tipos
 *            primitivos deben ser compatibles (warn ante drift de tipo).
 *   INT-020  Cada `domainEvents.consumed[].payload[]` debe ser un subconjunto
 *            (por nombre) del payload publicado por el BC productor declarado
 *            en `consumed[].sourceBc`.
 *   INT-021  Si un campo de `published[].payload[]` coincide en nombre con una
 *            propiedad de aggregate del BC productor marcada `hidden: true`, el
 *            evento debe declarar `allowHiddenLeak: true`; de lo contrario error.
 *
 * Reglas Fase 6 (objetos complejos en externalSystems — gaps G-EXT-1, G-EXT-2):
 *
 *   INT-022  Todo campo en `externalSystems[].operations[].request|response.fields[]`
 *            cuyo `type` no sea un tipo wire-format escalar conocido (ni List<escalar>)
 *            debe tener su tipo base declarado en `externalSystems[].schemas`.
 *            Nivel: error. Evita que mapWireType produzca silenciosamente `Object`.
 *   INT-023  Todo campo dentro de `externalSystems[].schemas[schemaName]` debe usar
 *            tipos wire-format escalares conocidos, `List<X>` donde X es un escalar
 *            o nombre de schema del mismo sistema externo, o un nombre de schema del
 *            mismo sistema externo. Referencias circulares o indefinidas son error.
 *            Nivel: error.
 */

// ─── Tipos auxiliares ────────────────────────────────────────────────────────

/**
 * @typedef {Object} Diagnostic
 * @property {string} code      Código (e.g. "INT-001")
 * @property {'error'|'warn'} level
 * @property {string} message
 * @property {string} location  YAML pointer aproximado
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

function indexBcYamls(bcYamls) {
  const index = new Map();
  for (const bc of bcYamls) index.set(bc.bc, bc);
  return index;
}

function publishedNames(bcYaml) {
  return new Set(((bcYaml && bcYaml.domainEvents && bcYaml.domainEvents.published) || []).map((e) => e.name));
}

function consumedNames(bcYaml) {
  return new Set(((bcYaml && bcYaml.domainEvents && bcYaml.domainEvents.consumed) || []).map((e) => e.name));
}

/**
 * Returns the set of event names that the BC consumes via persistent projections
 * (both primary source and additionalSources entries).
 */
function projectionConsumedNames(bcYaml) {
  const names = new Set();
  for (const proj of ((bcYaml && bcYaml.projections) || [])) {
    if (proj.persistent !== true) continue;
    if (proj.source && proj.source.kind === 'event' && proj.source.event) {
      names.add(proj.source.event);
    }
    for (const src of (proj.additionalSources || [])) {
      if (src.event) names.add(src.event);
    }
  }
  return names;
}

function inboundOpNames(bcYaml) {
  const set = new Set();
  for (const ib of (bcYaml && bcYaml.integrations && bcYaml.integrations.inbound) || []) {
    for (const op of ib.operations || []) set.add(op.name);
  }
  return set;
}

function outboundOpNames(bcYaml, targetName) {
  const set = new Set();
  for (const ob of (bcYaml && bcYaml.integrations && bcYaml.integrations.outbound) || []) {
    if (ob.name !== targetName) continue;
    for (const op of ob.operations || []) set.add(op.name);
  }
  return set;
}

function expectedEventChannel(fromBc, eventName) {
  // Convención: <from>.<kebab-event-name reemplazando '-' por '.'>
  // ProductActivated → product.activated  →  catalog.product.activated
  const kebab = toKebabCase(eventName);
  const dotted = kebab.replace(/-/g, '.');
  return `${fromBc}.${dotted}`;
}

// ─── Reglas ──────────────────────────────────────────────────────────────────

function checkSystemIntegrations(system, bcIndex, archDir, externalNames, diagnostics) {
  const integrations = system.integrations || [];
  for (let i = 0; i < integrations.length; i++) {
    const integ = integrations[i];
    const loc = `system.yaml#/integrations[${i}]`;
    const fromBc = bcIndex.get(integ.from);
    const toBc = bcIndex.get(integ.to);

    if (integ.pattern === 'event' && integ.channel === 'message-broker') {
      const fromPublished = fromBc ? publishedNames(fromBc) : new Set();
      const toConsumed = toBc ? consumedNames(toBc) : new Set();

      for (const contract of integ.contracts || []) {
        const eventName = typeof contract === 'string' ? contract : contract.name;
        const declaredChannel = typeof contract === 'object' ? contract.channel : null;
        if (!eventName) continue;

        // INT-001
        if (fromBc && !fromPublished.has(eventName)) {
          diagnostics.push({
            code: 'INT-001',
            level: 'error',
            message: `Event "${eventName}" declared in ${integ.from} → ${integ.to} integration is not present in ${integ.from}.yaml#/domainEvents/published.`,
            location: loc,
          });
        }
        // INT-002: consumed via domainEvents.consumed[] OR via persistent projections
        if (toBc && !toConsumed.has(eventName) && !projectionConsumedNames(toBc).has(eventName)) {
          diagnostics.push({
            code: 'INT-002',
            level: 'error',
            message: `Event "${eventName}" declared in ${integ.from} → ${integ.to} integration is not present in ${integ.to}.yaml#/domainEvents/consumed.`,
            location: loc,
          });
        }
        // INT-005 (warn)
        if (declaredChannel) {
          const expected = expectedEventChannel(integ.from, eventName);
          if (declaredChannel !== expected) {
            diagnostics.push({
              code: 'INT-005',
              level: 'warn',
              message: `Channel "${declaredChannel}" for event "${eventName}" differs from convention "${expected}".`,
              location: `${loc}/contracts`,
            });
          }
        }
      }
    } else if (integ.pattern === 'customer-supplier' && integ.channel === 'http') {
      // INT-003
      const internalApiPath = path.join(archDir, integ.to, `${integ.to}-internal-api.yaml`);
      if (!fs.pathExistsSync(internalApiPath)) {
        diagnostics.push({
          code: 'INT-003',
          level: 'error',
          message: `Customer-supplier HTTP integration ${integ.from} → ${integ.to} requires arch/${integ.to}/${integ.to}-internal-api.yaml (not found).`,
          location: loc,
        });
      }
      const toInbound = toBc ? inboundOpNames(toBc) : new Set();
      const fromOutbound = fromBc ? outboundOpNames(fromBc, integ.to) : new Set();
      for (const contract of integ.contracts || []) {
        const opName = typeof contract === 'string' ? contract : contract.name;
        if (!opName) continue;
        if (toBc && !toInbound.has(opName)) {
          diagnostics.push({
            code: 'INT-003',
            level: 'error',
            message: `Operation "${opName}" declared in ${integ.from} → ${integ.to} HTTP integration is not present in ${integ.to}.yaml#/integrations/inbound[].operations.`,
            location: loc,
          });
        }
        if (fromBc && !fromOutbound.has(opName)) {
          diagnostics.push({
            code: 'INT-003',
            level: 'error',
            message: `Operation "${opName}" declared in ${integ.from} → ${integ.to} HTTP integration is not present in ${integ.from}.yaml#/integrations/outbound[name=${integ.to}].operations.`,
            location: loc,
          });
        }
      }
    } else if (integ.pattern === 'acl') {
      // INT-004
      if (!externalNames.has(integ.to)) {
        diagnostics.push({
          code: 'INT-004',
          level: 'error',
          message: `ACL integration ${integ.from} → ${integ.to} references unknown external system "${integ.to}". Declare it under system.yaml#/externalSystems.`,
          location: loc,
        });
        continue;
      }
      // INT-008: every contract must match an externalSystems[name=to].operations[*].name
      const ext = (system.externalSystems || []).find((e) => e.name === integ.to);
      const declaredOps = new Set(((ext && ext.operations) || []).map((o) => o.name));
      for (const contract of integ.contracts || []) {
        const opName = typeof contract === 'string' ? contract : contract.name;
        if (!opName) continue;
        if (declaredOps.size === 0) {
          // No operations declared — Phase 1 will skip generation; warn (not error)
          diagnostics.push({
            code: 'INT-008',
            level: 'warn',
            message: `External system "${integ.to}" has no operations declared in system.yaml#/externalSystems. ACL adapter generation will be skipped for "${opName}".`,
            location: `${loc}/contracts`,
          });
          break;
        }
        if (!declaredOps.has(opName)) {
          diagnostics.push({
            code: 'INT-008',
            level: 'error',
            message: `Contract "${opName}" in ${integ.from} → ${integ.to} ACL integration is not declared under externalSystems["${integ.to}"].operations.`,
            location: `${loc}/contracts`,
          });
        }
      }
    }
  }
}

function checkBcOutboundReciprocity(system, bcYamls, externalNames, diagnostics) {
  // Construye índice de aristas system.integrations: (from, to) → integration
  const edges = new Map();
  for (const integ of system.integrations || []) {
    edges.set(`${integ.from}→${integ.to}`, integ);
  }
  const externalsByName = new Map((system.externalSystems || []).map((e) => [e.name, e]));

  for (const bc of bcYamls) {
    const outbound = (bc.integrations && bc.integrations.outbound) || [];
    for (let j = 0; j < outbound.length; j++) {
      const ob = outbound[j];
      const target = ob.name;
      const loc = `${bc.bc}.yaml#/integrations/outbound[${j}]`;

      // El outbound puede apuntar a un BC interno o a un externalSystem.
      const isExternal = ob.type === 'externalSystem' || externalNames.has(target);
      const recip = edges.get(`${bc.bc}→${target}`);

      // INT-006
      if (!recip) {
        diagnostics.push({
          code: 'INT-006',
          level: 'error',
          message: `${bc.bc}.yaml declares outbound integration to "${target}" but system.yaml has no matching integrations[] entry (from=${bc.bc}, to=${target}).`,
          location: loc,
        });
        continue;
      }

      // Coherencia mínima de pattern/channel (referencial — no error si no coincide,
      // sólo aviso, porque el diseño puede tener semántica adicional).
      if (isExternal && recip.pattern !== 'acl') {
        diagnostics.push({
          code: 'INT-006',
          level: 'warn',
          message: `Outbound to external system "${target}" should use pattern "acl" in system.yaml (found "${recip.pattern}").`,
          location: loc,
        });
      }

      // INT-009: each operation declared on outbound[type=externalSystem] must
      // exist in externalSystems[name=target].operations[*].name.
      if (isExternal) {
        const ext = externalsByName.get(target);
        const declaredOps = new Set(((ext && ext.operations) || []).map((o) => o.name));
        const obOps = ob.operations || [];
        if (declaredOps.size > 0) {
          for (let k = 0; k < obOps.length; k++) {
            const opName = obOps[k].name;
            if (opName && !declaredOps.has(opName)) {
              diagnostics.push({
                code: 'INT-009',
                level: 'error',
                message: `Operation "${opName}" in ${bc.bc}.yaml outbound[${target}] is not declared under externalSystems["${target}"].operations.`,
                location: `${loc}/operations[${k}]`,
              });
            }
          }
        }
      }
    }
  }
}

function checkOrphanConsumers(bcYamls, undesignedBcs, diagnostics) {
  // INT-007: cada consumed.name debe estar publicado por algún BC.
  const allPublished = new Map(); // event → producerBc
  for (const bc of bcYamls) {
    for (const ev of ((bc.domainEvents || {}).published || [])) {
      if (!allPublished.has(ev.name)) allPublished.set(ev.name, bc.bc);
    }
  }
  for (const bc of bcYamls) {
    const consumed = ((bc.domainEvents || {}).consumed || []);
    for (let k = 0; k < consumed.length; k++) {
      const ev = consumed[k];
      if (!allPublished.has(ev.name)) {
        // If sourceBc is declared in system.yaml but not yet designed (no YAML in arch/),
        // downgrade to warn — the producer BC simply hasn't been designed yet.
        const sourceBc = ev.sourceBc;
        const isUndesigned = sourceBc && undesignedBcs.has(sourceBc);
        diagnostics.push({
          code: 'INT-007',
          level: isUndesigned ? 'warn' : 'error',
          message: isUndesigned
            ? `${bc.bc} consumes event "${ev.name}" from "${sourceBc}" which is declared in system.yaml but not yet designed (no ${sourceBc}.yaml in arch/).`
            : `${bc.bc} consumes event "${ev.name}" but no BC publishes it.`,
          location: `${bc.bc}.yaml#/domainEvents/consumed[${k}]`,
        });
      }
    }
  }
}

// ─── API pública ────────────────────────────────────────────────────────────
function checkPersistentProjections(bcYamls, bcIndex, diagnostics) {
  for (const bc of bcYamls) {
    const projections = bc.projections || [];
    for (let i = 0; i < projections.length; i++) {
      const p = projections[i];
      if (p.persistent !== true) continue;
      const loc = `${bc.bc}.yaml#/projections[${i}]`;

      // INT-010: source must be event-based and reference a published event in <from>
      if (!p.source || p.source.kind !== 'event' || !p.source.event || !p.source.from) {
        diagnostics.push({
          code: 'INT-010',
          level: 'error',
          message: `Persistent projection "${p.name}" must declare source: { kind: event, event: <Name>, from: <bc> }.`,
          location: loc,
        });
        continue;
      }
      const fromBc = bcIndex.get(p.source.from);
      if (!fromBc) {
        diagnostics.push({
          code: 'INT-010',
          level: 'error',
          message: `Persistent projection "${p.name}" sources from unknown BC "${p.source.from}".`,
          location: `${loc}/source/from`,
        });
      } else if (!publishedNames(fromBc).has(p.source.event)) {
        diagnostics.push({
          code: 'INT-010',
          level: 'error',
          message: `Persistent projection "${p.name}" sources event "${p.source.event}" but ${p.source.from}.yaml does not publish it.`,
          location: `${loc}/source/event`,
        });
      }

      // INT-011: keyBy must be present and reference a declared property
      if (!p.keyBy) {
        diagnostics.push({
          code: 'INT-011',
          level: 'error',
          message: `Persistent projection "${p.name}" must declare keyBy: <propertyName>.`,
          location: loc,
        });
      } else {
        const props = p.properties || [];
        if (!props.some((pr) => pr.name === p.keyBy)) {
          diagnostics.push({
            code: 'INT-011',
            level: 'error',
            message: `Persistent projection "${p.name}" keyBy="${p.keyBy}" is not declared in properties[].`,
            location: `${loc}/keyBy`,
          });
        }
      }

      // INT-012: each additionalSources entry must reference a published event in its <from> BC
      for (let si = 0; si < (p.additionalSources || []).length; si++) {
        const src = p.additionalSources[si];
        const sloc = `${loc}/additionalSources[${si}]`;
        if (!src || src.kind !== 'event' || !src.event || !src.from) continue; // bc-yaml-reader already caught structural errors
        const srcBc = bcIndex.get(src.from);
        if (!srcBc) {
          diagnostics.push({
            code: 'INT-012',
            level: 'error',
            message: `Persistent projection "${p.name}" additionalSources[${si}] sources from unknown BC "${src.from}".`,
            location: `${sloc}/from`,
          });
        } else if (!publishedNames(srcBc).has(src.event)) {
          diagnostics.push({
            code: 'INT-012',
            level: 'error',
            message: `Persistent projection "${p.name}" additionalSources[${si}] sources event "${src.event}" but ${src.from}.yaml does not publish it.`,
            location: `${sloc}/event`,
          });
        }
      }

      // INT-027: versionGuarded without the version field in the source event payload (warn — code compiles but guard degenerates)
      const upsertStrategy = p.upsertStrategy || 'lastWriteWins';
      if (upsertStrategy === 'versionGuarded') {
        const versionField = p.eventVersionField || 'version';
        const fromBcYaml = bcIndex.get(p.source.from);
        if (fromBcYaml) {
          const sourceEvent = ((fromBcYaml.domainEvents || {}).published || []).find((e) => e.name === p.source.event);
          if (sourceEvent) {
            const payloadFields = (sourceEvent.payload || []).map((f) => f.name);
            if (!payloadFields.includes(versionField)) {
              diagnostics.push({
                code: 'INT-027',
                level: 'warn',
                message:
                  `Projection "${bc.bc}.${p.name}" declares upsertStrategy=versionGuarded but ` +
                  `source event "${p.source.event}" in ${p.source.from}.yaml does not include ` +
                  `field "${versionField}" in its payload[]. ` +
                  `The version guard will silently degenerate to lastWriteWins at runtime.`,
                location: `${loc}/upsertStrategy`,
              });
            }
          }
          // Check additionalSources[] as well — they inherit versionGuarded
          for (let si = 0; si < (p.additionalSources || []).length; si++) {
            const src = p.additionalSources[si];
            if (!src || !src.event || !src.from) continue;
            const srcBcYaml = bcIndex.get(src.from);
            if (!srcBcYaml) continue;
            const srcEvent = ((srcBcYaml.domainEvents || {}).published || []).find((e) => e.name === src.event);
            if (!srcEvent) continue;
            const srcPayloadFields = (srcEvent.payload || []).map((f) => f.name);
            if (!srcPayloadFields.includes(versionField)) {
              diagnostics.push({
                code: 'INT-027',
                level: 'warn',
                message:
                  `Projection "${bc.bc}.${p.name}" additionalSources[${si}] event "${src.event}" in ` +
                  `${src.from}.yaml does not include field "${versionField}" in its payload[]. ` +
                  `The version guard will silently degenerate to lastWriteWins at runtime for this partial updater.`,
                location: `${loc}/additionalSources[${si}]`,
              });
            }
          }
        }
      }
    }
  }
}

function checkSagas(system, bcIndex, undesignedBcs, diagnostics) {
  const sagas = system.sagas || [];
  if (sagas.length === 0) return;

  // Build { eventName → Set<stepBc> } from all saga steps so we can identify
  // which BC would produce each saga event even when that BC has no YAML yet.
  const sagaEventsByBc = new Map();
  for (const saga of sagas) {
    for (const step of (saga.steps || [])) {
      for (const field of ['onSuccess', 'onFailure', 'compensation']) {
        const evName = step[field];
        if (evName && step.bc) {
          if (!sagaEventsByBc.has(evName)) sagaEventsByBc.set(evName, new Set());
          sagaEventsByBc.get(evName).add(step.bc);
        }
      }
    }
  }

  // Build a map { eventName → producerBcSet } for fast lookup.
  const publishedBy = new Map();
  for (const [bcName, bcYaml] of bcIndex.entries()) {
    for (const ev of ((bcYaml.domainEvents || {}).published || [])) {
      if (!publishedBy.has(ev.name)) publishedBy.set(ev.name, new Set());
      publishedBy.get(ev.name).add(bcName);
    }
  }

  for (let s = 0; s < sagas.length; s++) {
    const saga = sagas[s];
    if (!saga || !saga.name) continue;
    const baseLoc = `system.yaml#/sagas[${s}]`;

    // INT-013 — trigger event must be published by trigger.bc
    if (!saga.trigger || !saga.trigger.event || !saga.trigger.bc) {
      diagnostics.push({
        code: 'INT-013',
        level: 'error',
        message: `Saga "${saga.name}" must declare trigger: { event: <Name>, bc: <bc> }.`,
        location: baseLoc,
      });
    } else {
      const trigBc = bcIndex.get(saga.trigger.bc);
      if (!trigBc) {
        diagnostics.push({
          code: 'INT-013',
          level: 'error',
          message: `Saga "${saga.name}" trigger.bc "${saga.trigger.bc}" is not a known bounded context.`,
          location: `${baseLoc}/trigger/bc`,
        });
      } else if (!publishedNames(trigBc).has(saga.trigger.event)) {
        diagnostics.push({
          code: 'INT-013',
          level: 'error',
          message: `Saga "${saga.name}" trigger.event "${saga.trigger.event}" is not published by ${saga.trigger.bc}.yaml#/domainEvents/published.`,
          location: `${baseLoc}/trigger/event`,
        });
      }
    }

    // Steps
    const steps = saga.steps || [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const loc = `${baseLoc}/steps[${i}]`;

      // INT-012 — triggeredBy must be either the saga trigger or a published event somewhere
      if (step.triggeredBy) {
        const isTrigger = saga.trigger && saga.trigger.event === step.triggeredBy;
        if (!isTrigger && !publishedBy.has(step.triggeredBy)) {
          // Check if the event would come from an undesigned BC (not yet in arch/)
          const producers = sagaEventsByBc.get(step.triggeredBy) || new Set();
          const isUndesigned = [...producers].some((bc) => undesignedBcs.has(bc));
          diagnostics.push({
            code: 'INT-012',
            level: isUndesigned ? 'warn' : 'error',
            message: isUndesigned
              ? `Saga "${saga.name}" step ${step.order || i + 1}: triggeredBy "${step.triggeredBy}" would be published by an undesigned BC (not yet in arch/).`
              : `Saga "${saga.name}" step ${step.order || i + 1}: triggeredBy "${step.triggeredBy}" is neither the saga trigger nor published by any BC.`,
            location: `${loc}/triggeredBy`,
          });
        }
      } else {
        diagnostics.push({
          code: 'INT-012',
          level: 'error',
          message: `Saga "${saga.name}" step ${step.order || i + 1} must declare triggeredBy.`,
          location: loc,
        });
      }

      // INT-014 — onSuccess / onFailure / compensation must be published by step.bc (or any BC for compensation)
      const stepBc = step.bc;
      const stepBcYaml = stepBc ? bcIndex.get(stepBc) : null;
      const stepPublished = stepBcYaml ? publishedNames(stepBcYaml) : new Set();
      const stepIsUndesigned = stepBc ? undesignedBcs.has(stepBc) : false;

      const checkProduced = (eventName, fieldName, allowAnyBc) => {
        if (!eventName) return;
        if (allowAnyBc) {
          if (!publishedBy.has(eventName)) {
            // For compensation: check if any saga-declared producer of this event is undesigned
            const producers = sagaEventsByBc.get(eventName) || new Set();
            const isUndesigned = [...producers].some((bc) => undesignedBcs.has(bc)) || stepIsUndesigned;
            diagnostics.push({
              code: 'INT-014',
              level: isUndesigned ? 'warn' : 'error',
              message: isUndesigned
                ? `Saga "${saga.name}" step ${step.order || i + 1}: ${fieldName} "${eventName}" is not published by any designed BC yet (producer BC not yet in arch/).`
                : `Saga "${saga.name}" step ${step.order || i + 1}: ${fieldName} "${eventName}" is not published by any BC.`,
              location: `${loc}/${fieldName}`,
            });
          }
        } else {
          if (!stepPublished.has(eventName)) {
            diagnostics.push({
              code: 'INT-014',
              level: stepIsUndesigned ? 'warn' : 'error',
              message: stepIsUndesigned
                ? `Saga "${saga.name}" step ${step.order || i + 1}: ${fieldName} "${eventName}" is not published by ${stepBc}.yaml (BC not yet designed — no ${stepBc}.yaml in arch/).`
                : `Saga "${saga.name}" step ${step.order || i + 1}: ${fieldName} "${eventName}" is not published by ${stepBc || '<missing-bc>'}.yaml#/domainEvents/published.`,
              location: `${loc}/${fieldName}`,
            });
          }
        }
      };

      checkProduced(step.onSuccess,   'onSuccess',   false);
      checkProduced(step.onFailure,   'onFailure',   false);
      // compensation may be emitted from a different BC than step.bc (it usually is)
      checkProduced(step.compensation, 'compensation', true);
    }
  }
}
// ─── Reglas Fase 6 — externalSystems schemas ─────────────────────────────────────

const WIRE_SCALAR_TYPES = new Set(['String', 'Integer', 'Long', 'Boolean', 'Decimal', 'Instant', 'UUID']);

/**
 * Extracts the innermost type from a List<X> chain, e.g. "List<List<Foo>>" → "Foo".
 * Returns the type unchanged if it is not a List<X> wrapper.
 */
function unwrapListType(type) {
  let t = type;
  let listMatch;
  // eslint-disable-next-line no-cond-assign
  while ((listMatch = t && t.match(/^List<(.+)>$/))) {
    t = listMatch[1];
  }
  return t || '';
}

/**
 * INT-022 — Every non-scalar field type in operation request/response must be declared
 *           in externalSystems[].schemas.
 * INT-023 — Every field type inside schemas must be a scalar, List<scalar|schema>, or
 *           another schema of the same externalSystem. No undefined references.
 */
function checkExternalSchemas(system, diagnostics) {
  const exts = system.externalSystems || [];
  for (let i = 0; i < exts.length; i++) {
    const ext = exts[i];
    const extName = ext.name || `[${i}]`;
    const schemas = ext.schemas || {};
    const schemaNames = new Set(Object.keys(schemas));
    const baseLoc = `system.yaml#/externalSystems[name=${extName}]`;

    // INT-023: validate fields inside each declared schema
    for (const [schemaName, schemaFields] of Object.entries(schemas)) {
      for (let j = 0; j < (schemaFields || []).length; j++) {
        const f = schemaFields[j];
        const innerType = unwrapListType(f.type || '');
        if (!WIRE_SCALAR_TYPES.has(innerType) && !schemaNames.has(innerType)) {
          diagnostics.push({
            code: 'INT-023',
            level: 'error',
            message: `Schema "${schemaName}" in external system "${extName}": field "${f.name}" has type "${f.type}" whose base type "${innerType}" is not a wire-format scalar and is not declared in schemas of the same externalSystem.`,
            location: `${baseLoc}/schemas/${schemaName}/fields[${j}]`,
          });
        }
      }
    }

    // INT-022: validate field types in operation request/response
    for (const op of ext.operations || []) {
      const opName = op.name || '?';
      const opLoc = `${baseLoc}/operations[name=${opName}]`;

      for (const side of ['request', 'response']) {
        const fields = (op[side] && op[side].fields) || [];
        for (let j = 0; j < fields.length; j++) {
          const f = fields[j];
          const innerType = unwrapListType(f.type || '');
          if (!WIRE_SCALAR_TYPES.has(innerType) && !schemaNames.has(innerType)) {
            diagnostics.push({
              code: 'INT-022',
              level: 'error',
              message: `Operation "${opName}" ${side}.fields["${f.name}"] in external system "${extName}" has type "${f.type}" whose base type "${innerType}" is not a wire-format scalar and is not declared in externalSystems["${extName}"].schemas. Declare the schema or use a scalar type.`,
              location: `${opLoc}/${side}/fields[${j}]`,
            });
          }
        }
      }
    }
  }
}
// ─── API pública ────────────────────────────────────────────────────────────

// INT-024 — auth.type must be one of the recognised values.
const VALID_AUTH_TYPES = new Set(['api-key', 'bearer', 'oauth2-cc', 'mTLS', 'internal-jwt', 'none']);

function checkAuthTypeValid(system, bcYamls, diagnostics) {
  const validate = (auth, location) => {
    if (!auth || !auth.type) return;
    if (!VALID_AUTH_TYPES.has(auth.type)) {
      diagnostics.push({
        code: 'INT-024',
        level: 'error',
        message: `Unknown auth.type "${auth.type}". Must be one of: ${[...VALID_AUTH_TYPES].join(', ')}.`,
        location,
      });
    }
  };

  const integs = system.integrations || [];
  for (let i = 0; i < integs.length; i++) {
    validate(integs[i].auth, `system.yaml#/integrations[${i}]/auth`);
  }
  const exts = system.externalSystems || [];
  for (let i = 0; i < exts.length; i++) {
    validate(exts[i].auth, `system.yaml#/externalSystems[${i}]/auth`);
  }
  for (const bc of bcYamls) {
    const outbounds = ((bc.integrations || {}).outbound) || [];
    for (let i = 0; i < outbounds.length; i++) {
      validate(outbounds[i].auth, `${bc.bc}.yaml#/integrations/outbound[${i}]/auth`);
    }
  }
}

function checkOAuth2ClientCredentials(system, bcYamls, diagnostics) {
  const isCc = (a) => a && a.type === 'oauth2-cc';
  const validateAuth = (auth, location) => {
    if (!isCc(auth)) return;
    if (!auth.tokenEndpoint) {
      diagnostics.push({
        code: 'INT-015',
        level: 'error',
        message: `auth.type: oauth2-cc requires "tokenEndpoint".`,
        location,
      });
    }
    if (!auth.credentialKey) {
      diagnostics.push({
        code: 'INT-015',
        level: 'error',
        message: `auth.type: oauth2-cc requires "credentialKey" (registration id used to look up client credentials).`,
        location,
      });
    }
  };

  const integs = system.integrations || [];
  for (let i = 0; i < integs.length; i++) {
    validateAuth(integs[i].auth, `system.yaml#/integrations[${i}]/auth`);
  }
  const exts = system.externalSystems || [];
  for (let i = 0; i < exts.length; i++) {
    validateAuth(exts[i].auth, `system.yaml#/externalSystems[${i}]/auth`);
  }
  for (const bc of bcYamls) {
    const outbounds = ((bc.integrations || {}).outbound) || [];
    for (let i = 0; i < outbounds.length; i++) {
      validateAuth(outbounds[i].auth, `${bc.bc}.yaml#/integrations/outbound[${i}]/auth`);
    }
  }
}

// ─── Reglas Fase 2 — AsyncAPI ↔ bc.yaml ────────────────────────────────────

function resolveRef(doc, ref) {
  if (!ref || typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/');
  let cur = doc;
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  return cur || null;
}

/**
 * Extrae mensajes y canales de un AsyncAPI doc (2.x o 3.x).
 *
 * @returns {{
 *   messages: Map<string, { payloadFields: Map<string, object>, raw: object }>,
 *   channelsByAddress: Map<string, { messageNames: string[] }>
 * }}
 */
function extractAsyncApiContract(doc) {
  const messages = new Map();
  const channelsByAddress = new Map();
  if (!doc) return { messages, channelsByAddress };

  const components = doc.components || {};
  const componentMessages = components.messages || {};

  const buildEntry = (rawMsg) => {
    if (!rawMsg) return null;
    let payloadSchema = rawMsg.payload || null;
    if (payloadSchema && payloadSchema.$ref) {
      payloadSchema = resolveRef(doc, payloadSchema.$ref) || payloadSchema;
    }
    const payloadFields = new Map();
    if (payloadSchema && typeof payloadSchema === 'object' && payloadSchema.properties) {
      for (const [propName, propSchema] of Object.entries(payloadSchema.properties)) {
        let resolved = propSchema;
        if (propSchema && propSchema.$ref) {
          resolved = resolveRef(doc, propSchema.$ref) || propSchema;
        }
        payloadFields.set(propName, resolved);
      }
    }
    return { payloadFields, raw: rawMsg };
  };

  for (const [compKey, rawMsg] of Object.entries(componentMessages)) {
    const entry = buildEntry(rawMsg);
    if (!entry) continue;
    messages.set(compKey, entry);
    if (rawMsg.name && rawMsg.name !== compKey && !messages.has(rawMsg.name)) {
      messages.set(rawMsg.name, entry);
    }
  }

  const channels = doc.channels || {};
  for (const [chKey, chDef] of Object.entries(channels)) {
    if (!chDef || typeof chDef !== 'object') continue;
    const address = typeof chDef.address === 'string' ? chDef.address : chKey;
    const msgNames = [];

    // 2.x: publish.message.$ref / subscribe.message.$ref
    for (const op of ['publish', 'subscribe']) {
      if (chDef[op] && chDef[op].message) {
        const m = chDef[op].message;
        const refs = Array.isArray(m.oneOf) ? m.oneOf : [m];
        for (const r of refs) {
          if (r && r.$ref) {
            const parts = r.$ref.split('/');
            msgNames.push(parts[parts.length - 1]);
          } else if (r && r.name) {
            msgNames.push(r.name);
          }
        }
      }
    }

    // 3.x: chDef.messages = { id: { $ref: '#/components/messages/Foo' } }
    if (chDef.messages && typeof chDef.messages === 'object' && msgNames.length === 0) {
      for (const m of Object.values(chDef.messages)) {
        if (m && m.$ref) {
          const parts = m.$ref.split('/');
          msgNames.push(parts[parts.length - 1]);
        }
      }
    }

    channelsByAddress.set(address, { messageNames: msgNames });
  }

  return { messages, channelsByAddress };
}

function dslToJsonSchemaType(dslType) {
  if (!dslType || typeof dslType !== 'string') return null;
  const base = dslType.replace(/\(.*\)$/, '').trim();
  switch (base) {
    case 'Uuid':       return { type: 'string', format: 'uuid' };
    case 'String':
    case 'Text':       return { type: 'string' };
    case 'Integer':
    case 'Int':
    case 'Long':       return { type: 'integer' };
    case 'Float':
    case 'Double':     return { type: 'number' };
    case 'BigDecimal':
    case 'Decimal':    return { type: 'string' };
    case 'Boolean':
    case 'Bool':       return { type: 'boolean' };
    case 'Date':       return { type: 'string', format: 'date' };
    case 'DateTime':
    case 'Instant':    return { type: 'string', format: 'date-time' };
    default:           return null;
  }
}

function jsonTypesIncompatible(expected, actual) {
  if (!expected || !actual) return false;
  if (expected.type && actual.type && expected.type !== actual.type) return true;
  if (expected.format && actual.format && expected.format !== actual.format) return true;
  return false;
}

function logicalNameOf(messageKey, entry) {
  return (entry && entry.raw && entry.raw.name) ? entry.raw.name : messageKey;
}

function checkAsyncApiContractCoherence(bcYamls, asyncApiByBc, diagnostics) {
  // Canonical metadata fields live in EventMetadata (Fase 1) — ignored when
  // matching against AsyncAPI payload schemas.
  const CANONICAL_METADATA = new Set([
    'eventId', 'eventType', 'eventVersion', 'occurredAt', 'correlationId', 'causationId',
  ]);

  for (const bc of bcYamls) {
    const doc = asyncApiByBc.get(bc.bc);
    if (!doc) continue;

    const contract = extractAsyncApiContract(doc);
    const published = ((bc.domainEvents || {}).published) || [];
    const consumed  = ((bc.domainEvents || {}).consumed)  || [];
    const publishedByName = new Set(published.map((e) => e.name));
    const consumedByName  = new Set(consumed.map((e) => e.name));

    // INT-016 — every message used in any channel must be in published[] or consumed[].
    const messagesInChannels = new Set();
    for (const info of contract.channelsByAddress.values()) {
      for (const m of info.messageNames) messagesInChannels.add(m);
    }
    for (const msgKey of messagesInChannels) {
      const entry = contract.messages.get(msgKey);
      const logical = logicalNameOf(msgKey, entry);
      if (!publishedByName.has(logical) && !consumedByName.has(logical)) {
        diagnostics.push({
          code: 'INT-016',
          level: 'error',
          message: `${bc.bc}-async-api.yaml references message "${logical}" but it is not declared in domainEvents.published[] nor consumed[] of ${bc.bc}.yaml.`,
          location: `${bc.bc}-async-api.yaml#/components/messages/${msgKey}`,
        });
      }
    }

    // INT-017 — every published[] must have a logical-name match in AsyncAPI messages.
    const asyncLogicalNames = new Set();
    for (const [key, entry] of contract.messages.entries()) {
      asyncLogicalNames.add(logicalNameOf(key, entry));
    }
    for (let i = 0; i < published.length; i++) {
      const ev = published[i];
      if (!asyncLogicalNames.has(ev.name)) {
        diagnostics.push({
          code: 'INT-017',
          level: 'error',
          message: `Event "${ev.name}" is published by ${bc.bc}.yaml but has no corresponding message in ${bc.bc}-async-api.yaml#/components/messages.`,
          location: `${bc.bc}.yaml#/domainEvents/published[${i}]`,
        });
      }
    }

    // Helpers reused below.
    const channelAddressForEvent = (eventName) => {
      for (const [addr, info] of contract.channelsByAddress.entries()) {
        for (const m of info.messageNames) {
          const entry = contract.messages.get(m);
          if (logicalNameOf(m, entry) === eventName) return addr;
        }
      }
      return null;
    };
    const messageEntryForEvent = (eventName) => {
      for (const [key, entry] of contract.messages.entries()) {
        if (logicalNameOf(key, entry) === eventName) return entry;
      }
      return null;
    };

    // INT-018 + INT-019 per published event.
    for (let i = 0; i < published.length; i++) {
      const ev = published[i];
      const baseLoc = `${bc.bc}.yaml#/domainEvents/published[${i}]`;

      // INT-018 (warn) — declared channel matches AsyncAPI channel address.
      if (ev.channel) {
        const matched = channelAddressForEvent(ev.name);
        if (matched && matched !== ev.channel) {
          diagnostics.push({
            code: 'INT-018',
            level: 'warn',
            message: `Event "${ev.name}" declares channel "${ev.channel}" in ${bc.bc}.yaml but ${bc.bc}-async-api.yaml exposes the message at "${matched}".`,
            location: `${baseLoc}/channel`,
          });
        }
      }

      // INT-019 — payload field name + type subset.
      const msgEntry = messageEntryForEvent(ev.name);
      if (!msgEntry) continue; // INT-017 already reported it.

      for (let p = 0; p < (ev.payload || []).length; p++) {
        const f = ev.payload[p];
        if (!f || !f.name) continue;
        if (CANONICAL_METADATA.has(f.name)) continue;
        if (!msgEntry.payloadFields.has(f.name)) {
          diagnostics.push({
            code: 'INT-019',
            level: 'error',
            message: `Event "${ev.name}" payload field "${f.name}" (declared in ${bc.bc}.yaml) is missing from the AsyncAPI message schema.`,
            location: `${baseLoc}/payload[${p}]`,
          });
          continue;
        }
        const expected = dslToJsonSchemaType(f.type);
        const actual = msgEntry.payloadFields.get(f.name) || {};
        if (expected && jsonTypesIncompatible(expected, actual)) {
          diagnostics.push({
            code: 'INT-019',
            level: 'warn',
            message: `Event "${ev.name}" payload field "${f.name}" type drift: ${bc.bc}.yaml declares "${f.type}" (${expected.type}${expected.format ? '/' + expected.format : ''}) but AsyncAPI declares "${actual.type || '?'}${actual.format ? '/' + actual.format : ''}".`,
            location: `${baseLoc}/payload[${p}]/type`,
          });
        }
      }
    }
  }
}

function checkConsumerPayloadSubset(bcYamls, bcIndex, diagnostics) {
  // INT-020 — consumed[].payload field names must be a subset of the producer's
  // published[].payload.
  for (const bc of bcYamls) {
    const consumed = ((bc.domainEvents || {}).consumed) || [];
    for (let i = 0; i < consumed.length; i++) {
      const ev = consumed[i];
      if (!ev || !ev.name) continue;
      const producerName = ev.sourceBc || ev.from || null;
      if (!producerName) continue;
      const producer = bcIndex.get(producerName);
      if (!producer) continue;
      const producerEvent = (((producer.domainEvents || {}).published) || [])
        .find((p) => p.name === ev.name);
      if (!producerEvent) continue;

      const producerNames = new Set((producerEvent.payload || []).map((f) => f.name));
      const loc = `${bc.bc}.yaml#/domainEvents/consumed[${i}]`;
      const fields = ev.payload || [];
      for (let p = 0; p < fields.length; p++) {
        const f = fields[p];
        if (!f || !f.name) continue;
        if (!producerNames.has(f.name)) {
          diagnostics.push({
            code: 'INT-020',
            level: 'error',
            message: `${bc.bc} consumes "${ev.name}" with payload field "${f.name}" that is not published by ${producerName}.`,
            location: `${loc}/payload[${p}]`,
          });
        }
      }
    }
  }
}

function checkAuthContextInEventPayload(bcYamls, diagnostics) {
  // INT-025 — source: auth-context is not a valid origin for domainEvents.published[].payload[].
  // The aggregate must be agnostic to security concerns; the value must be passed as an
  // explicit param (source: param) resolved by the application handler before calling the
  // domain method.
  for (const bc of bcYamls) {
    const published = ((bc.domainEvents || {}).published) || [];
    for (let i = 0; i < published.length; i++) {
      const ev = published[i];
      for (let p = 0; p < (ev.payload || []).length; p++) {
        const f = ev.payload[p];
        if (!f || !f.name) continue;
        if (f.source === 'auth-context') {
          diagnostics.push({
            code: 'INT-025',
            level: 'error',
            message: `Event "${ev.name}" payload field "${f.name}" declares source: auth-context, which is not allowed in domainEvents.published[].payload[]. ` +
              `Aggregates must be agnostic to security. Declare the field as source: param, ` +
              `add it to domainMethods[].params, and resolve SecurityContext in the application handler.`,
            location: `${bc.bc}.yaml#/domainEvents/published[${i}]/payload[${p}]`,
          });
        }
      }
    }
  }
}

function checkHiddenFieldLeak(bcYamls, _bcIndex, diagnostics) {
  // INT-021 — published payload field names must not collide with aggregate
  // properties marked hidden:true on the producing BC, unless the event opts
  // in via allowHiddenLeak:true.
  for (const bc of bcYamls) {
    const aggregates = bc.aggregates || [];
    const hiddenFields = new Set();
    for (const agg of aggregates) {
      for (const prop of agg.properties || []) {
        if (prop && prop.hidden === true && prop.name) hiddenFields.add(prop.name);
      }
    }
    if (hiddenFields.size === 0) continue;

    const published = ((bc.domainEvents || {}).published) || [];
    for (let i = 0; i < published.length; i++) {
      const ev = published[i];
      if (ev.allowHiddenLeak === true) continue;
      const baseLoc = `${bc.bc}.yaml#/domainEvents/published[${i}]`;
      for (let p = 0; p < (ev.payload || []).length; p++) {
        const f = ev.payload[p];
        if (!f || !f.name) continue;
        if (hiddenFields.has(f.name)) {
          diagnostics.push({
            code: 'INT-021',
            level: 'error',
            message: `Event "${ev.name}" payload exposes field "${f.name}" which is marked hidden:true on an aggregate of ${bc.bc}. Add allowHiddenLeak:true on the event to acknowledge the leak, or remove the field.`,
            location: `${baseLoc}/payload[${p}]`,
          });
        }
      }
    }
  }
}

/**
 * GEN-WARN: cada campo en consumed[].payload[] cuyo tipo no es escalar y no está
 * declarado en valueObjects[] ni enums[] del BC consumidor producirá un import
 * apuntando a una clase inexistente. El código no compilaría.
 * El diseñador debe re-declarar el VO en valueObjects[] del BC consumidor (Option A).
 */
function checkConsumedPayloadTypes(bcYamls, diagnostics) {
  // Tipos escalares que type-mapper.js resuelve sin necesidad de import de dominio
  const SCALAR_TYPES = new Set([
    'String', 'Integer', 'Long', 'Double', 'Float', 'Boolean', 'Decimal',
    'BigDecimal', 'Uuid', 'DateTime', 'Date', 'LocalDate', 'LocalDateTime',
    'Instant', 'ZonedDateTime', 'OffsetDateTime', 'LocalTime',
    'Short', 'Byte', 'Character',
  ]);

  for (const bc of bcYamls) {
    const bcName = bc.bc || bc.name || '?';
    const voNames = new Set((bc.valueObjects || []).map((v) => v.name));
    const enumNames = new Set((bc.enums || []).map((e) => e.name));
    const eventDtoNames = new Set((bc.eventDtos || []).map((d) => d.name));

    for (const ev of (bc.domainEvents || {}).consumed || []) {
      for (const field of (ev.payload || [])) {
        const rawType = field.type || '';
        // Unwrap List[T] → T
        const listMatch = /^List\[(.+)\]$/.exec(rawType);
        const innerType = listMatch ? listMatch[1] : rawType;
        // Strip parametrized types like String(200) → String
        const baseType = innerType.replace(/\(.*\)/, '').trim();

        if (!SCALAR_TYPES.has(baseType) && !voNames.has(baseType) && !enumNames.has(baseType) && !eventDtoNames.has(baseType)) {
          diagnostics.push({
            code: 'GEN-WARN-001',
            level: 'warn',
            message:
              `BC "${bcName}" — consumed event "${ev.name}" payload field "${field.name}" ` +
              `has type "${rawType}" which is not a scalar, enum, valueObject, nor eventDto declared in this BC. ` +
              `If this is a VO from the producer BC, re-declare it in eventDtos[] of this BC (recommended) or valueObjects[] (Option A).`,
            location: `${bcName}.domainEvents.consumed[${ev.name}].payload[${field.name}]`,
          });
        }
      }
    }
  }
}

function checkEventParamSourceCoverage(bcYamls, diagnostics) {
  // INT-026 — every payload field with source: param must correspond to a param
  // declared in at least one domainMethod that emits that event.
  // If the field is missing from all emitting method signatures, the generator
  // silently emits null in the raised event, which causes a runtime data loss bug.
  for (const bc of bcYamls) {
    // Build map: eventName → Set<paramName> collected from all domainMethods that emit it.
    const eventParamNames = new Map();
    for (const agg of bc.aggregates || []) {
      for (const dm of agg.domainMethods || []) {
        const paramNames = new Set((dm.params || []).map((p) => p.name).filter(Boolean));
        for (const evName of dm.emitsList || []) {
          if (!eventParamNames.has(evName)) eventParamNames.set(evName, new Set());
          for (const n of paramNames) eventParamNames.get(evName).add(n);
        }
      }
    }

    const published = ((bc.domainEvents || {}).published) || [];
    for (let i = 0; i < published.length; i++) {
      const ev = published[i];
      const paramNames = eventParamNames.get(ev.name) || new Set();
      for (let p = 0; p < (ev.payload || []).length; p++) {
        const f = ev.payload[p];
        if (!f || f.source !== 'param') continue;
        const pname = f.param || f.name;
        if (!paramNames.has(pname)) {
          diagnostics.push({
            code: 'INT-026',
            level: 'error',
            message: `Event "${ev.name}" payload field "${f.name}" declares source: param (resolving to param "${pname}"), ` +
              `but no domainMethod that emits "${ev.name}" declares a param named "${pname}". ` +
              `Add the param to domainMethods[].params[] or fix the param/field name.`,
            location: `${bc.bc}.yaml#/domainEvents/published[${i}]/payload[${p}]`,
          });
        }
      }
    }
  }
}

/**
 * Ejecuta todas las reglas de validación de integraciones.
 *
 * @param {object} system    — resultado de readSystemYaml()
 * @param {object[]} bcYamls — array de docs leídos por readBcYaml()
 * @param {string} archDir   — ruta absoluta a arch/ (para verificar archivos)
 * @param {Map<string, object>} [asyncApiByBc] — bcName → AsyncAPI doc crudo (opcional)
 * @returns {Diagnostic[]}
 */
function validateIntegrationCoherence(system, bcYamls, archDir, asyncApiByBc) {
  const diagnostics = [];
  const bcIndex = indexBcYamls(bcYamls);
  const externalNames = new Set((system.externalSystems || []).map((e) => e.name));

  // BCs declared in system.yaml but without a YAML file yet (incremental design workflow).
  // These are downgraded to warnings instead of errors so the generator can build
  // already-designed BCs without waiting for all BCs to be designed first.
  const declaredBcNames = new Set((system.boundedContexts || []).map((bc) => bc.name));
  const undesignedBcs = new Set([...declaredBcNames].filter((n) => !bcIndex.has(n)));

  checkSystemIntegrations(system, bcIndex, archDir, externalNames, diagnostics);
  checkBcOutboundReciprocity(system, bcYamls, externalNames, diagnostics);
  checkOrphanConsumers(bcYamls, undesignedBcs, diagnostics);
  checkPersistentProjections(bcYamls, bcIndex, diagnostics);
  checkSagas(system, bcIndex, undesignedBcs, diagnostics);
  checkAuthTypeValid(system, bcYamls, diagnostics);
  checkOAuth2ClientCredentials(system, bcYamls, diagnostics);
  checkExternalSchemas(system, diagnostics);

  if (asyncApiByBc && asyncApiByBc.size > 0) {
    checkAsyncApiContractCoherence(bcYamls, asyncApiByBc, diagnostics);
    checkConsumerPayloadSubset(bcYamls, bcIndex, diagnostics);
  }
  checkHiddenFieldLeak(bcYamls, bcIndex, diagnostics);
  checkAuthContextInEventPayload(bcYamls, diagnostics);
  checkConsumedPayloadTypes(bcYamls, diagnostics);
  checkEventParamSourceCoverage(bcYamls, diagnostics);

  return diagnostics;
}

/**
 * Imprime los diagnósticos por consola y devuelve true si hay errores.
 * @param {Diagnostic[]} diagnostics
 * @param {object} logger
 * @returns {{ hasErrors: boolean, errors: number, warnings: number }}
 */
function reportDiagnostics(diagnostics, logger) {
  let errors = 0;
  let warnings = 0;
  for (const d of diagnostics) {
    const line = `[${d.code}] ${d.message}  (${d.location})`;
    if (d.level === 'error') {
      logger.error(line);
      errors++;
    } else {
      logger.warn(line);
      warnings++;
    }
  }
  return { hasErrors: errors > 0, errors, warnings };
}

module.exports = {
  validateIntegrationCoherence,
  reportDiagnostics,
  expectedEventChannel,
};
