'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPascalCase, toPackagePath, getApplicationClassName } = require('../utils/naming');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

/**
 * Generates the base Spring Boot project structure:
 *   - build.gradle / settings.gradle
 *   - Application.java (main class)
 *   - application.yaml
 *   - Shared infrastructure: custom exceptions, domain base classes, global exception handler
 *
 * @param {object} config
 * @param {string} config.packageName       — e.g. "com.canastaShop"
 * @param {string} config.javaVersion       — e.g. "21"
 * @param {string} config.springBootVersion — e.g. "3.3.x"
 * @param {string} config.systemName        — e.g. "canasta-shop"
 * @param {string} outputDir                — absolute path to the output root (e.g. /cwd/canasta-shop)
 */
async function generateBaseProject(config, outputDir) {
  const { packageName, javaVersion, springBootVersion, systemName } = config;

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

  // ── Gradle wrapper wrapper stub ───────────────────────────────────────────
  // Write a minimal gradlew launcher note (actual wrapper must be generated
  // by `gradle wrapper` or copied from a reference project).
  const fs = require('fs-extra');
  await fs.ensureDir(path.join(outputDir, 'gradle', 'wrapper'));

  // ── Application.java ─────────────────────────────────────────────────────

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'base', 'application', 'Application.java.ejs'),
    path.join(javaMainDir, `${applicationClassName}.java`),
    { packageName, applicationClassName, systemName }
  );

  // ── application.yaml ─────────────────────────────────────────────────────

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'base', 'resources', 'application.yaml.ejs'),
    path.join(resourcesDir, 'application.yaml'),
    { artifactId }
  );

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

module.exports = { generateBaseProject };
