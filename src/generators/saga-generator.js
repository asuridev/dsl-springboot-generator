'use strict';

/**
 * Phase 4 — Saga choreography generator.
 *
 * Inputs:
 *   - system.sagas[]  (parsed from system.yaml#/sagas — see system-yaml-reader.js)
 *
 * Outputs (only when system.sagas is non-empty):
 *   - shared/domain/annotations/SagaStep.java
 *   - shared/infrastructure/correlation/CorrelationContext.java
 *   - shared/application/sagas/<SagaName>Steps.java         (one per saga)
 *
 * Backward-compatibility: if no sagas are declared, this generator is a no-op
 * and produces zero files — keeping the byte-identical baseline guarantee.
 */

const path = require('path');
const ejs = require('ejs');
const fs = require('fs-extra');
const { toPascalCase, toPackagePath } = require('../utils/naming');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

async function renderAndWrite(templatePath, outPath, ctx) {
  const tpl = await fs.readFile(templatePath, 'utf-8');
  const out = ejs.render(tpl, ctx, { async: false });
  await fs.ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, out, 'utf-8');
}

// ─── Input sanitisation helpers ───────────────────────────────────────────────

/**
 * Escapes characters that would break a Java string literal (backslash, double-
 * quote) or introduce unexpected line breaks inside a single-line annotation
 * attribute or constant value.
 *
 * Safe to apply to saga names, event names, and BC names before embedding
 * them in `"<value>"` Java string contexts.
 */
function escapeJavaString(value) {
  if (typeof value !== 'string') return String(value === undefined ? '' : value);
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Sanitises a Javadoc description so it cannot prematurely close the surrounding
 * /** ... *​/ comment block.  Replaces every occurrence of `*​/` with `* /`.
 */
function sanitizeJavadoc(text) {
  if (!text) return '';
  return text.replace(/\*\//g, '* /');
}

// ─── Pre-generation validation ────────────────────────────────────────────────

/**
 * Validates the sagas list before any file is written.
 * Throws a descriptive Error on the first detected problem so the user can fix
 * system.yaml before the generator attempts to produce broken Java code.
 *
 * Checks:
 *   1. Every step must declare a numeric integer `order` field.
 *   2. `order` values must be unique within a single saga.
 *   3. `compensation` must be a plain string (not an object).
 *
 * @param {object[]} list — normalised sagas array (guaranteed non-empty by caller)
 */
function validateSagaList(list) {
  for (const saga of list) {
    if (!saga || !saga.name) continue;
    const steps = saga.steps || [];
    const seenOrders = new Set();

    steps.forEach((step, idx) => {
      const pos = `saga "${saga.name}" step[${idx}]`;

      // Check 1 — order must be present and an integer
      if (step.order === undefined || step.order === null) {
        throw new Error(
          `[saga-generator] ${pos}: el campo "order" es requerido pero no está definido. ` +
            `Agrega "order: ${idx + 1}" al paso en system.yaml.`
        );
      }
      if (typeof step.order !== 'number' || !Number.isInteger(step.order)) {
        throw new Error(
          `[saga-generator] ${pos}: el campo "order" debe ser un entero, ` +
            `recibido: ${JSON.stringify(step.order)}.`
        );
      }

      // Check 2 — order must be unique inside the same saga
      if (seenOrders.has(step.order)) {
        throw new Error(
          `[saga-generator] ${pos}: el valor "order: ${step.order}" está duplicado ` +
            `en la saga "${saga.name}". Cada paso debe tener un "order" único.`
        );
      }
      seenOrders.add(step.order);

      // Check 3 — compensation, when present, must be a plain string
      if (step.compensation !== undefined && typeof step.compensation !== 'string') {
        throw new Error(
          `[saga-generator] ${pos}: el campo "compensation" debe ser un string ` +
            `PascalCase (nombre del evento de compensación), no un objeto. ` +
            `Recibido: ${JSON.stringify(step.compensation)}. Ver references/saga-pattern-reference.md §10.4.`
        );
      }
    });
  }
}

/**
 * @param {object[]} sagas      — system.sagas (may be empty/undefined)
 * @param {object} config       — { packageName }
 * @param {string} outputDir
 * @returns {Promise<{ count: number, sagas: object[] }>}
 */
async function generateSagaArtifacts(sagas, config, outputDir) {
  const list = Array.isArray(sagas) ? sagas : [];
  if (list.length === 0) {
    return { count: 0, sagas: [] };
  }

  // Fail-fast: detect structural problems before writing any file (BUG-1, BUG-2, BUG-5)
  validateSagaList(list);

  const packageName = config.packageName;
  const javaRoot = path.join(
    outputDir,
    'src',
    'main',
    'java',
    ...toPackagePath(packageName).split('/')
  );

  const annotationsDir = path.join(javaRoot, 'shared', 'domain', 'annotations');
  const correlationDir = path.join(javaRoot, 'shared', 'infrastructure', 'correlation');
  const webDir         = path.join(javaRoot, 'shared', 'infrastructure', 'web');
  const sagasDir       = path.join(javaRoot, 'shared', 'application', 'sagas');

  // 1. SagaStep annotation (singleton)
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'domain', 'annotations', 'SagaStep.java.ejs'),
    path.join(annotationsDir, 'SagaStep.java'),
    { packageName }
  );

  // 2. CorrelationContext (singleton)
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'infrastructure', 'correlation', 'CorrelationContext.java.ejs'),
    path.join(correlationDir, 'CorrelationContext.java'),
    { packageName }
  );

  // [G19] CorrelationFilter — HTTP entry-point that opens the correlation
  // context for every request, completing the end-to-end propagation chain
  // (HTTP → use cases → domain events → outbound messaging).
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'infrastructure', 'web', 'CorrelationFilter.java.ejs'),
    path.join(webDir, 'CorrelationFilter.java'),
    { packageName }
  );

  // 3. Per-saga descriptor
  for (const saga of list) {
    if (!saga || !saga.name) continue;
    const sagaPascal = toPascalCase(saga.name);

    // Sanitise string values that will be embedded in Java string literals
    // to prevent broken literals from special characters (BUG-4).
    const rawTrigger = saga.trigger || {};
    const safeTrigger = {
      event: escapeJavaString(rawTrigger.event || 'Unknown'),
      bc: escapeJavaString(rawTrigger.bc || 'unknown'),
    };
    const safeSteps = (saga.steps || []).map((s) => ({
      order: s.order,
      bc: escapeJavaString(s.bc || ''),
      triggeredBy: escapeJavaString(s.triggeredBy || ''),
      onSuccess: s.onSuccess ? escapeJavaString(s.onSuccess) : undefined,
      onFailure: s.onFailure ? escapeJavaString(s.onFailure) : undefined,
      compensation: s.compensation ? escapeJavaString(s.compensation) : undefined,
    }));

    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'application', 'sagas', 'SagaSteps.java.ejs'),
      path.join(sagasDir, `${sagaPascal}Steps.java`),
      {
        packageName,
        sagaName: escapeJavaString(saga.name),
        sagaPascal,
        // BUG-3: sanitise description to prevent premature Javadoc comment close
        description: sanitizeJavadoc((saga.description || '').trim()),
        trigger: safeTrigger,
        steps: safeSteps,
      }
    );
  }

  return { count: list.length, sagas: list };
}

/**
 * Builds an index { eventName → [{ saga, order, role, bc }] } so consumers
 * (messaging-generator) can decide whether to annotate a handler with @SagaStep.
 *
 * Roles (mirror SagaStep.Role):
 *   TRIGGER       — saga.trigger.event
 *   SUCCESS       — step.onSuccess
 *   FAILURE       — step.onFailure
 *   COMPENSATION  — step.compensation
 */
function buildSagaEventIndex(sagas) {
  const index = new Map();
  const list = Array.isArray(sagas) ? sagas : [];
  const push = (eventName, entry) => {
    if (!eventName) return;
    if (!index.has(eventName)) index.set(eventName, []);
    index.get(eventName).push(entry);
  };

  for (const saga of list) {
    if (!saga || !saga.name) continue;
    if (saga.trigger && saga.trigger.event) {
      push(saga.trigger.event, {
        saga: saga.name,
        order: 0,
        role: 'TRIGGER',
        bc: saga.trigger.bc || null,
      });
    }
    for (const step of saga.steps || []) {
      const order = step.order || 0;
      const bc = step.bc || null;
      if (step.onSuccess)    push(step.onSuccess,   { saga: saga.name, order, role: 'SUCCESS',      bc });
      if (step.onFailure)    push(step.onFailure,   { saga: saga.name, order, role: 'FAILURE',      bc });
      if (step.compensation) push(step.compensation,{ saga: saga.name, order, role: 'COMPENSATION', bc });
    }
  }
  return index;
}

module.exports = {
  generateSagaArtifacts,
  buildSagaEventIndex,
};
