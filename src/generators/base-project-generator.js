'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPascalCase, toPackagePath, getApplicationClassName } = require('../utils/naming');
const { loadParameters } = require('../utils/config-manager');
const { hasAnyPersistentProjection } = require('./projection-updater-generator');
const { hasAnyResilience, hasAnyOAuth2Cc, hasAnyInternalJwt, hasAnyMtls,
        buildResilienceInstances, resolveAuthForBcHttp, resolveAuthForExternal } = require('../utils/resilience-auth-resolver');
const { buildErrorMap } = require('./application-generator');

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
 * Collects secret property placeholders for api-key and bearer integrations.
 * Returns one entry per (targetBc, type) pair — only for types that need a
 * secret configured at runtime. Used by urls.yaml to emit commented placeholder lines.
 *
 * @param {object} system       — parsed system.yaml
 * @param {Array}  allBcYamls   — all parsed bc.yaml objects
 * @returns {Array<{targetBc: string, type: string, propertyKey: string, envVar: string}>}
 */
function buildAuthSecrets(system, allBcYamls) {
  const seen = new Set();
  const results = [];

  const addIfSecret = (targetBc, auth) => {
    if (!auth || seen.has(targetBc)) return;
    if (auth.type !== 'api-key' && auth.type !== 'bearer') return;
    seen.add(targetBc);
    const base = targetBc.toUpperCase().replace(/-/g, '_');
    if (auth.type === 'api-key') {
      const propertyKey = auth.valueProperty || `integration.${targetBc}.api-key`;
      results.push({ targetBc, type: 'api-key', propertyKey, envVar: `${base}_API_KEY` });
    } else {
      const propertyKey = auth.valueProperty || `integration.${targetBc}.bearer-token`;
      results.push({ targetBc, type: 'bearer', propertyKey, envVar: `${base}_BEARER_TOKEN` });
    }
  };

  // BC→BC HTTP integrations
  for (const integ of (system.integrations || [])) {
    if (integ.channel !== 'http') continue;
    const bcYaml = (allBcYamls || []).find((b) => b && b.bc === integ.from) || null;
    const auth = bcYaml
      ? resolveAuthForBcHttp(system, bcYaml, integ.to)
      : integ.auth;
    addIfSecret(integ.to, auth);
  }

  // External system integrations
  for (const ext of (system.externalSystems || [])) {
    const bcYaml = (allBcYamls || []).find((b) =>
      ((b.integrations || {}).outbound || []).some((ob) => ob.name === ext.name)
    ) || null;
    const auth = bcYaml
      ? resolveAuthForExternal(system, bcYaml, ext.name)
      : ext.auth;
    addIfSecret(ext.name, auth);
  }

  return results;
}

/**
 * Collects oauth2-cc integration metadata needed to generate oauth2.yaml
 * (spring.security.oauth2.client.registration.{credentialKey} blocks).
 * Returns one entry per unique credentialKey.
 *
 * @param {object} system       — parsed system.yaml
 * @param {Array}  allBcYamls   — all parsed bc.yaml objects
 * @returns {Array<{credentialKey: string, tokenEndpoint: string, clientIdEnvVar: string, clientSecretEnvVar: string}>}
 */
function buildOAuth2Integrations(system, allBcYamls) {
  const seen = new Set();
  const results = [];

  const addIfOAuth2 = (targetBc, auth) => {
    if (!auth || auth.type !== 'oauth2-cc') return;
    const key = auth.credentialKey;
    if (!key || seen.has(key)) return;
    seen.add(key);
    const base = key.toUpperCase().replace(/-/g, '_');
    results.push({
      credentialKey: key,
      tokenEndpoint: auth.tokenEndpoint || '',
      clientIdEnvVar: `${base}_CLIENT_ID`,
      clientSecretEnvVar: `${base}_CLIENT_SECRET`,
    });
  };

  for (const integ of (system.integrations || [])) {
    if (integ.channel !== 'http') continue;
    const bcYaml = (allBcYamls || []).find((b) => b && b.bc === integ.from) || null;
    const auth = bcYaml
      ? resolveAuthForBcHttp(system, bcYaml, integ.to)
      : integ.auth;
    addIfOAuth2(integ.to, auth);
  }

  for (const ext of (system.externalSystems || [])) {
    const bcYaml = (allBcYamls || []).find((b) =>
      ((b.integrations || {}).outbound || []).some((ob) => ob.name === ext.name)
    ) || null;
    const auth = bcYaml
      ? resolveAuthForExternal(system, bcYaml, ext.name)
      : ext.auth;
    addIfOAuth2(ext.name, auth);
  }

  return results;
}

/**
 * [Phase 3, Gap E6] Build a constraint-name → fully-qualified error class map
 * by scanning every BC's `aggregates[].domainRules[]` for entries that declare
 * both `constraintName` and `errorCode`. The shared `HandlerExceptions` uses
 * this map to translate a JPA `DataIntegrityViolationException` raised by the
 * named UNIQUE constraint into the declared domain error (preserving its
 * `code`, `httpStatus` and `description`). Without an entry the handler
 * keeps the previous generic 409 behaviour.
 */
function buildConstraintErrorMap(packageName, allBcYamls) {
  const entries = [];
  for (const bc of allBcYamls || []) {
    if (!bc || !bc.bc) continue;
    const errorMap = buildErrorMap(bc.errors || []);
    for (const agg of bc.aggregates || []) {
      for (const rule of agg.domainRules || []) {
        if (rule.type !== 'uniqueness') continue;
        if (!rule.constraintName || !rule.errorCode) continue;
        const err = errorMap[rule.errorCode];
        if (!err) continue;
        entries.push({
          constraintName: rule.constraintName,
          errorClassFqn: `${packageName}.${bc.bc}.domain.errors.${err.errorType}`,
          errorClassSimple: err.errorType,
        });
      }
    }
  }
  return entries;
}

/**
 * [Phase 4, Gap E5] Build a JVM-exception → domain error mapping by scanning
 * every BC's `errors[]` for entries with `kind: infrastructure` and
 * `triggeredBy: <ExceptionClass>`. The shared `HandlerExceptions` will emit
 * one `@ExceptionHandler` per unique triggering exception class that
 * translates it to the declared domain error (preserving `code`, `httpStatus`
 * and `details`). If two errors map to the same exception class, fail with
 * a clear message — the mapping must be unambiguous across all BCs.
 */
function buildInfrastructureErrorMap(packageName, allBcYamls) {
  const byTrigger = new Map();
  for (const bc of allBcYamls || []) {
    if (!bc || !bc.bc) continue;
    for (const err of bc.errors || []) {
      if (err.kind !== 'infrastructure' || !err.triggeredBy) continue;
      const errorMap = buildErrorMap([err]);
      const errEntry = errorMap[err.code];
      if (!errEntry) continue;
      const triggerFqn = err.triggeredBy.includes('.')
        ? err.triggeredBy
        : err.triggeredBy; // simple name kept as-is; user must import via FQN
      const existing = byTrigger.get(triggerFqn);
      const candidate = {
        triggerFqn,
        triggerSimple: triggerFqn.includes('.') ? triggerFqn.substring(triggerFqn.lastIndexOf('.') + 1) : triggerFqn,
        errorClassFqn: `${packageName}.${bc.bc}.domain.errors.${errEntry.errorType}`,
        errorClassSimple: errEntry.errorType,
        errorCode: err.code,
        bc: bc.bc,
      };
      if (existing && existing.errorClassFqn !== candidate.errorClassFqn) {
        throw new Error(
          `[base-project-generator] Ambiguous infrastructure mapping: triggeredBy "${triggerFqn}" is declared by both ` +
            `error "${existing.errorCode}" (BC "${existing.bc}") and "${candidate.errorCode}" (BC "${candidate.bc}"). ` +
            `Each JVM exception class can be mapped to at most one domain error.`
        );
      }
      if (!existing) byTrigger.set(triggerFqn, candidate);
    }
  }
  return [...byTrigger.values()];
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
async function generateBaseProject(config, system, outputDir, allBcYamls = []) {
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

  // ── Reliability flags (Phase 2) + persistent projections (Phase 3) ──────
  // derived_from: system.yaml#/infrastructure/reliability + bc.<*>.projections[*].persistent
  const reliability         = (system.infrastructure && system.infrastructure.reliability) || {};
  const outboxEnabled       = !!reliability.outbox;
  const idempotencyEnabled  = !!reliability.consumerIdempotency;
  const persistentProjectionsPresent = hasAnyPersistentProjection(allBcYamls);
  // [G2] Request idempotency requires Flyway to provision idempotency_request.
  const requestIdempotencyPresent = (allBcYamls || []).some((bc) =>
    (bc && bc.useCases || []).some((uc) => uc && uc.idempotency)
  );
  // [G10] Async/job-tracking requires Flyway to provision async_job.
  const asyncJobPresent = (allBcYamls || []).some((bc) =>
    (bc && bc.useCases || []).some((uc) => uc && uc.async && uc.async.mode === 'jobTracking')
  );
  const flywayEnabled       = outboxEnabled || idempotencyEnabled || persistentProjectionsPresent || requestIdempotencyPresent || asyncJobPresent;

  // ── Resilience + OAuth2 flags (Phase 5) ──────────────────────────────
  // derived_from: system.yaml#/integrations[*]/resilience + .../auth
  const resilienceEnabled    = hasAnyResilience(system, allBcYamls);
  const resilienceInstances  = buildResilienceInstances(system, allBcYamls);
  const oauth2ClientEnabled  = hasAnyOAuth2Cc(system, allBcYamls);

  // ── Auth secrets + OAuth2 registration metadata (GAP-AUTH-001/002) ───
  const authSecrets         = buildAuthSecrets(system, allBcYamls);
  const oauth2Integrations  = buildOAuth2Integrations(system, allBcYamls);
  const internalJwtEnabled  = hasAnyInternalJwt(system, allBcYamls);
  const mtlsEnabled         = hasAnyMtls(system, allBcYamls);

  // ── Inbound auth server (JWT resource server) ────────────────────────
  // derived_from: system.yaml#/infrastructure/authServer + dsl-springboot.json#/authProvider
  const authProvider     = config.authProvider || null;
  const authProviderMeta = authProvider
    ? params.authProviders.find((p) => p.id === authProvider) || null
    : null;
  const authServerEnabled = !!authProviderMeta;

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
    { groupId, artifactId, javaVersion, springBootVersion, databaseDependency, brokerDependency, brokerTestDependency, flywayEnabled, databaseId: dbId, resilienceEnabled, oauth2ClientEnabled }
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
    { packageName, applicationClassName, systemName, outboxEnabled }
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
      { hasMessaging, hasHttpIntegrations, broker: brokerId, resilienceEnabled, oauth2ClientEnabled, mtlsEnabled, authServerEnabled, env }
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
        // topology: empty arrays — avoids Spring failing on missing placeholder if the
        // broker topology yaml is read before generateBrokerTopologyYaml() runs the
        // second write pass with the real topology populated from all BCs.
        { topology: { exchanges: [], queues: [], routingKeys: [] }, artifactId }
      );
    }

    // urls.yaml (only when system has HTTP integrations)
    if (hasHttpIntegrations) {
      await renderAndWrite(
        path.join(TEMPLATES_DIR, 'base', 'resources', 'parameters', env, 'urls.yaml.ejs'),
        path.join(paramDir, 'urls.yaml'),
        { httpIntegrations, authSecrets }
      );
    }

    // oauth2.yaml (only when any integration uses oauth2-cc — GAP-AUTH-001)
    if (oauth2ClientEnabled) {
      await renderAndWrite(
        path.join(TEMPLATES_DIR, 'base', 'resources', 'parameters', env, 'oauth2.yaml.ejs'),
        path.join(paramDir, 'oauth2.yaml'),
        { oauth2Integrations }
      );
    }

    // mtls.yaml (only when any integration uses mTLS — GAP-AUTH-003)
    if (mtlsEnabled) {
      await renderAndWrite(
        path.join(TEMPLATES_DIR, 'base', 'resources', 'parameters', env, 'mtls.yaml.ejs'),
        path.join(paramDir, 'mtls.yaml'),
        {}
      );
    }

    // auth-server.yaml (only when an inbound auth provider is configured)
    if (authServerEnabled) {
      await renderAndWrite(
        path.join(TEMPLATES_DIR, 'base', 'resources', 'parameters', env, 'auth-server.yaml.ejs'),
        path.join(paramDir, 'auth-server.yaml'),
        { env, authProviderMeta }
      );
    }

    // resilience.yaml (Phase 5 — only when any HTTP integration declares resilience)
    if (resilienceEnabled) {
      await renderAndWrite(
        path.join(TEMPLATES_DIR, 'base', 'resources', 'parameters', env, 'resilience.yaml.ejs'),
        path.join(paramDir, 'resilience.yaml'),
        { resilienceInstances }
      );
    }
  }

  // ── Shared: custom exceptions ─────────────────────────────────────────────

  const exceptionsDir = path.join(javaMainDir, 'shared', 'domain', 'customExceptions');
  const exceptionClasses = [
    'DomainException',
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

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'domain', 'EventMetadata.java.ejs'),
    path.join(sharedDomainDir, 'EventMetadata.java'),
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
    { packageName, authServerEnabled, constraintErrorMap: buildConstraintErrorMap(packageName, allBcYamls), infrastructureErrorMap: buildInfrastructureErrorMap(packageName, allBcYamls) }
  );

  // ── Shared: CQRS interfaces ───────────────────────────────────────────────

  const interfacesDir = path.join(javaMainDir, 'shared', 'domain', 'interfaces');
  const cqrsInterfaces = ['Dispatchable', 'Handler', 'Command', 'CommandHandler', 'Query', 'QueryHandler', 'ReturningCommand', 'ReturningCommandHandler'];
  for (const iface of cqrsInterfaces) {
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'interfaces', `${iface}.java.ejs`),
      path.join(interfacesDir, `${iface}.java`),
      { packageName }
    );
  }

  // ── Shared: annotations ───────────────────────────────────────────────────

  const annotationsDir = path.join(javaMainDir, 'shared', 'domain', 'annotations');
  const annotations = ['ApplicationComponent', 'DomainComponent', 'LogExceptions', 'LogLevel', 'LogBefore', 'LogAfter', 'Loggable', 'LogTimer'];
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

  // ── Shared: BulkResult (G9) ───────────────────────────────────────────────
  // Rendered only when at least one UC declares `bulk:` — keeps the scaffold
  // byte-clean for projects that never use bulk wrappers.
  const bulkPresent = (allBcYamls || []).some((bc) =>
    (bc && bc.useCases || []).some((uc) => uc && uc.bulk)
  );
  if (bulkPresent) {
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'application', 'dtos', 'BulkResult.java.ejs'),
      path.join(sharedDtosDir, 'BulkResult.java'),
      { packageName }
    );
  }

  // ── Shared: Range<T> (G8) ─────────────────────────────────────────────────
  // Rendered only when at least one UC input declares type "Range[T]". Stays
  // out of projects that never use range filters.
  const rangePresent = (allBcYamls || []).some((bc) =>
    (bc && bc.useCases || []).some((uc) =>
      Array.isArray(uc && uc.input) &&
      uc.input.some((inp) => typeof inp.type === 'string' && /^Range\[.+\]$/.test(inp.type))
    )
  );
  if (rangePresent) {
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'application', 'dtos', 'Range.java.ejs'),
      path.join(sharedDtosDir, 'Range.java'),
      { packageName }
    );
  }

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
    { packageName, authServerEnabled, authProviderMeta }
  );

  // ── Shared: SecurityContextUtil (G3) ──────────────────────────────────────
  // Static helper consumed by handlers when uc.authorization.ownership is
  // declared. Always rendered — cost is one tiny class and it is referenced
  // only when authorization rules require it.
  const securityUtilDir = path.join(
    javaMainDir, 'shared', 'infrastructure', 'security'
  );
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'infrastructure', 'security', 'SecurityContextUtil.java.ejs'),
    path.join(securityUtilDir, 'SecurityContextUtil.java'),
    { packageName }
  );

  if (authServerEnabled) {
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'infrastructure', 'security', 'JwtAuthConverter.java.ejs'),
      path.join(securityUtilDir, 'JwtAuthConverter.java'),
      { packageName, authProviderMeta }
    );
  }

  // ── Shared: SwaggerConfig ─────────────────────────────────────────────────

  const swaggerConfigDir = path.join(
    javaMainDir, 'shared', 'infrastructure', 'configurations', 'swaggerConfig'
  );
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'configurations', 'swaggerConfig', 'SwaggerConfig.java.ejs'),
    path.join(swaggerConfigDir, 'SwaggerConfig.java'),
    { packageName, authServerEnabled }
  );

  // ── Shared: HandlerLogs (AOP logging aspect) ──────────────────────────────

  const loggerConfigDir = path.join(
    javaMainDir, 'shared', 'infrastructure', 'configurations', 'loggerConfig'
  );
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'configurations', 'loggerConfig', 'HandlerLogs.java.ejs'),
    path.join(loggerConfigDir, 'HandlerLogs.java'),
    { packageName }
  );

  // ── Shared: OAuth2 client-credentials helper (Phase 5) ────────────────────
  // derived_from: system.yaml#/integrations[*]/auth (type: oauth2-cc)
  if (oauth2ClientEnabled) {
    const authDir = path.join(javaMainDir, 'shared', 'infrastructure', 'auth');
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'infrastructure', 'auth', 'OAuth2ClientCredentialsSupport.java.ejs'),
      path.join(authDir, 'OAuth2ClientCredentialsSupport.java'),
      { packageName }
    );
  }

  // ── Shared: InternalJwtPropagator (GAP-AUTH-004) ──────────────────────────
  // derived_from: system.yaml#/integrations[*]/auth (type: internal-jwt)
  if (internalJwtEnabled) {
    const authDir = path.join(javaMainDir, 'shared', 'infrastructure', 'auth');
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'infrastructure', 'auth', 'InternalJwtPropagator.java.ejs'),
      path.join(authDir, 'InternalJwtPropagator.java'),
      { packageName }
    );
  }

  // ── Shared: MutualTlsSupport (GAP-AUTH-003) ──────────────────────────────
  // derived_from: system.yaml#/integrations[*]/auth (type: mTLS)
  if (mtlsEnabled) {
    const authDir = path.join(javaMainDir, 'shared', 'infrastructure', 'auth');
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'shared', 'infrastructure', 'auth', 'MutualTlsSupport.java.ejs'),
      path.join(authDir, 'MutualTlsSupport.java'),
      { packageName }
    );
  }

  // ── Shared: EventPublicationSchemaConfig (Spring Modulith varchar→TEXT) ───

  const eventPublicationConfigDir = path.join(
    javaMainDir, 'shared', 'infrastructure', 'configurations', 'eventPublicationConfig'
  );
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'shared', 'configurations', 'eventPublicationConfig', 'EventPublicationSchemaConfig.java.ejs'),
    path.join(eventPublicationConfigDir, 'EventPublicationSchemaConfig.java'),
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
