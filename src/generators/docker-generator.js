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
 * @param {object} [opts]         - optional flags: requestIdempotencyEnabled, cacheProviderMeta
 * @returns {object}
 */
function buildDockerContext(resolvedConfig, dockerImages, opts = {}) {
  const systemName = resolvedConfig.systemName;
  const databaseType = resolvedConfig.database || 'postgresql';
  // Database name derived from systemName: replace hyphens/spaces with underscores
  const databaseName = systemName.replace(/[-\s]/g, '_').toLowerCase();

  // Credentials + Oracle service come from the database catalog entry.
  const dbMeta = opts.dbMeta || {};
  const databaseUsername = dbMeta.defaultUser || 'postgres';
  const databasePassword = dbMeta.defaultPassword != null ? dbMeta.defaultPassword : 'postgres';
  const oracleService = dbMeta.serviceName || 'FREEPDB1';

  const cacheProviderMeta = opts.cacheProviderMeta || null;
  const cachePort = cacheProviderMeta ? cacheProviderMeta.port : 6379;
  const cacheProviderId = resolvedConfig.cacheProvider || null;
  const cacheImage = cacheProviderId && dockerImages[cacheProviderId]
    ? dockerImages[cacheProviderId]
    : dockerImages.redis;

  // [object storage] declared stores → MinIO services + bucket init.
  const objectStores = Array.isArray(opts.objectStores) ? opts.objectStores : [];
  const objectStoragePresent = objectStores.length > 0;

  return {
    systemName,
    databaseType,
    databaseName,
    databaseUsername,
    databasePassword,
    oracleService,
    javaVersion: resolvedConfig.javaVersion,
    broker: resolvedConfig.broker || null,
    authProvider: resolvedConfig.authProvider || null,
    requestIdempotencyEnabled: !!opts.requestIdempotencyEnabled,
    cacheImage,
    cachePort,
    // [object storage]
    objectStoragePresent,
    stores: objectStores,
    minioImage: dockerImages.minio,
    minioClientImage: dockerImages.minioClient,
    // Docker image versions (from catalog)
    postgresImage: dockerImages.postgres,
    mysqlImage: dockerImages.mysql,
    mariadbImage: dockerImages.mariadb,
    sqlserverImage: dockerImages.sqlserver,
    oracleImage: dockerImages.oracle,
    kafkaImage: dockerImages.kafka,
    kafkaZookeeperImage: dockerImages.kafkaZookeeper,
    kafkaUiImage: dockerImages.kafkaUi,
    rabbitmqImage: dockerImages.rabbitmq,
    keycloakImage: dockerImages.keycloak,
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
 * @param {object} [opts]   - optional: { requestIdempotencyEnabled, cacheProviderMeta }
 */
async function generateDockerFiles(resolvedConfig, outputDir, opts = {}) {
  const params = await loadParameters();
  const dockerImages = params.dockerImages;

  if (!dockerImages) {
    throw new Error('dockerImages section missing from stack-catalog.json');
  }

  const dbId = resolvedConfig.database || 'postgresql';
  const dbMeta = (params.databases || []).find((d) => d.id === dbId) || {};
  const ctx = buildDockerContext(resolvedConfig, dockerImages, { ...opts, dbMeta });

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

  // 2b. Merge Keycloak service if authProvider is keycloak
  if (ctx.authProvider === 'keycloak') {
    const keycloakSrc = path.join(DOCKER_TEMPLATES_DIR, 'keycloak-services.yaml.ejs');
    const keycloakContent = await renderTemplate(keycloakSrc, ctx);
    const keycloakServices = yaml.load(keycloakContent);
    Object.assign(composeObj.services, keycloakServices);
  }

  // 2c. Merge Redis/Valkey service if request idempotency is enabled
  if (ctx.requestIdempotencyEnabled) {
    const redisSrc = path.join(DOCKER_TEMPLATES_DIR, 'redis-services.yaml.ejs');
    const redisContent = await renderTemplate(redisSrc, ctx);
    const redisServices = yaml.load(redisContent);
    Object.assign(composeObj.services, redisServices);
  }

  // 2d. Merge MinIO + bucket-init services when object storage is declared
  if (ctx.objectStoragePresent) {
    const minioSrc = path.join(DOCKER_TEMPLATES_DIR, 'minio-services.yaml.ejs');
    const minioContent = await renderTemplate(minioSrc, ctx);
    const minioServices = yaml.load(minioContent);
    Object.assign(composeObj.services, minioServices);
    // Declare the named volume used by the minio service.
    composeObj.volumes = composeObj.volumes || {};
    composeObj.volumes[`${ctx.systemName}-minio-data`] = null;
  }

  // 2e. Merge SQL Server init container (creates the application database, which
  //     the mssql/server image does not auto-create).
  if (ctx.databaseType === 'sqlserver') {
    const sqlInitSrc = path.join(DOCKER_TEMPLATES_DIR, 'sqlserver-init.yaml.ejs');
    const sqlInitContent = await renderTemplate(sqlInitSrc, ctx);
    const sqlInitServices = yaml.load(sqlInitContent);
    Object.assign(composeObj.services, sqlInitServices);
  }

  // 3. Merge devtools service (always present when docker-compose is generated)
  const devtoolsSrc = path.join(DOCKER_TEMPLATES_DIR, 'devtools-service.yaml.ejs');
  const devtoolsContent = await renderTemplate(devtoolsSrc, ctx);
  const devtoolsServices = yaml.load(devtoolsContent);
  Object.assign(composeObj.services, devtoolsServices);

  // 4. Dump merged YAML and write to disk
  const finalYaml = yaml.dump(composeObj, { indent: 2, lineWidth: -1, noRefs: true });
  await fs.outputFile(path.join(outputDir, 'docker-compose.yaml'), finalYaml, 'utf-8');
  logger.success('docker-compose.yaml generated');

  // 5. Dockerfile.devtools (custom CLI toolbox for Fase 3 agent)
  const devtoolsDockerfileSrc = path.join(DOCKER_TEMPLATES_DIR, 'Dockerfile.devtools.ejs');
  const devtoolsDockerfileContent = await renderTemplate(devtoolsDockerfileSrc, ctx);
  await fs.outputFile(path.join(outputDir, 'Dockerfile.devtools'), devtoolsDockerfileContent, 'utf-8');
  logger.success('Dockerfile.devtools generated');

  // 6. validate-infra.sh (infrastructure validation script for Fase 3 agent)
  const validateSrc = path.join(DOCKER_TEMPLATES_DIR, 'validate-infra.sh.ejs');
  const validateContent = await renderTemplate(validateSrc, ctx);
  const validatePath = path.join(outputDir, 'validate-infra.sh');
  await fs.outputFile(validatePath, validateContent.replace(/\r\n/g, '\n'), 'utf-8');
  await fs.chmod(validatePath, 0o755);
  logger.success('validate-infra.sh generated');
}

module.exports = { generateDockerFiles };
