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
 *   INT-012  Toda saga step.triggeredBy debe estar publicado por algún BC
 *            (o coincidir con saga.trigger.event).
 *   INT-013  saga.trigger.event debe estar en `domainEvents.published[]` del
 *            BC `saga.trigger.bc`.
 *   INT-014  step.onSuccess / step.onFailure / step.compensation deben estar
 *            publicados por el BC `step.bc` (o por algún BC, en el caso de
 *            compensation que puede emitirse desde otro BC).
 *   INT-015  Toda integración HTTP con `auth.type: oauth2-cc` debe declarar
 *            `tokenEndpoint` y `credentialKey`. Aplica a `system.integrations[].auth`,
 *            `system.externalSystems[].auth` y `bc.integrations.outbound[].auth`.
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
        // INT-002
        if (toBc && !toConsumed.has(eventName)) {
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

function checkOrphanConsumers(bcYamls, diagnostics) {
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
        diagnostics.push({
          code: 'INT-007',
          level: 'error',
          message: `${bc.bc} consumes event "${ev.name}" but no BC publishes it.`,
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
    }
  }
}

function checkSagas(system, bcIndex, diagnostics) {
  const sagas = system.sagas || [];
  if (sagas.length === 0) return;

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
          diagnostics.push({
            code: 'INT-012',
            level: 'error',
            message: `Saga "${saga.name}" step ${step.order || i + 1}: triggeredBy "${step.triggeredBy}" is neither the saga trigger nor published by any BC.`,
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

      const checkProduced = (eventName, fieldName, allowAnyBc) => {
        if (!eventName) return;
        if (allowAnyBc) {
          if (!publishedBy.has(eventName)) {
            diagnostics.push({
              code: 'INT-014',
              level: 'error',
              message: `Saga "${saga.name}" step ${step.order || i + 1}: ${fieldName} "${eventName}" is not published by any BC.`,
              location: `${loc}/${fieldName}`,
            });
          }
        } else {
          if (!stepPublished.has(eventName)) {
            diagnostics.push({
              code: 'INT-014',
              level: 'error',
              message: `Saga "${saga.name}" step ${step.order || i + 1}: ${fieldName} "${eventName}" is not published by ${stepBc || '<missing-bc>'}.yaml#/domainEvents/published.`,
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

// ─── API pública ────────────────────────────────────────────────────────────

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

/**
 * Ejecuta todas las reglas de validación de integraciones.
 *
 * @param {object} system    — resultado de readSystemYaml()
 * @param {object[]} bcYamls — array de docs leídos por readBcYaml()
 * @param {string} archDir   — ruta absoluta a arch/ (para verificar archivos)
 * @returns {Diagnostic[]}
 */
function validateIntegrationCoherence(system, bcYamls, archDir) {
  const diagnostics = [];
  const bcIndex = indexBcYamls(bcYamls);
  const externalNames = new Set((system.externalSystems || []).map((e) => e.name));

  checkSystemIntegrations(system, bcIndex, archDir, externalNames, diagnostics);
  checkBcOutboundReciprocity(system, bcYamls, externalNames, diagnostics);
  checkOrphanConsumers(bcYamls, diagnostics);
  checkPersistentProjections(bcYamls, bcIndex, diagnostics);
  checkSagas(system, bcIndex, diagnostics);
  checkOAuth2ClientCredentials(system, bcYamls, diagnostics);

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
