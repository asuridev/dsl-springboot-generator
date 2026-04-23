'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toCamelCase, toKebabCase, toPascalCase, toPackagePath } = require('../utils/naming');
const { mapType } = require('../utils/type-mapper');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

// ─── AsyncAPI parsing (legacy — kept for backward compatibility) ──────────────

// ─── Type helpers ─────────────────────────────────────────────────────────────

/**
 * Map a domain event payload field to Java metadata for templates.
 * Returns { javaType, importHint, innerImportHint, isValueObject }
 *
 * Value Object types (e.g. Money) are kept as-is with an import hint pointing
 * to the domain value object package so the IntegrationEvent can carry the
 * same type without re-declaring it.
 */
function javaTypeForEventField(payloadField, packageName, moduleName) {
  const { type } = payloadField;

  // List[T]
  const listMatch = /^List\[(.+)\]$/.exec(type);
  if (listMatch) {
    const inner = javaTypeForEventField({ ...payloadField, type: listMatch[1] }, packageName, moduleName);
    return {
      javaType: `List<${inner.javaType}>`,
      importHint: 'java.util.List',
      innerImportHint: inner.importHint,
      isValueObject: false,
    };
  }

  try {
    const mapped = mapType(type, payloadField);
    // Value Objects (e.g. Money) may have importHint: null in type-mapper.
    // Derive the import from the domain valueobject package.
    const importHint = mapped.importHint
      || (mapped.isValueObject
        ? `${packageName}.${moduleName}.domain.valueobject.${mapped.javaType}`
        : null);
    return {
      javaType: mapped.javaType,
      importHint,
      innerImportHint: null,
      isValueObject: mapped.isValueObject || false,
    };
  } catch (_) {
    // Unknown/domain type (Value Object, enum, etc.) — treat as same-module reference
    return {
      javaType: type,
      importHint: `${packageName}.${moduleName}.domain.models.valueObjects.${type}`,
      innerImportHint: null,
      isValueObject: true,
    };
  }
}

// ─── Routing key derivation ──────────────────────────────────────────────────

/**
 * Derives the kebab-case routing key from a domain event name.
 * ProductActivated → product-activated
 * OrderDraftCreated → order-draft-created
 */
function toRoutingKeyKebab(eventName) {
  return toKebabCase(eventName);
}

// ─── Event context builder ────────────────────────────────────────────────────

/**
 * Builds the per-event context object used across all messaging templates.
 */
function buildEventContext(event, packageName, moduleName) {
  const topicNameKebab = toRoutingKeyKebab(event.name);
  const topicNameCamel = toCamelCase(topicNameKebab);
  const integrationEventClassName = `${event.name}IntegrationEvent`;

  const eventFields = (event.payload || []).map((p) =>
    Object.assign({ name: p.name }, javaTypeForEventField(p, packageName, moduleName))
  );

  return {
    name: event.name,                           // e.g. ProductActivated
    integrationEventClassName,                  // e.g. ProductActivatedIntegrationEvent
    topicNameKebab,                             // e.g. product-activated
    topicNameCamel,                             // e.g. productActivated
    fields: eventFields,                        // for DomainEventHandler record accessor calls
    eventFields,                                // for IntegrationEvent record fields
  };
}

// ─── Individual file generators ──────────────────────────────────────────────

/**
 * Generates {EventName}Event.java record in domain/events/.
 */
async function generateDomainEvent(event, packageName, moduleName, eventsDir) {
  const imports = new Set();
  const fields = (event.payload || []).map((p) => {
    const mapped = javaTypeForEventField(p, packageName, moduleName);
    if (mapped.importHint) imports.add(mapped.importHint);
    return { type: mapped.javaType, name: p.name };
  });

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'messaging', 'DomainEvent.java.ejs'),
    path.join(eventsDir, `${event.name}Event.java`),
    {
      packageName,
      moduleName,
      eventName: event.name,
      fields,
      imports: [...imports].sort(),
    }
  );
}

/**
 * Generates {EventName}IntegrationEvent.java record in application/events/.
 */
async function generateIntegrationEvent(eventCtx, packageName, moduleName, eventsDir) {
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'messaging', 'IntegrationEvent.java.ejs'),
    path.join(eventsDir, `${eventCtx.integrationEventClassName}.java`),
    {
      packageName,
      moduleName,
      eventName: eventCtx.name,
      integrationEventClassName: eventCtx.integrationEventClassName,
      eventFields: eventCtx.eventFields,
    }
  );
}

/**
 * Generates MessageBroker.java port interface in application/ports/.
 * One interface per BC containing all publish methods.
 */
async function generateMessageBrokerPort(publishedEventCtxs, packageName, moduleName, portsDir) {
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'messaging', 'MessageBroker.java.ejs'),
    path.join(portsDir, 'MessageBroker.java'),
    {
      packageName,
      moduleName,
      events: publishedEventCtxs,
    }
  );
}

/**
 * Generates {BcPascal}RabbitMessageBroker.java adapter in
 * infrastructure/adapters/rabbitmqMessageBroker/.
 */
async function generateRabbitMessageBrokerAdapter(publishedEventCtxs, packageName, moduleName, adaptersDir) {
  const modulePascalCase = toPascalCase(moduleName);
  const moduleCamelCase = toCamelCase(moduleName);
  const adapterDir = path.join(adaptersDir, 'rabbitmqMessageBroker');

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'messaging', 'RabbitMessageBroker.java.ejs'),
    path.join(adapterDir, `${modulePascalCase}RabbitMessageBroker.java`),
    {
      packageName,
      moduleName,
      modulePascalCase,
      moduleCamelCase,
      events: publishedEventCtxs,
    }
  );
}

/**
 * Generates {BcPascal}DomainEventHandler.java in application/usecases/.
 * Bridges the internal Spring event bus → MessageBroker port.
 */
async function generateDomainEventHandler(publishedEventCtxs, packageName, moduleName, usecasesDir) {
  const bcPascal = toPascalCase(moduleName);

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'messaging', 'DomainEventHandler.java.ejs'),
    path.join(usecasesDir, `${bcPascal}DomainEventHandler.java`),
    {
      packageName,
      bc: moduleName,
      bcPascal,
      domainEvents: publishedEventCtxs,
    }
  );
}

/**
 * Generates one {MessageName}RabbitListener.java per consumed event.
 *
 * Each consumed entry in bcYaml.domainEvents.consumed must declare:
 *   name      — event name (e.g. CartCheckedOut)
 *   producer  — source BC (e.g. carts)
 *   command   — command class name without 'Command' suffix (e.g. CreateOrderFromCart)
 *   useCase   — use case id/name for documentation
 *   queueKey  — key in rabbitmq.yaml queues section (e.g. orders-cart-checked-out)
 *   payload   — list of { name, type } fields
 */
async function generateRabbitListener(consumedEvent, packageName, moduleName, listenersDir) {
  const listenerClassName = `${toPascalCase(consumedEvent.name)}RabbitListener`;
  const commandClassName = `${toPascalCase(consumedEvent.command)}Command`;
  const queueKey = consumedEvent.queueKey || `${moduleName}-${toRoutingKeyKebab(consumedEvent.name)}`;

  const fields = (consumedEvent.payload || []).map((p) =>
    Object.assign({ name: p.name }, javaTypeForEventField(p, packageName, moduleName))
  );

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'messaging', 'RabbitListener.java.ejs'),
    path.join(listenersDir, `${listenerClassName}.java`),
    {
      packageName,
      moduleName,
      listenerClassName,
      commandClassName,
      queueKey,
      producer: consumedEvent.producer || 'unknown',
      useCase: consumedEvent.useCase || consumedEvent.command,
      eventName: consumedEvent.name,
      fields,
    }
  );
}

// ─── Shared RabbitMQ config ───────────────────────────────────────────────────

/**
 * Generates the shared RabbitMQConfig.java (infrastructure beans only — no hardcoded exchange).
 */
async function generateSharedRabbitConfig(config, outputDir) {
  const packageName = config.packageName;

  const sharedDir = path.join(
    outputDir,
    'src', 'main', 'java',
    ...toPackagePath(packageName).split('/'),
    'shared'
  );

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'messaging', 'RabbitMQConfig.java.ejs'),
    path.join(sharedDir, 'infrastructure', 'configurations', 'rabbitmqConfig', 'RabbitMQConfig.java'),
    { packageName }
  );
}

// ─── Main messaging layer generator ──────────────────────────────────────────

/**
 * Generates the complete messaging layer for one BC:
 *   1. Domain event records       (domain/events/)
 *   2. Integration event records  (application/events/)
 *   3. MessageBroker port         (application/ports/MessageBroker.java)
 *   4. RabbitMQ adapter           (infrastructure/adapters/rabbitmqMessageBroker/)
 *   5. DomainEventHandler bridge  (application/usecases/)
 *   6. RabbitMQ listeners         (infrastructure/rabbitListener/)
 *
 * @param {object} bcYaml    - Parsed {bc}.yaml
 * @param {object} _asyncApiDoc - Ignored (kept for API compatibility)
 * @param {object} config    - { packageName, systemName }
 * @param {string} outputDir - Root of the output project
 * @returns {{ eventCount, integrationEventCount, listenerCount }}
 */
async function generateMessagingLayer(bcYaml, _asyncApiDoc, config, outputDir) {
  const packageName = config.packageName;
  const moduleName = bcYaml.bc;

  const publishedEvents = (bcYaml.domainEvents || {}).published || [];
  const consumedEvents  = (bcYaml.domainEvents || {}).consumed  || [];

  if (publishedEvents.length === 0 && consumedEvents.length === 0) {
    return { eventCount: 0, integrationEventCount: 0, listenerCount: 0 };
  }

  const bcBase = path.join(
    outputDir, 'src', 'main', 'java',
    ...toPackagePath(packageName).split('/'),
    moduleName
  );

  const domainEventsDir = path.join(bcBase, 'domain',        'events');
  const appEventsDir    = path.join(bcBase, 'application',   'events');
  const portsDir        = path.join(bcBase, 'application',   'ports');
  const usecasesDir     = path.join(bcBase, 'application',   'usecases');
  const adaptersDir     = path.join(bcBase, 'infrastructure', 'adapters');
  const listenersDir    = path.join(bcBase, 'infrastructure', 'rabbitListener');

  const publishedEventCtxs = publishedEvents.map((e) =>
    buildEventContext(e, packageName, moduleName)
  );

  let eventCount = 0;
  let integrationEventCount = 0;

  for (const event of publishedEvents) {
    await generateDomainEvent(event, packageName, moduleName, domainEventsDir);
    eventCount++;
  }

  for (const eventCtx of publishedEventCtxs) {
    await generateIntegrationEvent(eventCtx, packageName, moduleName, appEventsDir);
    integrationEventCount++;
  }

  if (publishedEventCtxs.length > 0) {
    await generateMessageBrokerPort(publishedEventCtxs, packageName, moduleName, portsDir);
    await generateRabbitMessageBrokerAdapter(publishedEventCtxs, packageName, moduleName, adaptersDir);
    await generateDomainEventHandler(publishedEventCtxs, packageName, moduleName, usecasesDir);
  }

  let listenerCount = 0;
  for (const consumed of consumedEvents) {
    await generateRabbitListener(consumed, packageName, moduleName, listenersDir);
    listenerCount++;
  }

  return { eventCount, integrationEventCount, listenerCount };
}

// ─── RabbitMQ topology builder ───────────────────────────────────────────────

/**
 * Aggregates exchange/queue/routing-key topology from ALL BCs' domain events.
 *
 * Derivation rules (matches test-eva reference pattern):
 *   exchanges  : one entry per BC that publishes — key = bcName, value = {bcName}.events
 *   queues     : published → key = {event-kebab},          value = {bcName}.{event-kebab}
 *                consumed  → key = {consumerBc}-{event-kebab}, value = {consumerBc}.{event-kebab}
 *   routing-keys: published → key = {event-kebab},          value = {event.dot.case}
 *                 consumed  → key = {consumerBc}-{event-kebab}, value = {event.dot.case}
 *
 * @param {Array<object>} allBcYamls - All parsed {bc}.yaml objects
 * @returns {{ exchanges: Array<{key,value}>, queues: Array<{key,value}>, routingKeys: Array<{key,value}> }}
 */
function buildRabbitMQTopology(allBcYamls) {
  const exchangeMap = new Map(); // key → value (deduplicated)
  const queueMap    = new Map();
  const rkMap       = new Map();

  for (const bcYaml of allBcYamls) {
    const bcName       = bcYaml.bc;
    const published    = (bcYaml.domainEvents || {}).published || [];
    const consumed     = (bcYaml.domainEvents || {}).consumed  || [];

    if (published.length > 0) {
      // One exchange per publishing BC
      exchangeMap.set(bcName, `${bcName}.events`);

      for (const event of published) {
        const eventKebab = toKebabCase(event.name);
        const dotCase    = eventKebab.replace(/-/g, '.');
        queueMap.set(eventKebab,  `${bcName}.${eventKebab}`);
        rkMap.set(eventKebab,     dotCase);
      }
    }

    for (const event of consumed) {
      const eventKebab = toKebabCase(event.name);
      const dotCase    = eventKebab.replace(/-/g, '.');
      const queueKey   = event.queueKey || `${bcName}-${eventKebab}`;
      queueMap.set(queueKey, `${bcName}.${eventKebab}`);
      rkMap.set(queueKey,    dotCase);
    }
  }

  return {
    exchanges:   [...exchangeMap.entries()].map(([key, value]) => ({ key, value })),
    queues:      [...queueMap.entries()].map(([key, value]) => ({ key, value })),
    routingKeys: [...rkMap.entries()].map(([key, value]) => ({ key, value })),
  };
}

module.exports = {
  generateMessagingLayer,
  generateSharedRabbitConfig,
  generateDomainEvent,
  generateIntegrationEvent,
  generateMessageBrokerPort,
  generateRabbitMessageBrokerAdapter,
  generateDomainEventHandler,
  generateRabbitListener,
  buildRabbitMQTopology,
};
