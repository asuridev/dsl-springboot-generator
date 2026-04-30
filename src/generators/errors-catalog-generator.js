'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { buildErrorMap } = require('./application-generator');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

/**
 * [Phase 4, Gap E7] Generate `docs/errors/{bc}-errors-catalog.md` with a
 * reverse-matrix of every error declared in the BC and the design artifacts
 * that reference it (use cases, aggregates, validations, lookups, infra
 * triggers). Purely descriptive; does not affect generated Java.
 *
 * The catalog helps reviewers and humans answer:
 *   - Which use case throws this error?
 *   - Is this error orphaned (declared but never wired)?
 *   - What HTTP status will the client see?
 *
 * @param {object} bcYaml          parsed `arch/{bc}/{bc}.yaml`
 * @param {object} config          generator config (only packageName used)
 * @param {string} outputDir       project root (catalog written under docs/errors)
 */
async function generateErrorsCatalog(bcYaml, config, outputDir) {
  const bcName = bcYaml.bc;
  const errors = bcYaml.errors || [];
  if (errors.length === 0) return;

  const errorMap = buildErrorMap(errors);

  // ── Build the references map: errorCode -> [{kind, source, description}]
  const refs = new Map();
  const ref = (code, entry) => {
    if (!code) return;
    if (!refs.has(code)) refs.set(code, []);
    refs.get(code).push(entry);
  };

  // Aggregates: domainRules
  for (const agg of bcYaml.aggregates || []) {
    for (const rule of agg.domainRules || []) {
      if (rule.errorCode) {
        ref(rule.errorCode, {
          kind: 'domainRule',
          source: `aggregate \`${agg.name}\` rule \`${rule.id}\` (type: ${rule.type})`,
        });
      }
    }
  }

  // Use cases: notFoundError, lookups, fkValidations, validations
  for (const uc of bcYaml.useCases || []) {
    if (uc.notFoundError) {
      const codes = Array.isArray(uc.notFoundError) ? uc.notFoundError : [uc.notFoundError];
      for (const code of codes) {
        ref(code, {
          kind: 'useCase.notFoundError',
          source: `useCase \`${uc.id}\` (${uc.name})`,
        });
      }
    }
    for (const lk of uc.lookups || []) {
      ref(lk.errorCode, {
        kind: 'useCase.lookup',
        source: `useCase \`${uc.id}\` lookup on \`${lk.param}\``,
      });
    }
    for (const fk of uc.fkValidations || []) {
      ref(fk.errorCode, {
        kind: 'useCase.fkValidation',
        source: `useCase \`${uc.id}\` fkValidation \`${fk.field || fk.param || ''}\``,
      });
    }
    for (const v of uc.validations || []) {
      if (v.errorCode) {
        ref(v.errorCode, {
          kind: 'useCase.validation',
          source: `useCase \`${uc.id}\` validation \`${v.id}\``,
        });
      }
    }
  }

  // Build rows
  const rows = errors.map((err) => {
    const entry = errorMap[err.code] || {};
    const javaClass = entry.errorType || err.errorType || '(unresolved)';
    const httpStatus = err.httpStatus != null ? err.httpStatus : (err.kind === 'infrastructure' ? 503 : 422);
    const kind = err.kind || 'business';
    const usedFor = err.usedFor || 'auto';
    const triggeredBy = err.triggeredBy || null;
    const description = (err.description || '').trim().split('\n').map((s) => s.trim()).join(' ');
    const references = refs.get(err.code) || [];
    return {
      code: err.code,
      httpStatus,
      kind,
      usedFor,
      javaClass,
      description,
      triggeredBy,
      chainable: err.chainable === true,
      messageTemplate: err.messageTemplate || null,
      args: err.args || [],
      references,
      orphan: references.length === 0 && usedFor !== 'manual' && kind !== 'infrastructure',
    };
  });

  const destPath = path.join(outputDir, 'docs', 'errors', `${bcName}-errors-catalog.md`);
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'docs', 'ErrorsCatalog.md.ejs'),
    destPath,
    { bcName, packageName: config.packageName, rows }
  );
}

module.exports = { generateErrorsCatalog };
