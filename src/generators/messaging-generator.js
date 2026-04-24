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
    // Value Objects (e.g. Money) and other domain types (e.g. AddressSnapshot) may have
    // importHint: null in type-mapper. Derive the import from the domain valueobject package.
    const importHint = mapped.importHint
      || (mapped.isValueObject || mapped.isDomainType
        ? `${packageName}.${moduleName}.domain.valueobject.${mapped.javaType}`
        : null);
    return {
      javaType: mapped.javaType,
      importHint,
      innerImportHint: null,
      isValueObject: mapped.isValueObject || mapped.isDomainType || false,
    };
  } catch (_) {
    // Unknown/domain type (Value Object, etc.) — treat as same-module reference
    return {
      javaType: type,
      importHint: `${packageName}.${moduleName}.domain.valueobject.${type}`,
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
    if (mapped.innerImportHint) imports.add(mapped.innerImportHint);
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

  const fields = (consumedEvent.payload || []).map((p) => {
    const mapped = Object.assign({ name: p.name }, javaTypeForEventField(p, packageName, moduleName));
    // Commands use String for UUID fields (for validation); normalize to match command signature
    if (mapped.javaType === 'UUID') {
      mapped.javaType = 'String';
      mapped.importHint = null;
    }
    return mapped;
  });

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

// ─── Per-BC RabbitMQ config (exchanges, queues, bindings, DLQs) ──────────────

/**
 * Derives the producer BC name from an AsyncAPI channel path.
 * e.g. "inventory.stock-item.reserved" → "inventory"
 */
function producerBcFromChannel(channel) {
  if (!channel) return null;
  return channel.split('.')[0];
}

/**
 * Generates {BcPascal}RabbitMQConfig.java for a single BC.
 * Declares TopicExchange, Queue, Binding, DLX and DLQ beans for all published
 * and consumed events in this BC so RabbitAdmin auto-declares topology on startup.
 *
 * @param {Array} publishedEventCtxs - contexts built by buildEventContext() for published events
 * @param {Array} resolvedConsumedEvents - resolved consumed events with {name, channel, queueKey}
 * @param {string} packageName
 * @param {string} moduleName
 * @param {string} adaptersDir - path to infrastructure/adapters/
 */
async function generateBcRabbitMQConfig(
  publishedEventCtxs,
  resolvedConsumedEvents,
  packageName,
  moduleName,
  adaptersDir
) {
  const modulePascalCase = toPascalCase(moduleName);
  const moduleCamelCase  = toCamelCase(moduleName);

  // Build per-published-event context
  const publishedForConfig = publishedEventCtxs.map((ctx) => ({
    name:      ctx.name,
    queueKey:  ctx.topicNameKebab,
    fieldName: ctx.topicNameCamel,
  }));

  // Group consumed events by producer BC
  const producerMap = new Map(); // producerBc → [{name, queueKey, fieldName}]
  for (const ev of resolvedConsumedEvents) {
    const producerBc = producerBcFromChannel(ev.channel) || ev.producer || 'unknown';
    if (!producerMap.has(producerBc)) producerMap.set(producerBc, []);
    const eventKebab  = toKebabCase(ev.name);
    const queueKey    = ev.queueKey || `${moduleName}-${eventKebab}`;
    const fieldName   = toCamelCase(queueKey);
    producerMap.get(producerBc).push({ name: ev.name, queueKey, fieldName });
  }

  const consumersByProducer = [...producerMap.entries()].map(([producerBc, events]) => ({
    producerBc,
    producerCamel: toCamelCase(producerBc),
    events,
  }));

  const adapterDir = path.join(adaptersDir, 'rabbitmqMessageBroker');

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'messaging', 'BcRabbitMQConfig.java.ejs'),
    path.join(adapterDir, `${modulePascalCase}RabbitMQConfig.java`),
    {
      packageName,
      moduleName,
      modulePascalCase,
      moduleCamelCase,
      publishedEvents:    publishedForConfig,
      consumersByProducer,
    }
  );
}

// ─── Shared Kafka config ──────────────────────────────────────────────────────

/**
 * Generates the shared KafkaConfig.java (infrastructure bean — topic definitions read from YAML).
 */
async function generateSharedKafkaConfig(config, outputDir) {
  const packageName = config.packageName;

  const sharedDir = path.join(
    outputDir,
    'src', 'main', 'java',
    ...toPackagePath(packageName).split('/'),
    'shared'
  );

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'messaging', 'KafkaConfig.java.ejs'),
    path.join(sharedDir, 'infrastructure', 'configurations', 'kafkaConfig', 'KafkaConfig.java'),
    { packageName }
  );
}

/**
 * Shared entry-point: dispatches to the correct broker-specific config generator.
 */
async function generateSharedBrokerConfig(config, outputDir) {
  if (config.broker === 'rabbitmq') {
    return generateSharedRabbitConfig(config, outputDir);
  }
  if (config.broker === 'kafka') {
    return generateSharedKafkaConfig(config, outputDir);
  }
}

// ─── Main messaging layer generator ──────────────────────────────────────────

/**
 * Generates {BcPascal}KafkaMessageBroker.java adapter in
 * infrastructure/adapters/kafkaMessageBroker/.
 */
async function generateKafkaMessageBrokerAdapter(publishedEventCtxs, packageName, moduleName, adaptersDir) {
  const modulePascalCase = toPascalCase(moduleName);
  const moduleCamelCase  = toCamelCase(moduleName);
  const adapterDir = path.join(adaptersDir, 'kafkaMessageBroker');

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'messaging', 'KafkaMessageBroker.java.ejs'),
    path.join(adapterDir, `${modulePascalCase}KafkaMessageBroker.java`),
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
 * Generates one {MessageName}KafkaListener.java per consumed event.
 */
async function generateKafkaListener(consumedEvent, packageName, moduleName, listenersDir) {
  const listenerClassName = `${toPascalCase(consumedEvent.name)}KafkaListener`;
  const commandClassName  = `${toPascalCase(consumedEvent.command)}Command`;
  const topicKey = consumedEvent.topicKey || `${moduleName}-${toRoutingKeyKebab(consumedEvent.name)}`;

  const fields = (consumedEvent.payload || []).map((p) =>
    Object.assign({ name: p.name }, javaTypeForEventField(p, packageName, moduleName))
  );

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'messaging', 'KafkaListener.java.ejs'),
    path.join(listenersDir, `${listenerClassName}.java`),
    {
      packageName,
      moduleName,
      listenerClassName,
      commandClassName,
      topicKey,
      producer: consumedEvent.producer || 'unknown',
      useCase:  consumedEvent.useCase  || consumedEvent.command,
      eventName: consumedEvent.name,
      fields,
    }
  );
}

/**
 * Generates the complete messaging layer for one BC.
 * Dispatches to RabbitMQ or Kafka implementations based on config.broker.
 *
 * @param {object} bcYaml
 * @param {object} _asyncApiDoc - Ignored (kept for API compatibility)
 * @param {object} config       - { packageName, systemName, broker }
 * @param {string} outputDir
 * @returns {{ eventCount, integrationEventCount, listenerCount }}
 */
async function generateMessagingLayer(bcYaml, _asyncApiDoc, config, outputDir) {
  const packageName = config.packageName;
  const moduleName = bcYaml.bc;

  const publishedEvents = (bcYaml.domainEvents || {}).published || [];
  const consumedEvents  = (bcYaml.domainEvents || {}).consumed  || [];

  // ── Resolve consumed events ──────────────────────────────────────────────
  // Consumed events may come in two forms:
  //   A) Full form: { name, channel, command, useCase, queueKey, payload, producer }
  //      → used directly by generateRabbitListener
  //   B) Lightweight form: { name, channel, description }  (no command/payload)
  //      → listener must be derived from use cases with trigger.kind: event
  //
  // We normalise both forms into resolvedConsumedEvents for listener generation
  // and per-BC config topology.

  // Build a lookup: eventName → useCase (for trigger.kind === 'event')
  const ucByEventName = new Map();
  for (const uc of bcYaml.useCases || []) {
    if (uc.trigger && uc.trigger.kind === 'event' && uc.trigger.event) {
      ucByEventName.set(uc.trigger.event, uc);
    }
  }

  // Attach channel from consumed event entry to the UC, if not already present
  const channelByEventName = new Map();
  for (const ev of consumedEvents) {
    channelByEventName.set(ev.name, ev.channel || null);
  }

  const resolvedConsumedEvents = consumedEvents.map((ev) => {
    // Already full form — return as-is
    if (ev.command) return ev;

    // Lightweight form — derive from matching use case
    const uc = ucByEventName.get(ev.name);
    if (!uc) return ev; // no matching UC; listener cannot be generated

    const queueKey = ev.queueKey || `${moduleName}-${toRoutingKeyKebab(ev.name)}`;

    // Derive payload from UC method params + aggregate property types.
    // e.g. method: "create(id, customerId, street, city, postalCode?, notes?)"
    // → payload: [{ name:'id', type:'Uuid' }, { name:'customerId', type:'Uuid' }, ...]
    const methodMatch = (uc.method || '').match(/^\w+\(([^)]*)\)/);
    const paramNames = methodMatch && methodMatch[1].trim()
      ? methodMatch[1].split(',').map((p) => p.trim().replace('?', ''))
      : [];
    const agg = (bcYaml.aggregates || []).find((a) => a.name === uc.aggregate);
    const aggProps = (agg && agg.properties) ? agg.properties : [];
    const payload = paramNames.map((paramName) => {
      const prop = aggProps.find((ap) => ap.name === paramName);
      return { name: paramName, type: prop ? prop.type : 'String' };
    });

    // Non-create commands with notFoundError get an auto-injected 'id' field in the command
    // (mirrors buildCommandFields logic). For event-triggered listeners the id must come from
    // the event payload — prepend it here when not already present.
    const isCreate = /^create\(/.test(uc.method || '');
    const hasNotFoundError = !!(uc.notFoundError &&
      (Array.isArray(uc.notFoundError) ? uc.notFoundError.length > 0 : true));
    if (!isCreate && hasNotFoundError && !payload.some((p) => p.name === 'id')) {
      payload.unshift({ name: 'id', type: 'Uuid' });
    }

    return {
      name:      ev.name,
      channel:   ev.channel || null,
      producer:  ev.channel ? ev.channel.split('.')[0] : 'unknown',
      command:   uc.name,   // use case name becomes the command class base
      useCase:   uc.id,
      queueKey,
      payload,
    };
  });

  if (publishedEvents.length === 0 && resolvedConsumedEvents.length === 0) {
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
    await generateDomainEventHandler(publishedEventCtxs, packageName, moduleName, usecasesDir);

    if (config.broker === 'kafka') {
      await generateKafkaMessageBrokerAdapter(publishedEventCtxs, packageName, moduleName, adaptersDir);
    } else {
      // Default: rabbitmq
      await generateRabbitMessageBrokerAdapter(publishedEventCtxs, packageName, moduleName, adaptersDir);
    }
  }

  // ── Per-BC RabbitMQ config (exchanges, queues, bindings, DLQs) ──────────
  if (config.broker === 'rabbitmq' && (publishedEventCtxs.length > 0 || resolvedConsumedEvents.length > 0)) {
    await generateBcRabbitMQConfig(
      publishedEventCtxs,
      resolvedConsumedEvents,
      packageName,
      moduleName,
      adaptersDir
    );
  }

  let listenerCount = 0;
  for (const consumed of resolvedConsumedEvents) {
    // Only generate listener if we have a command to dispatch to
    if (!consumed.command) continue;

    if (config.broker === 'kafka') {
      const listenersDir = path.join(bcBase, 'infrastructure', 'kafkaListener');
      await generateKafkaListener(consumed, packageName, moduleName, listenersDir);
    } else {
      const listenersDir = path.join(bcBase, 'infrastructure', 'rabbitListener');
      await generateRabbitListener(consumed, packageName, moduleName, listenersDir);
    }
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
      // Add producer BC exchange derived from channel (e.g. "inventory.stock-item.reserved" → "inventory")
      // This ensures external producer exchanges are declared even if that BC is not in allBcYamls.
      const producerBc = event.channel ? event.channel.split('.')[0] : null;
      if (producerBc && !exchangeMap.has(producerBc)) {
        exchangeMap.set(producerBc, `${producerBc}.events`);
      }
    }
  }

  return {
    exchanges:   [...exchangeMap.entries()].map(([key, value]) => ({ key, value })),
    queues:      [...queueMap.entries()].map(([key, value]) => ({ key, value })),
    routingKeys: [...rkMap.entries()].map(([key, value]) => ({ key, value })),
  };
}

// ─── Kafka topology builder ───────────────────────────────────────────────────

/**
 * Aggregates Kafka topic topology from ALL BCs' domain events.
 *
 * Derivation rules:
 *   topics: published → key = {event-kebab}, value = {bcName}.{event-kebab}
 *           consumed  → key = {consumerBc}-{event-kebab}, value = {bcName}.{event-kebab}
 *
 * @param {Array<object>} allBcYamls
 * @returns {{ topics: Array<{key, value}> }}
 */
function buildKafkaTopology(allBcYamls) {
  const topicMap = new Map();

  for (const bcYaml of allBcYamls) {
    const bcName    = bcYaml.bc;
    const published = (bcYaml.domainEvents || {}).published || [];
    const consumed  = (bcYaml.domainEvents || {}).consumed  || [];

    for (const event of published) {
      const eventKebab = toKebabCase(event.name);
      topicMap.set(eventKebab, `${bcName}.${eventKebab}`);
    }

    for (const event of consumed) {
      const eventKebab = toKebabCase(event.name);
      const topicKey   = event.topicKey || `${bcName}-${eventKebab}`;
      topicMap.set(topicKey, `${bcName}.${eventKebab}`);
    }
  }

  return {
    topics: [...topicMap.entries()].map(([key, value]) => ({ key, value })),
  };
}

module.exports = {
  generateMessagingLayer,
  generateSharedBrokerConfig,
  generateSharedRabbitConfig,
  generateSharedKafkaConfig,
  generateDomainEvent,
  generateIntegrationEvent,
  generateMessageBrokerPort,
  generateRabbitMessageBrokerAdapter,
  generateKafkaMessageBrokerAdapter,
  generateBcRabbitMQConfig,
  generateDomainEventHandler,
  generateRabbitListener,
  generateKafkaListener,
  buildRabbitMQTopology,
  buildKafkaTopology,
};
