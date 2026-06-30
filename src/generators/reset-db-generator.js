'use strict';

const path = require('path');
const fs = require('fs-extra');
const { renderTemplate } = require('../utils/template-engine');
const { loadParameters } = require('../utils/config-manager');
const { getTruncateStatements } = require('../utils/sql-dialect');
const { collectDomainTables } = require('./jpa-entity-generator');
const logger = require('../utils/logger');

const DOCKER_TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates', 'base', 'docker');

/**
 * Generates `reset-db.sh` at the root of the output directory.
 *
 * The script truncates the domain tables of every BC plus the idempotency/outbox
 * log tables (when reliability is enabled), so Phase 3 flow validation starts each
 * run from a clean state and the `Given` preconditions of the flows hold again.
 * `flyway_schema_history` is preserved (never listed). The DB schema itself is left
 * intact — only data is wiped.
 *
 * Skipped for H2 (in-memory, no compose), mirroring docker-compose generation.
 *
 * @param {object} resolvedConfig    config from dsl-springboot.json (database, systemName)
 * @param {object[]} allBcYamls      every BC YAML processed in this build
 * @param {object} reliabilityResult { outboxEnabled, idempotencyEnabled } from generateOutboxArtifacts
 * @param {string} outputDir
 * @returns {Promise<boolean>} true when the script was written, false when skipped
 */
async function generateResetDbScript(resolvedConfig, allBcYamls, reliabilityResult, outputDir) {
  const databaseType = resolvedConfig.database || 'postgresql';
  if (databaseType === 'h2') {
    logger.info('Skipping reset-db.sh (H2 is in-memory, no container to reset)');
    return false;
  }

  // Domain tables across all BCs (child→parent order is preserved per BC).
  const domainTables = [];
  for (const bcYaml of allBcYamls || []) {
    domainTables.push(...collectDomainTables(bcYaml));
  }

  // Idempotency / outbox log tables — wiped so re-runs aren't blocked by dedup or
  // stale outbox rows. Listed after the domain tables (no FK between them).
  const reliabilityTables = [];
  if (reliabilityResult && reliabilityResult.idempotencyEnabled) reliabilityTables.push('processed_event');
  if (reliabilityResult && reliabilityResult.outboxEnabled) reliabilityTables.push('outbox_event');

  const tables = [...domainTables, ...reliabilityTables];
  if (tables.length === 0) {
    logger.info('Skipping reset-db.sh (no domain tables to reset)');
    return false;
  }

  const systemName = resolvedConfig.systemName;
  const databaseName = systemName.replace(/[-\s]/g, '_').toLowerCase();

  const params = await loadParameters();
  const dbMeta = (params.databases || []).find((d) => d.id === databaseType) || {};
  const databaseUsername = dbMeta.defaultUser || 'postgres';
  const databasePassword = dbMeta.defaultPassword != null ? dbMeta.defaultPassword : 'postgres';
  const oracleService = dbMeta.serviceName || 'FREEPDB1';

  const truncateStatements = getTruncateStatements(databaseType, tables);

  const ctx = {
    systemName,
    databaseType,
    databaseName,
    databaseUsername,
    databasePassword,
    oracleService,
    tables,
    truncateStatements,
  };

  const src = path.join(DOCKER_TEMPLATES_DIR, 'reset-db.sh.ejs');
  const content = await renderTemplate(src, ctx);
  const dest = path.join(outputDir, 'reset-db.sh');
  await fs.outputFile(dest, content.replace(/\r\n/g, '\n'), 'utf-8');
  await fs.chmod(dest, 0o755);
  logger.success('reset-db.sh generated');
  return true;
}

module.exports = { generateResetDbScript };
