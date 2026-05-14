'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPackagePath } = require('../utils/naming');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

/**
 * Generates shared transactional-outbox and consumer-idempotency artifacts.
 *
 * Driven by system.yaml#/infrastructure/reliability:
 *   reliability.outbox             → OutboxEventJpa, repository, broker-specific OutboxRelay
 *   reliability.consumerIdempotency → ProcessedEventJpa, repository, IdempotencyGuard
 *
 * Both flags also emit a Flyway V1__reliability.sql migration with the
 * required tables (only sections corresponding to the enabled flags).
 *
 * @param {object} system     parsed system.yaml
 * @param {object} config     resolved CLI config (packageName, broker, ...)
 * @param {string} outputDir  project root
 * @returns {{outboxEnabled: boolean, idempotencyEnabled: boolean, sqlGenerated: boolean}}
 */
async function generateOutboxArtifacts(system, config, outputDir) {
  const reliability = (system.infrastructure && system.infrastructure.reliability) || {};
  const outboxEnabled = !!reliability.outbox;
  const idempotencyEnabled = !!reliability.consumerIdempotency;

  const outboxRetentionDays = typeof reliability.outboxRetentionDays === 'number' ? reliability.outboxRetentionDays : null;
  const purgeEnabled = outboxRetentionDays !== null && outboxRetentionDays >= 1;
  const retentionDays = purgeEnabled ? outboxRetentionDays : 7;

  const processedEventRetentionDays = typeof reliability.processedEventRetentionDays === 'number' ? reliability.processedEventRetentionDays : null;
  const idempotencyPurgeEnabled = processedEventRetentionDays !== null && processedEventRetentionDays >= 1;
  const idempotencyRetentionDays = idempotencyPurgeEnabled ? processedEventRetentionDays : 7;

  if (!outboxEnabled && !idempotencyEnabled) {
    return { outboxEnabled: false, idempotencyEnabled: false, sqlGenerated: false };
  }

  const { packageName } = config;
  const javaMainDir = path.join(
    outputDir, 'src', 'main', 'java',
    ...toPackagePath(packageName).split('/')
  );

  if (outboxEnabled) {
    const outboxDir = path.join(javaMainDir, 'shared', 'infrastructure', 'outbox');

    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'outbox', 'OutboxEventJpa.java.ejs'),
      path.join(outboxDir, 'OutboxEventJpa.java'),
      { packageName }
    );

    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'outbox', 'OutboxEventJpaRepository.java.ejs'),
      path.join(outboxDir, 'OutboxEventJpaRepository.java'),
      { packageName, purgeEnabled, retentionDays }
    );

    if (!config.broker) {
      throw new Error(
        'outbox: true requires a broker to be configured (kafka or rabbitmq) in dsl-springboot.json'
      );
    }
    const relayTemplate = config.broker === 'kafka'
      ? 'OutboxRelayKafka.java.ejs'
      : 'OutboxRelayRabbit.java.ejs';
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'outbox', relayTemplate),
      path.join(outboxDir, 'OutboxRelay.java'),
      { packageName, purgeEnabled, retentionDays }
    );
  }

  if (idempotencyEnabled) {
    const idemDir = path.join(javaMainDir, 'shared', 'infrastructure', 'idempotency');

    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'outbox', 'ProcessedEventJpa.java.ejs'),
      path.join(idemDir, 'ProcessedEventJpa.java'),
      { packageName }
    );

    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'outbox', 'ProcessedEventJpaRepository.java.ejs'),
      path.join(idemDir, 'ProcessedEventJpaRepository.java'),
      { packageName, idempotencyPurgeEnabled, idempotencyRetentionDays }
    );

    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'outbox', 'IdempotencyGuard.java.ejs'),
      path.join(idemDir, 'IdempotencyGuard.java'),
      { packageName, idempotencyPurgeEnabled, idempotencyRetentionDays }
    );
  }

  // Flyway migration emitting just the required tables
  const migrationDir = path.join(outputDir, 'src', 'main', 'resources', 'db', 'migration');
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'base', 'resources', 'db', 'migration', 'V1__reliability.sql.ejs'),
    path.join(migrationDir, 'V1__reliability.sql'),
    { outboxEnabled, consumerIdempotencyEnabled: idempotencyEnabled }
  );

  return { outboxEnabled, idempotencyEnabled, sqlGenerated: true };
}

module.exports = { generateOutboxArtifacts };
