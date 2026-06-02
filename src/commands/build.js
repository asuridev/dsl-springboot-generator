'use strict';

const path = require('path');
const fs = require('fs-extra');
const inquirer = require('inquirer');
const ora = require('ora');
const logger = require('../utils/logger');
const { configExists, readConfig, writeConfig, loadParameters } = require('../utils/config-manager');
const { readSystemYaml, validateArchDirectory } = require('../utils/system-yaml-reader');
const { generateBaseProject, generateBrokerTopologyYaml } = require('../generators/base-project-generator');
const { generateDockerFiles } = require('../generators/docker-generator');
const { generateKeycloakRealm } = require('../generators/keycloak-realm-generator');
const { generateEnums } = require('../generators/enum-generator');
const { generateValueObjects, generateEventDtos } = require('../generators/value-object-generator');
const { generateAggregates } = require('../generators/aggregate-generator');
const { generateJpaEntities } = require('../generators/jpa-entity-generator');
const { generateRepositories } = require('../generators/repository-generator');
const { generateSpecifications } = require('../generators/specifications-generator');
const { generateApplicationLayer, generateProjections } = require('../generators/application-generator');
const { generateOutboundHttpAdapters } = require('../generators/outbound-http-generator');
const { generateExternalAdapters } = require('../generators/external-adapter-generator');
const { generateOutboxArtifacts } = require('../generators/outbox-generator');
const { generateRequestIdempotencyArtifacts } = require('../generators/request-idempotency-generator');
const { generateAsyncJobArtifacts } = require('../generators/async-job-generator');
const { generateProjectionUpdaters } = require('../generators/projection-updater-generator');
const { generateSagaArtifacts } = require('../generators/saga-generator');
const { generateErrorsCatalog } = require('../generators/errors-catalog-generator');
const { generateControllerLayer } = require('../generators/controller-generator');
const { generateMessagingLayer, generateSharedBrokerConfig, buildRabbitMQTopology, buildKafkaTopology } = require('../generators/messaging-generator');
const { readBcYaml } = require('../utils/bc-yaml-reader');
const { readOpenApiYaml, readAsyncApiYaml, readInternalApiYaml } = require('../utils/arch-yaml-reader');
const { validateIntegrationCoherence, reportDiagnostics } = require('../utils/integration-validator');
const { validateOpenApiUseCases } = require('../utils/openapi-usecase-validator');

// ─── BC discovery ─────────────────────────────────────────────────────────────

/**
 * Discovers all bounded context names by scanning arch/ in the filesystem.
 * A BC is any subdirectory of arch/ (excluding system/ and review/) that contains
 * a file named {dirName}.yaml.
 * This is the authoritative source of truth — not system.yaml — so BCs added to
 * arch/ are always processed regardless of whether system.yaml was updated.
 *
 * @param {string} cwd - working directory (must have arch/ subdirectory)
 * @returns {Promise<string[]>} BC names in discovery order
 */
async function discoverBcNames(cwd) {
  const archDir = path.join(cwd, 'arch');
  const EXCLUDED = new Set(['system', 'review']);

  let entries;
  try {
    entries = await fs.readdir(archDir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Cannot read arch/ directory: ${err.message}`);
  }

  const discovered = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (EXCLUDED.has(entry.name)) continue;
    const bcYamlPath = path.join(archDir, entry.name, `${entry.name}.yaml`);
    if (await fs.pathExists(bcYamlPath)) {
      discovered.push(entry.name);
    }
  }
  return discovered;
}

/**
 * Prompts the user for first-time configuration if dsl-springboot.json does not exist.
 * @param {string} systemName
 * @param {object} system - parsed system.yaml (used to determine if messaging is needed)
 * @returns {Promise<{packageName, javaVersion, springBootVersion, database, broker, systemName}>}
 */
async function promptConfig(systemName, system) {
  console.log('');
  logger.info('No configuration found. Please provide project settings:');
  console.log('');

  const params = await loadParameters();

  const dbChoices = params.databases.map((db) => ({
    name: db.label,
    value: db.id,
  }));

  const defaultDb = params.databases.find((db) => db.id === 'postgresql') || params.databases[0];

  const needsBroker = !!(system.infrastructure && system.infrastructure.messageBroker);
  const needsAuthServer = !!system.authServer;

  const questions = [
    {
      type: 'input',
      name: 'packageName',
      message: 'Base package name (e.g. com.canastaShop):',
      validate: (v) => /^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/.test(v) || 'Invalid Java package name',
    },
    {
      type: 'list',
      name: 'javaVersion',
      message: 'Java version:',
      choices: params.java.supported,
      default: params.java.default,
    },
    {
      type: 'list',
      name: 'springBootVersion',
      message: 'Spring Boot version:',
      choices: params.springBoot.supported,
      default: params.springBoot.default,
    },
    {
      type: 'list',
      name: 'database',
      message: 'Database engine:',
      choices: dbChoices,
      default: defaultDb.id,
    },
  ];

  if (needsBroker) {
    const brokerChoices = [
      ...params.messageBrokers.map((b) => ({ name: b.label, value: b.id })),
      { name: 'None', value: null },
    ];
    questions.push({
      type: 'list',
      name: 'broker',
      message: 'Message broker:',
      choices: brokerChoices,
      default: params.messageBrokers[0].id,
    });
  }

  if (needsAuthServer) {
    questions.push({
      type: 'list',
      name: 'authProvider',
      message: 'Authorization server provider:',
      choices: params.authProviders.map((p) => ({ name: p.label, value: p.id })),
      default: params.authProviders[0].id,
    });
  }

  const cacheChoices = [
    ...( params.cacheProviders || []).map((c) => ({ name: c.label, value: c.id })),
    { name: 'None', value: null },
  ];
  questions.push({
    type: 'list',
    name: 'cacheProvider',
    message: 'Cache provider (required for request idempotency — select None if unused):',
    choices: cacheChoices,
    default: null,
  });

  const answers = await inquirer.prompt(questions);

  return {
    packageName: answers.packageName,
    javaVersion: answers.javaVersion,
    springBootVersion: answers.springBootVersion,
    database: answers.database,
    broker: needsBroker ? (answers.broker || null) : null,
    authProvider: needsAuthServer ? (answers.authProvider || null) : null,
    cacheProvider: answers.cacheProvider || null,
    systemName,
  };
}

async function readOptionalOpenApiDoc(bcName, kind) {
  try {
    return kind === 'internal'
      ? await readInternalApiYaml(bcName)
      : await readOpenApiYaml(bcName);
  } catch (err) {
    if (err.message && err.message.includes('OpenAPI YAML not found')) return null;
    throw err;
  }
}

/**
 * Main handler for the `build` command.
 * Orchestrates the full code generation pipeline.
 */
async function buildCommand(options = {}) {
  const strict = options.strict !== false;
  try {
    // ── 0. Pre-flight: validate arch/ structure in CWD ─────────────────────
    try {
      await validateArchDirectory(process.cwd());
    } catch (err) {
      logger.error(err.message);
      process.exit(1);
    }

    // ── 1. Read system.yaml to discover BCs and system name ────────────────
    const spinner = ora('Reading system architecture…').start();
    let system;
    try {
      system = await readSystemYaml();
      spinner.succeed(`System: ${system.name} — ${system.boundedContexts.length} bounded context(s)`);
    } catch (err) {
      spinner.fail(err.message);
      process.exit(1);
    }

    // ── 2. Load or prompt config ────────────────────────────────────────────
    let config;
    if (await configExists()) {
      config = await readConfig();
      logger.info(`Using saved configuration (${config.packageName}, Java ${config.javaVersion}, Spring Boot ${config.springBootVersion}, DB: ${config.database || 'postgresql'}, Broker: ${config.broker || 'none'}, Auth: ${config.authProvider || 'none'})`);
    } else {
      config = await promptConfig(system.name, system);
      await writeConfig(config);
    }

    // Normalise springBootVersion: "3.4.x" → "3.4.5" (use a pinned patch version)
    const resolvedSpringBootVersion = config.springBootVersion.replace('.x', '.5');

    // Resolve feature flags. `events.metadata.enabled` controls whether each
    // generated domain event record carries a canonical `EventMetadata`
    // component (default: true; opt-out via dsl-springboot.json).
    const metadataEnabled = !(config.events && config.events.metadata && config.events.metadata.enabled === false);

    const resolvedConfig = {
      ...config,
      springBootVersion: resolvedSpringBootVersion,
      events: { metadata: { enabled: metadataEnabled } },
    };

    // ── 3. Determine output directory ───────────────────────────────────────
    const outputDir = process.cwd();
    logger.info(`Output directory: ${outputDir}`);
    console.log('');

    // ── 3.5. Discover BCs + load all bc.yaml docs (needed early for Flyway gating) ──
    const bcNames = await discoverBcNames(outputDir);

    // Cross-check: warn about BCs declared in system.yaml but missing from arch/
    const systemBcNames = new Set(system.boundedContexts.map((bc) => bc.name));
    for (const bcName of bcNames) {
      if (!systemBcNames.has(bcName)) {
        logger.warn(`BC "${bcName}" found in arch/ but not declared in system.yaml — it will still be generated.`);
      }
    }
    for (const sysName of systemBcNames) {
      if (!bcNames.includes(sysName)) {
        logger.warn(`BC "${sysName}" declared in system.yaml but no arch/${sysName}/${sysName}.yaml found — skipping.`);
      }
    }

    const allBcYamls = [];
    const systemActorNames = new Set(
      (system.actors || [])
        .map((a) => (typeof a === 'string' ? a : a && a.name))
        .filter(Boolean)
    );
    const readBcYamlOpts = systemActorNames.size > 0 ? { systemActors: systemActorNames } : {};
    for (const bcName of bcNames) {
      try {
        allBcYamls.push(await readBcYaml(bcName, readBcYamlOpts));
      } catch (err) {
        if (err.message.includes('not found')) {
          // File not found: already warned via cross-check above, skip silently
        } else {
          logger.error(`Failed to load BC "${bcName}": ${err.message}`);
          process.exit(1);
        }
      }
    }

    // ── 3.6. Cross-YAML integration coherence (Phase 0 / INT-001..INT-021) ─────
    const archDir = path.join(outputDir, 'arch');
    const validationSpinner = ora('Validating integration coherence…').start();
    const asyncApiByBc = new Map();
    for (const bcYaml of allBcYamls) {
      try {
        const doc = await readAsyncApiYaml(bcYaml.bc);
        if (doc) asyncApiByBc.set(bcYaml.bc, doc);
      } catch (_err) {
        // AsyncAPI is optional; ignore read errors here — validators downstream warn.
      }
    }
    const diagnostics = validateIntegrationCoherence(system, allBcYamls, archDir, asyncApiByBc);
    const openApiByBc = new Map();
    const internalApiByBc = new Map();
    for (const bcYaml of allBcYamls) {
      const openApiDoc = await readOptionalOpenApiDoc(bcYaml.bc, 'public');
      const internalApiDoc = await readOptionalOpenApiDoc(bcYaml.bc, 'internal');
      if (openApiDoc) openApiByBc.set(bcYaml.bc, openApiDoc);
      if (internalApiDoc) internalApiByBc.set(bcYaml.bc, internalApiDoc);
      diagnostics.push(...validateOpenApiUseCases(bcYaml, openApiDoc, internalApiDoc));
    }
    if (diagnostics.length === 0) {
      validationSpinner.succeed('Integration and HTTP contracts validated — no issues');
    } else {
      validationSpinner.stop();
      const { hasErrors, errors, warnings } = reportDiagnostics(diagnostics, logger);
      if (hasErrors && strict) {
        logger.error(`Validation failed: ${errors} error(s), ${warnings} warning(s). Re-run with --no-strict to continue.`);
        process.exit(1);
      }
      if (hasErrors) {
        logger.warn(`Validation reported ${errors} error(s), ${warnings} warning(s) — continuing because --no-strict was set.`);
      } else {
        logger.warn(`Validation reported ${warnings} warning(s).`);
      }
    }

    // ── 4. Generate base project (gradle + shared infra) ───────────────
    const baseSpinner = ora('Generating base project structure…').start();
    try {
      await generateBaseProject(resolvedConfig, system, outputDir, allBcYamls);
      baseSpinner.succeed('Base project structure generated');
    } catch (err) {
      baseSpinner.fail(`Base project generation failed: ${err.message}`);
      throw err;
    }

    // ── 5. Generate Docker Compose and Dockerfile ────────────────────────────
    const requestIdempotencyPresent = allBcYamls.some((bc) =>
      ((bc && bc.useCases) || []).some((uc) => uc && uc.idempotency)
    );
    // [G21] Query caching also requires a cache provider (shares Redis with idempotency).
    const cacheableQueriesPresent = allBcYamls.some((bc) =>
      ((bc && bc.useCases) || []).some((uc) => uc && uc.cacheable)
    );
    const cacheNeeded = requestIdempotencyPresent || cacheableQueriesPresent;
    let cacheProviderMeta = null;
    if (cacheNeeded && resolvedConfig.cacheProvider) {
      const catalogParams = await loadParameters();
      const cacheProviders = catalogParams.cacheProviders || [];
      cacheProviderMeta = cacheProviders.find((c) => c.id === resolvedConfig.cacheProvider) || null;
    }
    if (cacheNeeded && !resolvedConfig.cacheProvider) {
      const cacheFeature = requestIdempotencyPresent ? 'idempotency' : 'cacheable queries';
      logger.error(
        `One or more use cases declare ${cacheFeature} but "cacheProvider" is not set in dsl-springboot.json. ` +
        'Add "cacheProvider": "redis" (or "valkey") to your dsl-springboot.json and re-run.'
      );
      process.exit(1);
    }
    if (cacheNeeded && resolvedConfig.cacheProvider && !cacheProviderMeta) {
      const catalogParams = await loadParameters();
      const validIds = (catalogParams.cacheProviders || []).map((c) => c.id).join(', ');
      logger.error(
        `"cacheProvider" value "${resolvedConfig.cacheProvider}" is not recognised. Valid values: ${validIds}.`
      );
      process.exit(1);
    }
    const dockerSpinner = ora('Generating Docker Compose and Dockerfile…').start();
    try {
      await generateDockerFiles(resolvedConfig, outputDir, { requestIdempotencyEnabled: cacheNeeded, cacheProviderMeta });
      dockerSpinner.succeed('Docker Compose and Dockerfile generated');
    } catch (err) {
      dockerSpinner.fail(`Docker generation failed: ${err.message}`);
      throw err;
    }

    // ── 5.5 Keycloak realm export ─────────────────────────────────────────────
    if (resolvedConfig.authProvider === 'keycloak') {
      const keycloakSpinner = ora('Generating Keycloak realm export…').start();
      try {
        await generateKeycloakRealm(allBcYamls, resolvedConfig, outputDir);
        keycloakSpinner.succeed('Keycloak realm export generated → keycloak/realm-export.json');
      } catch (err) {
        keycloakSpinner.fail(`Keycloak realm export generation failed: ${err.message}`);
        throw err;
      }
    }

    // ── 6. Per-BC domain layer generation (SP-3) ───────────────────────────
    const domainSpinner = ora('Generating domain layer…').start();
    for (const bcYaml of allBcYamls) {
      await generateEnums(bcYaml, resolvedConfig, outputDir);
      await generateValueObjects(bcYaml, resolvedConfig, outputDir);
      await generateEventDtos(bcYaml, resolvedConfig, outputDir);
      await generateAggregates(bcYaml, resolvedConfig, outputDir);
    }
    domainSpinner.succeed(`Domain layer generated for ${allBcYamls.length} bounded context(s)`);

    // ── 7. Per-BC infrastructure layer generation (SP-4) ───────────────────
    const infraSpinner = ora('Generating infrastructure layer…').start();
    for (const bcYaml of allBcYamls) {
      await generateJpaEntities(bcYaml, resolvedConfig, outputDir);
      await generateRepositories(bcYaml, resolvedConfig, outputDir);
      await generateSpecifications(bcYaml, resolvedConfig, outputDir);
    }
    infraSpinner.succeed(`Infrastructure layer generated for ${allBcYamls.length} bounded context(s)`);

    // ── 8. Per-BC application layer generation (SP-5) ──────────────────────
    const appSpinner = ora('Generating application layer…').start();
    for (const bcYaml of allBcYamls) {
      await generateProjections(bcYaml, resolvedConfig, outputDir);
      const internalApiDocForApp = await readInternalApiYaml(bcYaml.bc);
      const publicApiDocForApp = await readOpenApiYaml(bcYaml.bc);
      await generateApplicationLayer(bcYaml, resolvedConfig, outputDir, internalApiDocForApp, publicApiDocForApp);
    }
    appSpinner.succeed(`Application layer generated for ${allBcYamls.length} bounded context(s)`);

    // ── 8a. Per-BC errors catalog (Phase 4, Gap E7) ─────────────────────────
    const errorsCatalogSpinner = ora('Generating errors catalogs…').start();
    for (const bcYaml of allBcYamls) {
      await generateErrorsCatalog(bcYaml, resolvedConfig, outputDir);
    }
    errorsCatalogSpinner.succeed(`Errors catalog generated for ${allBcYamls.length} bounded context(s)`);

    // ── 8b. Per-BC outbound HTTP adapters (Feign + ACL) ─────────────────────
    const outboundSpinner = ora('Generating outbound HTTP adapters…').start();
    let outboundAdapterCount = 0;
    for (const bcYaml of allBcYamls) {
      const outboundIntegrations = (bcYaml.integrations?.outbound || []).filter(
        (i) => i.protocol === 'http'
      );
      if (outboundIntegrations.length === 0) continue;
      try {
        await generateOutboundHttpAdapters(bcYaml, resolvedConfig, outputDir, system);
        outboundAdapterCount += outboundIntegrations.length;
      } catch (err) {
        const message = `Skipping outbound HTTP adapters for ${bcYaml.bc}: ${err.message}`;
        if (strict) {
          outboundSpinner.fail(message);
          throw new Error(`${message}. Re-run with --no-strict to continue with a warning.`);
        }
        logger.warn(message);
      }
    }
    if (outboundAdapterCount > 0) {
      outboundSpinner.succeed(`Outbound HTTP adapters generated: ${outboundAdapterCount} integration(s)`);
    } else {
      outboundSpinner.info('No outbound HTTP integrations found — skipping adapter generation');
    }

    // ── 8c. External-system ACL adapters (Phase 1) ─────────────────────────
    const externalSpinner = ora('Generating external-system ACL adapters…').start();
    try {
      const { adapters, operations: extOpCount } = await generateExternalAdapters(
        allBcYamls,
        system,
        resolvedConfig,
        outputDir,
        { strict }
      );
      if (adapters > 0) {
        externalSpinner.succeed(`External ACL adapters generated: ${adapters} system(s), ${extOpCount} operation(s)`);
      } else {
        externalSpinner.info('No external systems with operations declared — skipping ACL adapter generation');
      }
    } catch (err) {
      externalSpinner.fail(`External adapter generation failed: ${err.message}`);
      throw err;
    }

    // ── 8d. Shared transactional outbox + idempotency (Phase 2) ───────────────
    const reliabilitySpinner = ora('Generating reliability artifacts (outbox / idempotency)…').start();
    let reliabilityResult;
    try {
      reliabilityResult = await generateOutboxArtifacts(system, resolvedConfig, outputDir);
      const { outboxEnabled, idempotencyEnabled } = reliabilityResult;
      if (outboxEnabled || idempotencyEnabled) {
        const parts = [];
        if (outboxEnabled) parts.push('transactional outbox');
        if (idempotencyEnabled) parts.push('consumer idempotency');
        reliabilitySpinner.succeed(`Reliability artifacts generated: ${parts.join(', ')}`);
      } else {
        reliabilitySpinner.info('Reliability flags disabled — skipping outbox / idempotency artifacts');
      }
    } catch (err) {
      reliabilitySpinner.fail(`Reliability artifact generation failed: ${err.message}`);
      throw err;
    }
    const reliabilityFlags = (system.infrastructure && system.infrastructure.reliability) || {};

    // ── 8d-bis. Request idempotency (G2) ──────────────────────────────────────
    // derived_from: useCases[*].idempotency
    const requestIdempotencySpinner = ora('Generating request-idempotency artifacts…').start();
    try {
      const result = await generateRequestIdempotencyArtifacts(allBcYamls, resolvedConfig, outputDir);
      if (result.enabled) {
        requestIdempotencySpinner.succeed(
          `Request-idempotency artifacts generated: ${result.useCaseIds.length} use case(s) (${result.useCaseIds.join(', ')})`
        );
      } else {
        requestIdempotencySpinner.info('No use case declares idempotency — skipping request-idempotency artifacts');
      }
    } catch (err) {
      requestIdempotencySpinner.fail(`Request-idempotency artifact generation failed: ${err.message}`);
      throw err;
    }

    // ── 8d-ter. Async job tracking (G10) ──────────────────────────────
    // derived_from: useCases[*].async.mode = jobTracking
    const asyncJobSpinner = ora('Generating async-job-tracking artifacts…').start();
    try {
      const result = await generateAsyncJobArtifacts(allBcYamls, resolvedConfig, outputDir);
      if (result.enabled) {
        asyncJobSpinner.succeed(
          `Async-job artifacts generated: ${result.useCaseIds.length} use case(s) (${result.useCaseIds.join(', ')})`
        );
      } else {
        asyncJobSpinner.info('No use case declares async — skipping async-job artifacts');
      }
    } catch (err) {
      asyncJobSpinner.fail(`Async-job artifact generation failed: ${err.message}`);
      throw err;
    }

    // ── 8e. Persistent projection updaters (Phase 3) ───────────────────
    const projectionSpinner = ora('Generating persistent projection updaters…').start();
    try {
      const { count } = await generateProjectionUpdaters(allBcYamls, system, resolvedConfig, outputDir);
      if (count > 0) {
        projectionSpinner.succeed(`Persistent projection updaters generated: ${count} projection(s)`);
      } else {
        projectionSpinner.info('No persistent projections declared — skipping projection updaters');
      }
    } catch (err) {
      projectionSpinner.fail(`Projection updater generation failed: ${err.message}`);
      throw err;
    }

    // ── 8f. Saga choreography artifacts (Phase 4) ──────────────────────
    const sagaSpinner = ora('Generating saga choreography artifacts…').start();
    try {
      const { count: sagaCount } = await generateSagaArtifacts(system.sagas, resolvedConfig, outputDir);
      if (sagaCount > 0) {
        sagaSpinner.succeed(`Saga choreography artifacts generated: ${sagaCount} saga(s)`);
      } else {
        sagaSpinner.info('No sagas declared — skipping saga artifacts');
      }
    } catch (err) {
      sagaSpinner.fail(`Saga artifact generation failed: ${err.message}`);
      throw err;
    }

    // ── 9. Shared broker config bean (SP-6b) ───────────────────────────────
    if (resolvedConfig.broker) {
      const brokerSpinner = ora(`Generating shared ${resolvedConfig.broker} configuration…`).start();
      try {
        await generateSharedBrokerConfig(resolvedConfig, outputDir);
        brokerSpinner.succeed(`Shared ${resolvedConfig.broker} configuration generated`);
      } catch (err) {
        brokerSpinner.fail(`Broker config generation failed: ${err.message}`);
        throw err;
      }
    }

    // ── 10. Per-BC REST controllers + messaging (SP-6a, SP-6c) ──────────────
    const integrationSpinner = ora('Generating integration layer…').start();
    let controllerCount = 0;
    let messagingCount = 0;
    for (const bcYaml of allBcYamls) {
      // REST controllers
      try {
        const openApiDoc = await readOpenApiYaml(bcYaml.bc);
        const internalApiDoc = await readInternalApiYaml(bcYaml.bc);
        const count = await generateControllerLayer(bcYaml, openApiDoc, internalApiDoc, resolvedConfig, outputDir);
        controllerCount += count;
      } catch (err) {
        const message = `Skipping controllers for ${bcYaml.bc}: ${err.message}`;
        if (strict) {
          integrationSpinner.fail(message);
          throw new Error(`${message}. Re-run with --no-strict to continue with a warning.`);
        }
        logger.warn(message);
      }

      // Messaging (integration events + port + adapter + listeners)
      try {
        const asyncApiDoc = await readAsyncApiYaml(bcYaml.bc);
        const { integrationEventCount: iec, listenerCount: lc } =
          await generateMessagingLayer(bcYaml, asyncApiDoc, resolvedConfig, outputDir, reliabilityFlags, system.sagas || []);
        messagingCount += iec + lc;
      } catch (err) {
        const message = `Skipping messaging for ${bcYaml.bc}: ${err.message}`;
        if (strict) {
          integrationSpinner.fail(message);
          throw new Error(`${message}. Re-run with --no-strict to continue with a warning.`);
        }
        logger.warn(message);
      }
    }
    integrationSpinner.succeed(`Integration layer generated: ${controllerCount} controller(s), ${messagingCount} messaging artifact(s)`);

    // ── 11. Broker topology YAML ─────────────────────────────────────────────
    if (resolvedConfig.broker) {
      const topologySpinner = ora(`Generating ${resolvedConfig.broker} topology parameters…`).start();
      try {
        let topology;
        if (resolvedConfig.broker === 'rabbitmq') {
          topology = buildRabbitMQTopology(allBcYamls);
        } else if (resolvedConfig.broker === 'kafka') {
          topology = buildKafkaTopology(allBcYamls);
        }
        await generateBrokerTopologyYaml(topology, resolvedConfig, outputDir);
        const topicLabel = resolvedConfig.broker === 'kafka' ? 'topic(s)' : 'exchange(s)';
        const count = resolvedConfig.broker === 'kafka'
          ? topology.topics.length
          : topology.exchanges.length;
        topologySpinner.succeed(`${resolvedConfig.broker} topology written: ${count} ${topicLabel}`);
      } catch (err) {
        topologySpinner.fail(`Broker topology generation failed: ${err.message}`);
        throw err;
      }
    }

    // ── Phase 3 skill + agent deployment ────────────────────────────────────
    const skillsSrcDir = path.join(__dirname, '..', 'skills');
    if (await fs.pathExists(skillsSrcDir)) {
      const skillsDestDir = path.join(outputDir, '.agents', 'skills');
      await fs.copy(skillsSrcDir, skillsDestDir, { overwrite: true });
      logger.success('Phase 3 skills deployed to .agents/skills/');
    }

    const agentsSrcDir = path.join(__dirname, '..', 'agents');
    if (await fs.pathExists(agentsSrcDir)) {
      const agentsDestDir = path.join(outputDir, '.github', 'agents');
      await fs.copy(agentsSrcDir, agentsDestDir, { overwrite: true });
      logger.success('Phase 3 agents deployed to .github/agents/');
    }

    console.log('');
    logger.success('Build complete!');
    logger.info(`Project generated at: ${outputDir}`);
  } catch (err) {
    logger.error(`Build failed: ${err.message}`);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  }
}

module.exports = { buildCommand };
