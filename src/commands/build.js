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
const { generateEnums } = require('../generators/enum-generator');
const { generateValueObjects } = require('../generators/value-object-generator');
const { generateAggregates } = require('../generators/aggregate-generator');
const { generateJpaEntities } = require('../generators/jpa-entity-generator');
const { generateRepositories } = require('../generators/repository-generator');
const { generateApplicationLayer } = require('../generators/application-generator');
const { generateOutboundHttpAdapters } = require('../generators/outbound-http-generator');
const { generateControllerLayer } = require('../generators/controller-generator');
const { generateMessagingLayer, generateSharedBrokerConfig, buildRabbitMQTopology, buildKafkaTopology } = require('../generators/messaging-generator');
const { readBcYaml } = require('../utils/bc-yaml-reader');
const { readOpenApiYaml, readAsyncApiYaml, readInternalApiYaml } = require('../utils/arch-yaml-reader');

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

  const answers = await inquirer.prompt(questions);

  return {
    packageName: answers.packageName,
    javaVersion: answers.javaVersion,
    springBootVersion: answers.springBootVersion,
    database: answers.database,
    broker: needsBroker ? (answers.broker || null) : null,
    systemName,
  };
}

/**
 * Main handler for the `build` command.
 * Orchestrates the full code generation pipeline.
 */
async function buildCommand() {
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
      logger.info(`Using saved configuration (${config.packageName}, Java ${config.javaVersion}, Spring Boot ${config.springBootVersion}, DB: ${config.database || 'postgresql'}, Broker: ${config.broker || 'none'})`);
    } else {
      config = await promptConfig(system.name, system);
      await writeConfig(config);
    }

    // Normalise springBootVersion: "3.4.x" → "3.4.5" (use a pinned patch version)
    const resolvedSpringBootVersion = config.springBootVersion.replace('.x', '.5');

    const resolvedConfig = { ...config, springBootVersion: resolvedSpringBootVersion };

    // ── 3. Determine output directory ───────────────────────────────────────
    const outputDir = process.cwd();
    logger.info(`Output directory: ${outputDir}`);
    console.log('');

    // ── 4. Generate base project (gradle + shared infra) ───────────────────
    const baseSpinner = ora('Generating base project structure…').start();
    try {
      await generateBaseProject(resolvedConfig, system, outputDir);
      baseSpinner.succeed('Base project structure generated');
    } catch (err) {
      baseSpinner.fail(`Base project generation failed: ${err.message}`);
      throw err;
    }

    // ── 5. Generate Docker Compose and Dockerfile ────────────────────────────
    const dockerSpinner = ora('Generating Docker Compose and Dockerfile…').start();
    try {
      await generateDockerFiles(resolvedConfig, outputDir);
      dockerSpinner.succeed('Docker Compose and Dockerfile generated');
    } catch (err) {
      dockerSpinner.fail(`Docker generation failed: ${err.message}`);
      throw err;
    }

    // ── 6. Load all BC YAMLs once — shared across remaining steps ──────────
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
    for (const bcName of bcNames) {
      try {
        allBcYamls.push(await readBcYaml(bcName));
      } catch (err) {
        if (err.message.includes('not found')) {
          // File not found: already warned via cross-check above, skip silently
        } else {
          // Validation / parsing error: fail loudly so the bug is visible
          logger.error(`Failed to load BC "${bcName}": ${err.message}`);
          process.exit(1);
        }
      }
    }

    // ── 6. Per-BC domain layer generation (SP-3) ───────────────────────────
    const domainSpinner = ora('Generating domain layer…').start();
    for (const bcYaml of allBcYamls) {
      await generateEnums(bcYaml, resolvedConfig, outputDir);
      await generateValueObjects(bcYaml, resolvedConfig, outputDir);
      await generateAggregates(bcYaml, resolvedConfig, outputDir);
    }
    domainSpinner.succeed(`Domain layer generated for ${allBcYamls.length} bounded context(s)`);

    // ── 7. Per-BC infrastructure layer generation (SP-4) ───────────────────
    const infraSpinner = ora('Generating infrastructure layer…').start();
    for (const bcYaml of allBcYamls) {
      await generateJpaEntities(bcYaml, resolvedConfig, outputDir);
      await generateRepositories(bcYaml, resolvedConfig, outputDir);
    }
    infraSpinner.succeed(`Infrastructure layer generated for ${allBcYamls.length} bounded context(s)`);

    // ── 8. Per-BC application layer generation (SP-5) ──────────────────────
    const appSpinner = ora('Generating application layer…').start();
    for (const bcYaml of allBcYamls) {
      const internalApiDocForApp = await readInternalApiYaml(bcYaml.bc);
      await generateApplicationLayer(bcYaml, resolvedConfig, outputDir, internalApiDocForApp);
    }
    appSpinner.succeed(`Application layer generated for ${allBcYamls.length} bounded context(s)`);

    // ── 8b. Per-BC outbound HTTP adapters (Feign + ACL) ─────────────────────
    const outboundSpinner = ora('Generating outbound HTTP adapters…').start();
    let outboundAdapterCount = 0;
    for (const bcYaml of allBcYamls) {
      const outboundIntegrations = (bcYaml.integrations?.outbound || []).filter(
        (i) => i.protocol === 'http'
      );
      if (outboundIntegrations.length === 0) continue;
      try {
        await generateOutboundHttpAdapters(bcYaml, resolvedConfig, outputDir);
        outboundAdapterCount += outboundIntegrations.length;
      } catch (err) {
        logger.warn(`Skipping outbound HTTP adapters for ${bcYaml.bc}: ${err.message}`);
      }
    }
    if (outboundAdapterCount > 0) {
      outboundSpinner.succeed(`Outbound HTTP adapters generated: ${outboundAdapterCount} integration(s)`);
    } else {
      outboundSpinner.info('No outbound HTTP integrations found — skipping adapter generation');
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
        logger.warn(`Skipping controllers for ${bcYaml.bc}: ${err.message}`);
      }

      // Messaging (integration events + port + adapter + listeners)
      try {
        const asyncApiDoc = await readAsyncApiYaml(bcYaml.bc);
        const { integrationEventCount: iec, listenerCount: lc } =
          await generateMessagingLayer(bcYaml, asyncApiDoc, resolvedConfig, outputDir);
        messagingCount += iec + lc;
      } catch (err) {
        logger.warn(`Skipping messaging for ${bcYaml.bc}: ${err.message}`);
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
