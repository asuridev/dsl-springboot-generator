'use strict';

const path = require('path');
const inquirer = require('inquirer');
const ora = require('ora');
const logger = require('../utils/logger');
const { configExists, readConfig, writeConfig } = require('../utils/config-manager');
const { readSystemYaml } = require('../utils/system-yaml-reader');
const { generateBaseProject } = require('../generators/base-project-generator');
const { generateEnums } = require('../generators/enum-generator');
const { generateValueObjects } = require('../generators/value-object-generator');
const { generateAggregates } = require('../generators/aggregate-generator');
const { generateJpaEntities } = require('../generators/jpa-entity-generator');
const { generateRepositories } = require('../generators/repository-generator');
const { generateApplicationLayer } = require('../generators/application-generator');
const { generateControllerLayer } = require('../generators/controller-generator');
const { generateMessagingLayer, generateSharedRabbitConfig } = require('../generators/messaging-generator');
const { readBcYaml } = require('../utils/bc-yaml-reader');
const { readOpenApiYaml, readAsyncApiYaml } = require('../utils/arch-yaml-reader');

/**
 * Prompts the user for first-time configuration if dsl-springboot.json does not exist.
 * @param {string} systemName
 * @returns {Promise<{packageName, javaVersion, springBootVersion, systemName}>}
 */
async function promptConfig(systemName) {
  console.log('');
  logger.info('No configuration found. Please provide project settings:');
  console.log('');

  const answers = await inquirer.prompt([
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
      choices: ['17', '21'],
      default: '21',
    },
    {
      type: 'list',
      name: 'springBootVersion',
      message: 'Spring Boot version:',
      choices: ['3.3.x', '3.4.x'],
      default: '3.4.x',
    },
  ]);

  return {
    packageName: answers.packageName,
    javaVersion: answers.javaVersion,
    springBootVersion: answers.springBootVersion,
    systemName,
  };
}

/**
 * Main handler for the `build` command.
 * Orchestrates the full code generation pipeline.
 */
async function buildCommand() {
  try {
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
      logger.info(`Using saved configuration (${config.packageName}, Java ${config.javaVersion}, Spring Boot ${config.springBootVersion})`);
    } else {
      config = await promptConfig(system.name);
      await writeConfig(config);
    }

    // Normalise springBootVersion: "3.4.x" → "3.4.5" (use a pinned patch version)
    const resolvedSpringBootVersion = config.springBootVersion.replace('.x', '.5');

    const resolvedConfig = { ...config, springBootVersion: resolvedSpringBootVersion };

    // ── 3. Determine output directory ───────────────────────────────────────
    const outputDir = path.join(process.cwd(), system.name);
    logger.info(`Output directory: ${outputDir}`);
    console.log('');

    // ── 4. Generate base project (gradle + shared infra) ───────────────────
    const baseSpinner = ora('Generating base project structure…').start();
    try {
      await generateBaseProject(resolvedConfig, outputDir);
      baseSpinner.succeed('Base project structure generated');
    } catch (err) {
      baseSpinner.fail(`Base project generation failed: ${err.message}`);
      throw err;
    }

    // ── 5. Per-BC domain layer generation (SP-3) ───────────────────────────
    const domainSpinner = ora('Generating domain layer…').start();
    let domainCount = 0;
    for (const bc of system.boundedContexts) {
      let bcYaml;
      try {
        bcYaml = await readBcYaml(bc.name);
      } catch (err) {
        logger.warn(`Skipping ${bc.name}: ${err.message}`);
        continue;
      }

      await generateEnums(bcYaml, resolvedConfig, outputDir);
      await generateValueObjects(bcYaml, resolvedConfig, outputDir);
      await generateAggregates(bcYaml, resolvedConfig, outputDir);
      domainCount++;
    }
    domainSpinner.succeed(`Domain layer generated for ${domainCount} bounded context(s)`);

    // ── 6. Per-BC infrastructure layer generation (SP-4) ───────────────────
    const infraSpinner = ora('Generating infrastructure layer…').start();
    let infraCount = 0;
    for (const bc of system.boundedContexts) {
      let bcYaml;
      try {
        bcYaml = await readBcYaml(bc.name);
      } catch (err) {
        continue; // already warned in domain pass
      }

      await generateJpaEntities(bcYaml, resolvedConfig, outputDir);
      await generateRepositories(bcYaml, resolvedConfig, outputDir);
      infraCount++;
    }
    infraSpinner.succeed(`Infrastructure layer generated for ${infraCount} bounded context(s)`);

    // ── 7. Per-BC application layer generation (SP-5) ──────────────────────
    const appSpinner = ora('Generating application layer…').start();
    let appCount = 0;
    for (const bc of system.boundedContexts) {
      let bcYaml;
      try {
        bcYaml = await readBcYaml(bc.name);
      } catch (err) {
        continue; // already warned in domain pass
      }

      await generateApplicationLayer(bcYaml, resolvedConfig, outputDir);
      appCount++;
    }
    appSpinner.succeed(`Application layer generated for ${appCount} bounded context(s)`);

    // ── 8. Shared RabbitMQ config (SP-6b) ───────────────────────────────────
    const rabbitSpinner = ora('Generating shared RabbitMQ configuration…').start();
    try {
      await generateSharedRabbitConfig(resolvedConfig, outputDir);
      rabbitSpinner.succeed('Shared RabbitMQ configuration generated');
    } catch (err) {
      rabbitSpinner.fail(`RabbitMQ config generation failed: ${err.message}`);
      throw err;
    }

    // ── 9. Per-BC REST controllers + messaging (SP-6a, SP-6c) ───────────────
    const integrationSpinner = ora('Generating integration layer…').start();
    let controllerCount = 0;
    let publisherCount = 0;
    for (const bc of system.boundedContexts) {
      let bcYaml;
      try {
        bcYaml = await readBcYaml(bc.name);
      } catch (err) {
        continue;
      }

      // REST controllers
      try {
        const openApiDoc = await readOpenApiYaml(bc.name);
        const count = await generateControllerLayer(bcYaml, openApiDoc, resolvedConfig, outputDir);
        controllerCount += count;
      } catch (err) {
        logger.warn(`Skipping controllers for ${bc.name}: ${err.message}`);
      }

      // Messaging (event publishers)
      try {
        const asyncApiDoc = await readAsyncApiYaml(bc.name);
        if (asyncApiDoc) {
          const { publisherCount: pc } = await generateMessagingLayer(bcYaml, asyncApiDoc, resolvedConfig, outputDir);
          publisherCount += pc;
        }
      } catch (err) {
        logger.warn(`Skipping messaging for ${bc.name}: ${err.message}`);
      }
    }
    integrationSpinner.succeed(`Integration layer generated: ${controllerCount} controller(s), ${publisherCount} publisher(s)`);

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
