'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPackagePath } = require('../utils/naming');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

/**
 * Generates shared request-idempotency artifacts.
 *
 * Triggered when at least one use case across all bounded contexts declares
 * a top-level `idempotency` block. Emits:
 *
 *   - shared/infrastructure/web/Idempotent.java                  (annotation)
 *   - shared/infrastructure/web/IdempotencyStore.java            (port)
 *   - shared/infrastructure/web/JdbcIdempotencyStore.java        (DB adapter)
 *   - shared/infrastructure/web/IdempotencyRequestJpa.java
 *   - shared/infrastructure/web/IdempotencyRequestJpaRepository.java
 *   - shared/infrastructure/web/IdempotencyFilter.java
 *   - src/main/resources/db/migration/V3__request_idempotency.sql
 *
 * derived_from: useCases[*].idempotency
 *
 * @param {object[]} bcYamls   parsed bounded-context YAMLs
 * @param {object}   config    resolved CLI config (packageName, ...)
 * @param {string}   outputDir project root
 * @returns {{enabled: boolean, useCaseIds: string[]}}
 */
async function generateRequestIdempotencyArtifacts(bcYamls, config, outputDir) {
  const useCaseIds = collectIdempotentUseCases(bcYamls);
  if (useCaseIds.length === 0) {
    return { enabled: false, useCaseIds: [] };
  }

  const { packageName } = config;
  const javaMainDir = path.join(
    outputDir, 'src', 'main', 'java',
    ...toPackagePath(packageName).split('/')
  );
  const webDir = path.join(javaMainDir, 'shared', 'infrastructure', 'web');

  const sharedFiles = [
    'Idempotent.java',
    'IdempotencyStore.java',
    'JdbcIdempotencyStore.java',
    'IdempotencyRequestJpa.java',
    'IdempotencyRequestJpaRepository.java',
    'IdempotencyFilter.java',
  ];
  for (const file of sharedFiles) {
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'infrastructure', 'web', `${file}.ejs`),
      path.join(webDir, file),
      { packageName }
    );
  }

  const migrationDir = path.join(outputDir, 'src', 'main', 'resources', 'db', 'migration');
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'base', 'resources', 'db', 'migration', 'V3__request_idempotency.sql.ejs'),
    path.join(migrationDir, 'V3__request_idempotency.sql'),
    {}
  );

  return { enabled: true, useCaseIds };
}

function collectIdempotentUseCases(bcYamls) {
  const ids = [];
  for (const bcYaml of bcYamls || []) {
    const useCases = (bcYaml && bcYaml.useCases) || [];
    for (const uc of useCases) {
      if (uc && uc.idempotency) ids.push(uc.id);
    }
  }
  return ids;
}

module.exports = { generateRequestIdempotencyArtifacts };
