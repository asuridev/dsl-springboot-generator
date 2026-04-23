'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPascalCase, toPackagePath, getApplicationClassName } = require('../utils/naming');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

/** Maps database technology names to JDBC driver class names. */
const DB_DRIVERS = {
  postgresql: 'org.postgresql.Driver',
  mysql:      'com.mysql.cj.jdbc.Driver',
  h2:         'org.h2.Driver',
};

/** Maps database technology names to Hibernate dialect class names. */
const DB_DIALECTS = {
  postgresql: 'org.hibernate.dialect.PostgreSQLDialect',
  mysql:      'org.hibernate.dialect.MySQLDialect',
  h2:         'org.hibernate.dialect.H2Dialect',
};

/**
 * Derives HTTP integration entries from system.yaml integrations.
 * Returns one entry per integration where channel === 'http'.
 *
 * @param {object} system — parsed system.yaml (from readSystemYaml)
 * @returns {Array<{fromBc: string, toService: string, localUrl: string, envVar: string}>}
 */
function buildHttpIntegrations(system) {
  return (system.integrations || []).filter((i) => i.channel === 'http').map((i) => {
    const toName = i.to;
    // Convert kebab-case name to SCREAMING_SNAKE for env var: payment-gateway → PAYMENT_GATEWAY_URL
    const envVar = toName.toUpperCase().replace(/-/g, '_') + '_URL';
    // Derive a service key name: payment-gateway → payment-gateway-service
    const toService = `${toName}-service`;
    const localUrl = `https://api.${toName}.example.com`;
    return { fromBc: i.from, toService, localUrl, envVar };
  });
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

  // ── Derive infrastructure metadata from system.yaml ──────────────────────
  const dbTech        = (system.infrastructure && system.infrastructure.database && system.infrastructure.database.technology) || 'postgresql';
  const driverClass   = DB_DRIVERS[dbTech]  || DB_DRIVERS.postgresql;
  const dialect       = DB_DIALECTS[dbTech] || DB_DIALECTS.postgresql;
  const hasMessaging  = !!(system.infrastructure && system.infrastructure.messageBroker && system.infrastructure.messageBroker.technology === 'rabbitmq');
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
    { groupId, artifactId, javaVersion, springBootVersion }
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
  const envTemplateVars = { artifactId, packageName, dbName, driverClass, dialect, hasMessaging, hasHttpIntegrations, httpIntegrations };

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
      { hasMessaging, hasHttpIntegrations }
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
      envTemplateVars
    );

    // cors.yaml (static, no template vars but still run through EJS for consistency)
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'base', 'resources', 'parameters', env, 'cors.yaml.ejs'),
      path.join(paramDir, 'cors.yaml'),
      {}
    );

    // rabbitmq.yaml (only when system uses RabbitMQ)
    if (hasMessaging) {
      await renderAndWrite(
        path.join(TEMPLATES_DIR, 'base', 'resources', 'parameters', env, 'rabbitmq.yaml.ejs'),
        path.join(paramDir, 'rabbitmq.yaml'),
        { topology: null }
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

// ─── RabbitMQ topology YAML ───────────────────────────────────────────────────

/**
 * Re-renders all four rabbitmq.yaml parameter files, appending the
 * broker topology (exchanges, queues, routing-keys) derived from the BCs.
 *
 * This is intentionally a separate step run AFTER all BC processing so that
 * the complete topology is available before writing the files.
 *
 * @param {{ exchanges, queues, routingKeys }} topology
 * @param {{ packageName, systemName }} config
 * @param {string} outputDir
 */
async function generateRabbitMQTopologyYaml(topology, config, outputDir) {
  const resourcesDir = path.join(outputDir, 'src', 'main', 'resources');
  for (const env of ['local', 'develop', 'test', 'production']) {
    const paramDir = path.join(resourcesDir, 'parameters', env);
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'base', 'resources', 'parameters', env, 'rabbitmq.yaml.ejs'),
      path.join(paramDir, 'rabbitmq.yaml'),
      { topology }
    );
  }
}

module.exports = { generateBaseProject, generateRabbitMQTopologyYaml };
