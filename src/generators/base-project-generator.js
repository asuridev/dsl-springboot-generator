'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPascalCase, toPackagePath, getApplicationClassName } = require('../utils/naming');
const { loadParameters } = require('../utils/config-manager');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

/**
 * Derives HTTP integration entries from system.yaml integrations.
 * Returns one deduplicated entry per target BC where channel === 'http'.
 * Each entry produces the Spring property key: integration.{toBc}.base-url
 * which matches @FeignClient(url = "${integration.{toBc}.base-url}").
 *
 * @param {object} system — parsed system.yaml (from readSystemYaml)
 * @returns {Array<{toBc: string, localUrl: string, envVar: string}>}
 */
function buildHttpIntegrations(system) {
  const seen = new Set();
  return (system.integrations || [])
    .filter((i) => i.channel === 'http')
    .reduce((acc, i) => {
      if (!seen.has(i.to)) {
        seen.add(i.to);
        // Convert kebab-case to SCREAMING_SNAKE: payment-gateway → PAYMENT_GATEWAY_URL
        const envVar = i.to.toUpperCase().replace(/-/g, '_') + '_URL';
        const localUrl = `https://api.${i.to}.example.com`;
        acc.push({ toBc: i.to, localUrl, envVar });
      }
      return acc;
    }, []);
}

/**
 * Generates the base Spring Boot project structure:
 *   - build.gradle / settings.gradle
 *   - Application.java (main class)
 *   - application.yaml + application-{env}.yaml (4 profiles)
 *   - parameters/{env}/*.yaml (db, cors, rabbitmq, urls per environment)
 *   - Shared infrastructure: custom exceptions, domain base classes, global exception handler
 *
 * @param {object} config
 * @param {string} config.packageName       — e.g. "com.canastaShop"
 * @param {string} config.javaVersion       — e.g. "21"
 * @param {string} config.springBootVersion — e.g. "3.3.x"
 * @param {string} config.systemName        — e.g. "canasta-shop"
 * @param {object} system                   — parsed system.yaml (from readSystemYaml)
 * @param {string} outputDir                — absolute path to the output root
 */
async function generateBaseProject(config, system, outputDir) {
  const { packageName, javaVersion, springBootVersion, systemName } = config;

  // ── Resolve technology metadata from config/stack-catalog.json + config ─────
  const params = await loadParameters();

  const dbId = config.database || 'postgresql';
  const dbMeta = params.databases.find((d) => d.id === dbId) || params.databases[0];
  const driverClass  = dbMeta.driverClass;
  const dialect      = dbMeta.dialect;
  const databaseDependency = dbMeta.gradleDependency;

  // Build JDBC URL (H2 uses a different URL format)
  const buildJdbcUrl = (env) => {
    if (dbId === 'h2') {
      return env === 'local' || env === 'test'
        ? `jdbc:h2:mem:${dbName};DB_CLOSE_DELAY=-1;MODE=PostgreSQL`
        : `jdbc:h2:mem:${dbName};DB_CLOSE_DELAY=-1;MODE=PostgreSQL`;
    }
    if (env === 'production') return '${DB_URL}';
    if (env === 'develop' || env === 'test') return `\${DB_URL:${dbMeta.jdbcPrefix}://localhost:${dbMeta.defaultPort}/${dbName}}`;
    return `${dbMeta.jdbcPrefix}://localhost:${dbMeta.defaultPort}/${dbName}`;
  };

  const brokerId = config.broker || null;
  const brokerMeta = brokerId ? params.messageBrokers.find((b) => b.id === brokerId) : null;
  const brokerDependency     = brokerMeta ? brokerMeta.gradleDependency : null;
  const brokerTestDependency = brokerMeta ? brokerMeta.testDependency    : null;

  const hasMessaging        = !!brokerId;
  const httpIntegrations    = buildHttpIntegrations(system);
  const hasHttpIntegrations = httpIntegrations.length > 0;

  // Derive artifact id from system name (kebab-case)
  const artifactId = systemName;
  // groupId: everything before the last dot in packageName, or packageName itself
  const lastDot = packageName.lastIndexOf('.');
  const groupId = lastDot > -1 ? packageName.substring(0, lastDot) : packageName;
  const applicationClassName = getApplicationClassName(artifactId);
  const packagePath = toPackagePath(packageName);

  const javaMainDir = path.join(outputDir, 'src', 'main', 'java', packagePath);
  const resourcesDir = path.join(outputDir, 'src', 'main', 'resources');

  // ── Gradle ────────────────────────────────────────────────────────────────

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'base', 'gradle', 'build.gradle.ejs'),
    path.join(outputDir, 'build.gradle'),
    { groupId, artifactId, javaVersion, springBootVersion, databaseDependency, brokerDependency, brokerTestDependency }
  );

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'base', 'gradle', 'settings.gradle.ejs'),
    path.join(outputDir, 'settings.gradle'),
    { artifactId }
  );

  // ── Gradle wrapper files ──────────────────────────────────────────────────
  // Copy gradle-wrapper.jar and gradle-wrapper.properties from templates/base/wrapper/
  const fs = require('fs-extra');
  const wrapperSrc = path.join(TEMPLATES_DIR, 'base', 'wrapper');
  const wrapperDest = path.join(outputDir, 'gradle', 'wrapper');
  await fs.ensureDir(wrapperDest);
  await fs.copy(wrapperSrc, wrapperDest, { overwrite: true });

  // ── gradlew + gradlew.bat → project root ──────────────────────────────────
  await fs.copy(path.join(TEMPLATES_DIR, 'base', 'gradle', 'gradlew'),     path.join(outputDir, 'gradlew'),     { overwrite: true });
  await fs.copy(path.join(TEMPLATES_DIR, 'base', 'gradle', 'gradlew.bat'), path.join(outputDir, 'gradlew.bat'), { overwrite: true });

  // ── .gitignore → project root ─────────────────────────────────────────────
  await fs.copy(path.join(TEMPLATES_DIR, 'base', 'git', '.gitignore'), path.join(outputDir, '.gitignore'), { overwrite: true });

  // ── Application.java ─────────────────────────────────────────────────────

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'base', 'application', 'Application.java.ejs'),
    path.join(javaMainDir, `${applicationClassName}.java`),
    { packageName, applicationClassName, systemName }
  );

  // ── application.yaml (base — profile-agnostic) ──────────────────────────

  const dbName = artifactId.replace(/-/g, '_');
  const envTemplateVars = { artifactId, packageName, dbName, driverClass, dialect, hasMessaging, hasHttpIntegrations, httpIntegrations, broker: brokerId };

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'base', 'resources', 'application.yaml.ejs'),
    path.join(resourcesDir, 'application.yaml'),
    { artifactId }
  );

  // ── application-{env}.yaml (Spring profile configs) ───────────────────────

  for (const env of ['local', 'develop', 'test', 'production']) {
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'base', 'resources', `application-${env}.yaml.ejs`),
      path.join(resourcesDir, `application-${env}.yaml`),
      { hasMessaging, hasHttpIntegrations, broker: brokerId }
    );
  }

  // ── parameters/{env}/*.yaml (environment-specific parameter files) ────────

  for (const env of ['local', 'develop', 'test', 'production']) {
    const paramDir = path.join(resourcesDir, 'parameters', env);
    await fs.ensureDir(paramDir);

    // db.yaml
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'base', 'resources', 'parameters', env, 'db.yaml.ejs'),
      path.join(paramDir, 'db.yaml'),
      { ...envTemplateVars, jdbcUrl: buildJdbcUrl(env) }
    );

    // cors.yaml (static, no template vars but still run through EJS for consistency)
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'base', 'resources', 'parameters', env, 'cors.yaml.ejs'),
      path.join(paramDir, 'cors.yaml'),
      {}
    );

    // broker parameter file (only when messaging is configured)
    if (hasMessaging && brokerId) {
      await renderAndWrite(
        path.join(TEMPLATES_DIR, 'base', 'resources', 'parameters', env, `${brokerId}.yaml.ejs`),
        path.join(paramDir, `${brokerId}.yaml`),
        { topology: null, artifactId }
      );
    }

    // urls.yaml (only when system has HTTP integrations)
    if (hasHttpIntegrations) {
      await renderAndWrite(
        path.join(TEMPLATES_DIR, 'base', 'resources', 'parameters', env, 'urls.yaml.ejs'),
        path.join(paramDir, 'urls.yaml'),
        { httpIntegrations }
      );
    }
  }

  // ── Shared: custom exceptions ─────────────────────────────────────────────

  const exceptionsDir = path.join(javaMainDir, 'shared', 'domain', 'customExceptions');
  const exceptionClasses = [
    'BusinessException',
    'NotFoundException',
    'ConflictException',
    'BadRequestException',
    'ForbiddenException',
    'UnauthorizedException',
    'ValidationException',
    'InvalidStateTransitionException',
  ];

  for (const cls of exceptionClasses) {
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'customExceptions', `${cls}.java.ejs`),
      path.join(exceptionsDir, `${cls}.java`),
      { packageName }
    );
  }

  // ── Shared: domain base classes ───────────────────────────────────────────

  const sharedDomainDir = path.join(javaMainDir, 'shared', 'domain');

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'domain', 'AuditableEntity.java.ejs'),
    path.join(sharedDomainDir, 'AuditableEntity.java'),
    { packageName }
  );

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'domain', 'FullAuditableEntity.java.ejs'),
    path.join(sharedDomainDir, 'FullAuditableEntity.java'),
    { packageName }
  );

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'domain', 'DomainEvent.java.ejs'),
    path.join(sharedDomainDir, 'DomainEvent.java'),
    { packageName }
  );

  // ── Shared: ErrorResponse ─────────────────────────────────────────────────

  const errorMsgDir = path.join(javaMainDir, 'shared', 'domain', 'errorMessage');

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'errorMessage', 'ErrorResponse.java.ejs'),
    path.join(errorMsgDir, 'ErrorResponse.java'),
    { packageName }
  );

  // ── Shared: global exception handler ─────────────────────────────────────

  const handlerDir = path.join(javaMainDir, 'shared', 'infrastructure', 'handlerException');

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'handlerException', 'HandlerExceptions.java.ejs'),
    path.join(handlerDir, 'HandlerExceptions.java'),
    { packageName }
  );

  // ── Shared: CQRS interfaces ───────────────────────────────────────────────

  const interfacesDir = path.join(javaMainDir, 'shared', 'domain', 'interfaces');
  const cqrsInterfaces = ['Dispatchable', 'Handler', 'Command', 'CommandHandler', 'Query', 'QueryHandler'];
  for (const iface of cqrsInterfaces) {
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'interfaces', `${iface}.java.ejs`),
      path.join(interfacesDir, `${iface}.java`),
      { packageName }
    );
  }

  // ── Shared: annotations ───────────────────────────────────────────────────

  const annotationsDir = path.join(javaMainDir, 'shared', 'domain', 'annotations');
  const annotations = ['ApplicationComponent', 'DomainComponent', 'LogExceptions', 'LogLevel'];
  for (const ann of annotations) {
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'annotations', `${ann}.java.ejs`),
      path.join(annotationsDir, `${ann}.java`),
      { packageName }
    );
  }

  // ── Shared: PagedResponse ─────────────────────────────────────────────────

  const sharedDtosDir = path.join(javaMainDir, 'shared', 'application', 'dtos');
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'application', 'dtos', 'PagedResponse.java.ejs'),
    path.join(sharedDtosDir, 'PagedResponse.java'),
    { packageName }
  );

  // ── Shared: UseCase configuration (container / mediator / auto-register) ──

  const useCaseConfigDir = path.join(
    javaMainDir, 'shared', 'infrastructure', 'configurations', 'useCaseConfig'
  );
  const useCaseConfigClasses = [
    'UseCaseContainer',
    'UseCaseAutoRegister',
    'UseCaseMediator',
    'UseCaseConfig',
  ];
  for (const cls of useCaseConfigClasses) {
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'configurations', 'useCaseConfig', `${cls}.java.ejs`),
      path.join(useCaseConfigDir, `${cls}.java`),
      { packageName }
    );
  }

  // ── Shared: SecurityConfig ────────────────────────────────────────────────

  const securityConfigDir = path.join(
    javaMainDir, 'shared', 'infrastructure', 'configurations', 'securityConfig'
  );
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'configurations', 'securityConfig', 'SecurityConfig.java.ejs'),
    path.join(securityConfigDir, 'SecurityConfig.java'),
    { packageName }
  );

  // ── Shared: SwaggerConfig ─────────────────────────────────────────────────

  const swaggerConfigDir = path.join(
    javaMainDir, 'shared', 'infrastructure', 'configurations', 'swaggerConfig'
  );
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'configurations', 'swaggerConfig', 'SwaggerConfig.java.ejs'),
    path.join(swaggerConfigDir, 'SwaggerConfig.java'),
    { packageName }
  );

  // ── Shared: EventEnvelope ─────────────────────────────────────────────────

  const eventEnvelopeDir = path.join(javaMainDir, 'shared', 'infrastructure', 'eventEnvelope');
  for (const cls of ['EventEnvelope', 'EventMetadata']) {
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'eventEnvelope', `${cls}.java.ejs`),
      path.join(eventEnvelopeDir, `${cls}.java`),
      { packageName, projectName: systemName }
    );
  }

  // ── Shared: package-info (Spring Modulith boundary) ──────────────────────

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'package-info.java.ejs'),
    path.join(javaMainDir, 'shared', 'package-info.java'),
    { packageName, projectName: systemName }
  );
}

// ─── Broker topology YAML ────────────────────────────────────────────────────

/**
 * Re-renders the broker parameter file for all four environments, injecting the
 * full topology (exchanges/queues/routing-keys for RabbitMQ, topics for Kafka)
 * derived from the BCs after all BC processing is complete.
 *
 * @param {object} topology  - broker-specific topology object
 * @param {{ packageName, systemName, broker }} config
 * @param {string} outputDir
 */
async function generateBrokerTopologyYaml(topology, config, outputDir) {
  const brokerId = config.broker;
  if (!brokerId) return;

  const resourcesDir = path.join(outputDir, 'src', 'main', 'resources');
  const artifactId = config.systemName;

  for (const env of ['local', 'develop', 'test', 'production']) {
    const paramDir = path.join(resourcesDir, 'parameters', env);
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'base', 'resources', 'parameters', env, `${brokerId}.yaml.ejs`),
      path.join(paramDir, `${brokerId}.yaml`),
      { topology, artifactId }
    );
  }
}

module.exports = { generateBaseProject, generateBrokerTopologyYaml };
