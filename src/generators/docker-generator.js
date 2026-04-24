'use strict';

const path = require('path');
const fs = require('fs-extra');
const yaml = require('js-yaml');
const { renderTemplate } = require('../utils/template-engine');
const { loadParameters } = require('../utils/config-manager');
const logger = require('../utils/logger');

const DOCKER_TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates', 'base', 'docker');

/**
 * Builds the EJS context shared by all docker templates.
 *
 * @param {object} resolvedConfig - config from dsl-springboot.json (database, broker, javaVersion, systemName)
 * @param {object} dockerImages   - dockerImages section from stack-catalog.json
 * @returns {object}
 */
function buildDockerContext(resolvedConfig, dockerImages) {
  const systemName = resolvedConfig.systemName;
  const databaseType = resolvedConfig.database || 'postgresql';
  // Database name derived from systemName: replace hyphens/spaces with underscores
  const databaseName = systemName.replace(/[-\s]/g, '_').toLowerCase();

  return {
    systemName,
    databaseType,
    databaseName,
    databaseUsername: 'postgres',
    databasePassword: 'postgres',
    javaVersion: resolvedConfig.javaVersion,
    broker: resolvedConfig.broker || null,
    // Docker image versions (from catalog)
    postgresImage: dockerImages.postgres,
    mysqlImage: dockerImages.mysql,
    kafkaImage: dockerImages.kafka,
    kafkaZookeeperImage: dockerImages.kafkaZookeeper,
    kafkaUiImage: dockerImages.kafkaUi,
    rabbitmqImage: dockerImages.rabbitmq,
  };
}

/**
 * Generates docker-compose.yaml and Dockerfile at the root of the output directory.
 *
 * Rules:
 *  - Dockerfile: always generated.
 *  - docker-compose.yaml: generated only when databaseType !== 'h2'.
 *    If a message broker is selected, its services are merged into the compose.
 *
 * @param {object} resolvedConfig
 * @param {string} outputDir
 */
async function generateDockerFiles(resolvedConfig, outputDir) {
  const params = await loadParameters();
  const dockerImages = params.dockerImages;

  if (!dockerImages) {
    throw new Error('dockerImages section missing from stack-catalog.json');
  }

  const ctx = buildDockerContext(resolvedConfig, dockerImages);

  // ── Dockerfile (always) ──────────────────────────────────────────────────
  const dockerfileSrc = path.join(DOCKER_TEMPLATES_DIR, 'Dockerfile.ejs');
  const dockerfileContent = await renderTemplate(dockerfileSrc, ctx);
  await fs.outputFile(path.join(outputDir, 'Dockerfile'), dockerfileContent, 'utf-8');
  logger.success('Dockerfile generated');

  // ── docker-compose.yaml (skip for H2) ───────────────────────────────────
  if (ctx.databaseType === 'h2') {
    logger.info('Skipping docker-compose.yaml (H2 is in-memory, no container needed)');
    return;
  }

  // 1. Render base docker-compose (DB service)
  const composeSrc = path.join(DOCKER_TEMPLATES_DIR, 'docker-compose.yaml.ejs');
  const composeContent = await renderTemplate(composeSrc, ctx);
  const composeObj = yaml.load(composeContent);

  // 2. Merge broker services if applicable
  if (ctx.broker === 'kafka') {
    const kafkaSrc = path.join(DOCKER_TEMPLATES_DIR, 'kafka-services.yaml.ejs');
    const kafkaContent = await renderTemplate(kafkaSrc, ctx);
    const kafkaServices = yaml.load(kafkaContent);
    Object.assign(composeObj.services, kafkaServices);
  } else if (ctx.broker === 'rabbitmq') {
    const rabbitSrc = path.join(DOCKER_TEMPLATES_DIR, 'rabbitmq-services.yaml.ejs');
    const rabbitContent = await renderTemplate(rabbitSrc, ctx);
    const rabbitServices = yaml.load(rabbitContent);
    Object.assign(composeObj.services, rabbitServices);
  }

  // 3. Dump merged YAML and write to disk
  const finalYaml = yaml.dump(composeObj, { indent: 2, lineWidth: -1, noRefs: true });
  await fs.outputFile(path.join(outputDir, 'docker-compose.yaml'), finalYaml, 'utf-8');
  logger.success('docker-compose.yaml generated');
}

module.exports = { generateDockerFiles };
