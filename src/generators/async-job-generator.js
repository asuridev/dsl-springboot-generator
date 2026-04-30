'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPackagePath } = require('../utils/naming');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

/**
 * Generates shared async-job-tracking artifacts (G10).
 *
 * Triggered when at least one use case across all bounded contexts declares
 * `async: { mode: jobTracking }`. Emits:
 *
 *   - shared/application/dtos/JobReference.java                  (record returned by handlers)
 *   - shared/infrastructure/asyncJob/AsyncJobStatus.java         (lifecycle enum)
 *   - shared/infrastructure/asyncJob/AsyncJobJpa.java            (entity)
 *   - shared/infrastructure/asyncJob/AsyncJobRepository.java     (Spring Data repo)
 *   - src/main/resources/db/migration/V4__async_job.sql
 *
 * derived_from: useCases[*].async.mode = jobTracking
 *
 * @param {object[]} bcYamls   parsed bounded-context YAMLs
 * @param {object}   config    resolved CLI config (packageName, ...)
 * @param {string}   outputDir project root
 * @returns {{enabled: boolean, useCaseIds: string[]}}
 */
async function generateAsyncJobArtifacts(bcYamls, config, outputDir) {
  const useCaseIds = collectAsyncUseCases(bcYamls);
  if (useCaseIds.length === 0) {
    return { enabled: false, useCaseIds: [] };
  }

  const { packageName } = config;
  const javaMainDir = path.join(
    outputDir, 'src', 'main', 'java',
    ...toPackagePath(packageName).split('/')
  );

  const sharedDtosDir = path.join(javaMainDir, 'shared', 'application', 'dtos');
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'application', 'dtos', 'JobReference.java.ejs'),
    path.join(sharedDtosDir, 'JobReference.java'),
    { packageName }
  );

  const asyncJobDir = path.join(javaMainDir, 'shared', 'infrastructure', 'asyncJob');
  const sharedFiles = [
    'AsyncJobStatus.java',
    'AsyncJobJpa.java',
    'AsyncJobRepository.java',
  ];
  for (const file of sharedFiles) {
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'infrastructure', 'asyncJob', `${file}.ejs`),
      path.join(asyncJobDir, file),
      { packageName }
    );
  }

  const migrationDir = path.join(outputDir, 'src', 'main', 'resources', 'db', 'migration');
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'base', 'resources', 'db', 'migration', 'V4__async_job.sql.ejs'),
    path.join(migrationDir, 'V4__async_job.sql'),
    {}
  );

  return { enabled: true, useCaseIds };
}

function collectAsyncUseCases(bcYamls) {
  const ids = [];
  for (const bcYaml of bcYamls || []) {
    const useCases = (bcYaml && bcYaml.useCases) || [];
    for (const uc of useCases) {
      if (uc && uc.async && uc.async.mode === 'jobTracking') ids.push(uc.id);
    }
  }
  return ids;
}

module.exports = { generateAsyncJobArtifacts };
