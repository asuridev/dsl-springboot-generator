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

  // 3. Per-saga descriptor
  for (const saga of list) {
    if (!saga || !saga.name) continue;
    const sagaPascal = toPascalCase(saga.name);
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'application', 'sagas', 'SagaSteps.java.ejs'),
      path.join(sagasDir, `${sagaPascal}Steps.java`),
      {
        packageName,
        sagaName: saga.name,
        sagaPascal,
        description: (saga.description || '').trim(),
        trigger: saga.trigger || { event: 'Unknown', bc: 'unknown' },
        steps: saga.steps || [],
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
