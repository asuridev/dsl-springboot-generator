'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toCamelCase, toKebabCase, toPascalCase, toPackagePath } = require('../utils/naming');
const { mapType } = require('../utils/type-mapper');
const logger = require('../utils/logger');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

// ─── AsyncAPI parsing (legacy — kept for backward compatibility) ──────────────

// ─── AsyncAPI payload resolver ────────────────────────────────────────────────

/**
 * Attempts to derive integration event payload fields from the AsyncAPI document.
 * Handles `$ref` in message.payload pointing to components/schemas.
 *
 * Returns an array of { name, type } objects, or [] if not found.
 */
function resolvePayloadFromAsyncApi(eventName, asyncApiDoc) {
  if (!asyncApiDoc || !asyncApiDoc.messages) return [];

  // Resolve the message schema — try exact name, then with 'Payload'/'Event' suffix, then prefix match
  let msgSchema = asyncApiDoc.messages.get(eventName)
    || asyncApiDoc.messages.get(`${eventName}Payload`)
    || asyncApiDoc.messages.get(`${eventName}Event`);
  if (!msgSchema) {
    // case-insensitive prefix match
    const lower = eventName.toLowerCase();
    for (const [key, val] of asyncApiDoc.messages) {
      if (key.toLowerCase().startsWith(lower)) { msgSchema = val; break; }
    }
  }
  if (!msgSchema) return [];

  // Resolve the payload — may be inline or a $ref to components/schemas
  let payloadSchema = msgSchema.payload || null;
  if (payloadSchema && payloadSchema.$ref) {
    const refParts = payloadSchema.$ref.split('/');
    const schemaName = refParts[refParts.length - 1];
    payloadSchema = (asyncApiDoc.schemas || {})[schemaName] || null;
  }
  if (!payloadSchema || !payloadSchema.properties) return [];

  // Map OpenAPI/AsyncAPI schema types to domain types
  function mapAsyncApiType(propName, propSchema) {
    const t = propSchema.type || 'string';
    const fmt = propSchema.format || '';
    if (fmt === 'uuid') return 'Uuid';
    if (fmt === 'date-time') return 'Instant';
    if (t === 'integer' || t === 'int32' || t === 'int64') return 'Integer';
    if (t === 'number') return 'Decimal';
    if (t === 'boolean') return 'Boolean';
    return 'String';
  }

  return Object.entries(payloadSchema.properties).map(([propName, propSchema]) => ({
    name: propName,
    type: mapAsyncApiType(propName, propSchema),
  }));
}

// ─── Type helpers ─────────────────────────────────────────────────────────────

/**
 * Map a domain event payload field to Java metadata for templates.
 * Returns { javaType, importHint, innerImportHint, isValueObject }
 *
 * Value Object types (e.g. Money) are kept as-is with an import hint pointing
 * to the domain value object package so the IntegrationEvent can carry the
 * same type without re-declaring it.
 */
function javaTypeForEventField(payloadField, packageName, moduleName, enumNames = new Set(), voNames = new Set(), eventDtoNames = new Set()) {
  const { type } = payloadField;

  // List[T]
  const listMatch = /^List\[(.+)\]$/.exec(type);
  if (listMatch) {
    const inner = javaTypeForEventField({ ...payloadField, type: listMatch[1] }, packageName, moduleName, enumNames, voNames, eventDtoNames);
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
    // importHint: null in type-mapper. Derive the import from the correct domain sub-package.
    let importHint = mapped.importHint;
    if (!importHint && (mapped.isValueObject || mapped.isDomainType)) {
      // eventDtos live in application.dtos.incoming — check before falling back to domain.*
      if (eventDtoNames.has(mapped.javaType)) {
        importHint = `${packageName}.${moduleName}.application.dtos.incoming.${mapped.javaType}`;
      } else {
        const isEnum = enumNames.has(mapped.javaType);
        const subPackage = isEnum ? 'enums' : 'valueobject';
        importHint = `${packageName}.${moduleName}.domain.${subPackage}.${mapped.javaType}`;
      }
    }
    return {
      javaType: mapped.javaType,
      importHint,
      innerImportHint: null,
      isValueObject: mapped.isValueObject || mapped.isDomainType || false,
    };
  } catch (_) {
    // eventDto type — resolves to application.dtos.incoming
    if (eventDtoNames.has(type)) {
      return {
        javaType: type,
        importHint: `${packageName}.${moduleName}.application.dtos.incoming.${type}`,
        innerImportHint: null,
        isValueObject: false,
      };
    }
    // Unknown/domain type — check if enum or value object
    const isEnum = enumNames.has(type);
    const subPackage = isEnum ? 'enums' : 'valueobject';
    return {
      javaType: type,
      importHint: `${packageName}.${moduleName}.domain.${subPackage}.${type}`,
      innerImportHint: null,
      isValueObject: !isEnum,
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

// Canonical metadata field names that, if present in the YAML payload, are
// considered duplicates of the EventMetadata record (Phase 1). When the
// metadata feature is enabled, these are filtered out and a deprecation
// warning is emitted so the human cleans up the YAML.
const CANONICAL_METADATA_FIELDS = new Set([
  'eventId', 'eventType', 'eventVersion', 'occurredAt', 'correlationId', 'causationId',
]);

/**
 * Builds the per-event context object used across all messaging templates.
 *
 * @param {boolean} metadataEnabled — if true, an EventMetadata record component
 *   is rendered as the FIRST field of both the domain and integration event
 *   records, and any payload field whose name collides with a canonical metadata
 *   field is filtered out (with a deprecation warning).
 */
function buildEventContext(event, packageName, moduleName, asyncApiDoc, enumNames = new Set(), voNames = new Set(), metadataEnabled = true) {
  const topicNameKebab = toRoutingKeyKebab(event.name);
  const topicNameCamel = toCamelCase(topicNameKebab);
  const integrationEventClassName = `${event.name}IntegrationEvent`;

  // Use bc.yaml payload if present; fall back to async-api schema
  let rawPayload = event.payload || [];
  if (rawPayload.length === 0 && asyncApiDoc) {
    rawPayload = resolvePayloadFromAsyncApi(event.name, asyncApiDoc);
    if (rawPayload.length > 0) {
      logger.warn(`[${moduleName}] Event "${event.name}" payload resolved from async-api schema (not declared in bc.yaml).`);
    }
  }

  // Filter canonical metadata fields when metadata is enabled.
  if (metadataEnabled) {
    const dropped = rawPayload.filter((p) => CANONICAL_METADATA_FIELDS.has(p.name));
    if (dropped.length > 0) {
      logger.warn(
        `[${moduleName}] Event "${event.name}" declares canonical metadata field(s) in payload: ${dropped.map((d) => d.name).join(', ')}. ` +
        `These are now provided by EventMetadata and will be ignored. Remove them from the YAML payload.`
      );
    }
    rawPayload = rawPayload.filter((p) => !CANONICAL_METADATA_FIELDS.has(p.name));
  }

  const eventFields = rawPayload.map((p) =>
    Object.assign({ name: p.name, description: p.description || null }, javaTypeForEventField(p, packageName, moduleName, enumNames, voNames))
  );

  // Phase 4 — scope + broker hints. Default scope is 'both' for backward compatibility.
  const scope = event.scope || 'both';
  const broker = event.broker || {};
  const partitionKey = broker.partitionKey || null;
  const headersMap = broker.headers && typeof broker.headers === 'object' && !Array.isArray(broker.headers)
    ? Object.entries(broker.headers).map(([key, value]) => ({ key, value: String(value) }))
    : [];
  const retry = broker.retry || null;
  const dlq = broker.dlq || null;

  return {
    name: event.name,                           // e.g. ProductActivated
    version: event.version || 1,                // schema version (Phase 1, gap #8 base)
    integrationEventClassName,                  // e.g. ProductActivatedIntegrationEvent
    topicNameKebab,                             // e.g. product-activated
    topicNameCamel,                             // e.g. productActivated
    description: event.description || null,    // gap #2: propagate to Javadoc
    channel: event.channel || null,             // gap #1: propagate for traceability
    metadataEnabled,                            // Phase 1: drives template branching
    fields: eventFields,                        // for DomainEventHandler record accessor calls
    eventFields,                                // for IntegrationEvent record fields
    // Phase 4 — scope + broker hints (gap #13, #9, #11)
    scope,                                      // 'internal' | 'integration' | 'both'
    isInternalOnly: scope === 'internal',
    publishToBroker: scope !== 'internal',      // drives whether broker/port/topology is generated
    partitionKey,                               // Kafka: aggregate field used as message key
    headers: headersMap,                        // [{key, value}] static/template-string headers
    retry,                                      // {maxAttempts, backoff, initialMs, maxMs} or null
    dlq,                                        // {afterAttempts, target} or null
  };
}

// ─── Individual file generators ──────────────────────────────────────────────

/**
 * Generates {EventName}Event.java record in domain/events/.
 */
async function generateDomainEvent(event, packageName, moduleName, eventsDir, enumNames = new Set(), voNames = new Set(), metadataEnabled = true) {
  const imports = new Set();
  // Filter canonical metadata fields when metadata is enabled (already warned in buildEventContext).
  const rawPayload = metadataEnabled
    ? (event.payload || []).filter((p) => !CANONICAL_METADATA_FIELDS.has(p.name))
    : (event.payload || []);
  const fields = rawPayload.map((p) => {
    const mapped = javaTypeForEventField(p, packageName, moduleName, enumNames, voNames);
    if (mapped.importHint) imports.add(mapped.importHint);
    if (mapped.innerImportHint) imports.add(mapped.innerImportHint);
    return { type: mapped.javaType, name: p.name, description: p.description || null };
  });

  if (metadataEnabled) {
    imports.add(`${packageName}.shared.domain.EventMetadata`);
  }

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'messaging', 'DomainEvent.java.ejs'),
    path.join(eventsDir, `${event.name}Event.java`),
    {
      packageName,
      moduleName,
      eventName: event.name,
      eventVersion: event.version || 1,
      description: event.description || null,
      channel: event.channel || null,
      metadataEnabled,
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
      eventVersion: eventCtx.version || 1,
      description: eventCtx.description || null,
      channel: eventCtx.channel || null,
      metadataEnabled: !!eventCtx.metadataEnabled,
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
async function generateDomainEventHandler(publishedEventCtxs, packageName, moduleName, usecasesDir, outboxEnabled = false, sagasEnabled = false, broker = 'rabbitmq') {
  const bcPascal = toPascalCase(moduleName);

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'messaging', 'DomainEventHandler.java.ejs'),
    path.join(usecasesDir, `${bcPascal}DomainEventHandler.java`),
    {
      packageName,
      bc: moduleName,
      bcPascal,
      domainEvents: publishedEventCtxs,
      outboxEnabled,
      sagasEnabled,
      broker,
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
async function generateRabbitListener(consumedEvent, packageName, moduleName, listenersDir, enumNames = new Set(), voNames = new Set(), consumerIdempotencyEnabled = false, sagasEnabled = false, sagaSteps = [], eventDtoNames = new Set()) {
  const listenerClassName = `${toPascalCase(consumedEvent.name)}RabbitListener`;
  const commandClassName = `${toPascalCase(consumedEvent.command)}Command`;
  const queueKey = consumedEvent.queueKey || `${moduleName}-${toRoutingKeyKebab(consumedEvent.name)}`;

  const mapField = (p) => Object.assign({ name: p.name }, javaTypeForEventField(p, packageName, moduleName, enumNames, voNames, eventDtoNames));

  // When the UC declares uc.input[], extract ONLY those fields (avoids dead-variable warnings).
  // Fall back to the full event payload when commandPayload is empty (no uc.input[]).
  const effectivePayload = (consumedEvent.commandPayload && consumedEvent.commandPayload.length > 0)
    ? consumedEvent.commandPayload
    : (consumedEvent.payload || []);
  const fields = effectivePayload.map(mapField);
  // commandFields = fields: extraction and constructor args are the same set
  const commandFields = fields;

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
      commandFields,
      consumerIdempotencyEnabled,
      sagasEnabled,
      sagaSteps,
      // [G15] inline Java boolean expression. When non-null the listener
      // skip-acks any message that fails the predicate before dispatching.
      filterExpr: consumedEvent.filterExpr || null,
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
    name:           ctx.name,
    queueKey:       ctx.topicNameKebab,
    fieldName:      ctx.topicNameCamel,
    // broker.retry.* drives Spring-level RetryOperationsInterceptor (in-memory, pre-DLQ).
    // x-delivery-limit and x-message-ttl are broker-level queue arguments (quorum queues only)
    // and must NOT be derived from Spring retry config — they are independent mechanisms.
    // dlq.routingKey  → x-dead-letter-routing-key arg + DlqBinding routing key
    // dlq.queueName   → physical DLQ name (defaults to dlq.routingKey when omitted)
    deliveryLimit:   null,
    messageTtlMs:    null,
    dlqRoutingKey:   ctx.dlq?.routingKey ?? null,
    dlqQueueName:    ctx.dlq?.queueName  ?? ctx.dlq?.routingKey ?? null,
  }));

  // Group consumed events by producer BC
  const producerMap = new Map(); // producerBc → [{name, queueKey, fieldName, deliveryLimit, messageTtlMs, dlqRoutingKey, dlqQueueName}]
  for (const ev of resolvedConsumedEvents) {
    const producerBc = producerBcFromChannel(ev.channel) || ev.producer || 'unknown';
    if (!producerMap.has(producerBc)) producerMap.set(producerBc, []);
    const eventKebab  = toKebabCase(ev.name);
    const queueKey    = ev.queueKey || `${moduleName}-${eventKebab}`;
    const fieldName   = toCamelCase(queueKey);
    producerMap.get(producerBc).push({
      name: ev.name,
      queueKey,
      fieldName,
      deliveryLimit:  null,
      messageTtlMs:   null,
      dlqRoutingKey:  null,
      dlqQueueName:   null,
    });
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
async function generateKafkaListener(consumedEvent, packageName, moduleName, listenersDir, enumNames = new Set(), voNames = new Set(), consumerIdempotencyEnabled = false, sagasEnabled = false, sagaSteps = [], eventDtoNames = new Set()) {
  const listenerClassName = `${toPascalCase(consumedEvent.name)}KafkaListener`;
  const commandClassName  = `${toPascalCase(consumedEvent.command)}Command`;
  const topicKey = consumedEvent.topicKey || `${moduleName}-${toRoutingKeyKebab(consumedEvent.name)}`;

  // When the UC declares uc.input[], extract ONLY those fields (avoids dead-variable warnings).
  const effectivePayload = (consumedEvent.commandPayload && consumedEvent.commandPayload.length > 0)
    ? consumedEvent.commandPayload
    : (consumedEvent.payload || []);
  const fields = effectivePayload.map((p) =>
    Object.assign({ name: p.name }, javaTypeForEventField(p, packageName, moduleName, enumNames, voNames, eventDtoNames))
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
      consumerIdempotencyEnabled,
      sagasEnabled,
      sagaSteps,
    }
  );
}

/**
 * Generates the complete messaging layer for one BC.
 * Dispatches to RabbitMQ or Kafka implementations based on config.broker.
 *
 * @param {object} bcYaml
 * @param {object} asyncApiDoc  - Parsed async-api document (channels + messages Map); used as
 *                                payload fallback when bc.yaml events have empty payload lists.
 * @param {object} config       - { packageName, systemName, broker }
 * @param {string} outputDir
 * @returns {{ eventCount, integrationEventCount, listenerCount }}
 */
async function generateMessagingLayer(bcYaml, asyncApiDoc, config, outputDir, reliability = {}, sagas = []) {
  const packageName = config.packageName;
  const moduleName = bcYaml.bc;
  const outboxEnabled = !!reliability.outbox;
  const consumerIdempotencyEnabled = !!reliability.consumerIdempotency;
  const { buildSagaEventIndex } = require('./saga-generator');
  const sagaEventIndex = buildSagaEventIndex(sagas);
  const sagasEnabled = sagaEventIndex.size > 0;

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
    if (!uc) {
      // listenerRequired: false → intentional saga-awareness-only subscription;
      // suppress the warning — topology is still generated for the queue binding.
      if (ev.listenerRequired !== false) {
        logger.warn(`[${moduleName}] Consumed event "${ev.name}" has no use case with trigger.kind=event. No listener will be generated.`);
      }
      return ev; // no command → no listener
    }

    const queueKey = ev.queueKey || `${moduleName}-${toRoutingKeyKebab(ev.name)}`;

    // If the event already declares its own payload, use it directly.
    if (ev.payload && ev.payload.length > 0) {
      // If the UC declares uc.input[], those fields drive the command record and
      // therefore the command constructor args the listener must pass.
      // Convención: uc.input[] field names must match consumed[].payload[] field names
      // so the listener can extract them from event.data() by name.
      const ucInputFields = (uc.input || []).filter((i) => i.source !== 'authContext');
      const commandPayload = ucInputFields.length > 0
        ? ucInputFields.map((i) => {
            // find matching type from consumed payload declaration
            const payloadField = ev.payload.find((p) => p.name === i.name);
            return { name: i.name, type: payloadField ? payloadField.type : (i.type || 'String') };
          })
        : []; // command is empty → listener calls new XyzCommand() with no args
      return {
        name:          ev.name,
        channel:       ev.channel || null,
        producer:      ev.channel ? ev.channel.split('.')[0] : (ev.sourceBc || 'unknown'),
        command:       uc.name,
        useCase:       uc.id,
        queueKey,
        payload:       ev.payload,
        commandPayload,
        // [G15] optional Java boolean expression evaluated on deserialized fields.
        filterExpr:    uc.trigger.filter || null,
      };
    }

    // Derive payload from UC method params + aggregate property types.
    // Uses balanced-paren parsing so String(200) doesn't terminate early.
    // Strips inline type hints (e.g. "accountId: Uuid" → name "accountId").
    const methodStr = uc.method || '';
    const firstParen = methodStr.indexOf('(');
    let paramsStr = '';
    if (firstParen !== -1) {
      let depth = 0, closeParen = -1;
      for (let i = firstParen; i < methodStr.length; i++) {
        if (methodStr[i] === '(') depth++;
        else if (methodStr[i] === ')') { depth--; if (depth === 0) { closeParen = i; break; } }
      }
      if (closeParen !== -1) paramsStr = methodStr.substring(firstParen + 1, closeParen).trim();
    }
    const rawParams = [];
    if (paramsStr) {
      let current = '', d = 0;
      for (const ch of paramsStr) {
        if (ch === '(') { d++; current += ch; }
        else if (ch === ')') { d--; current += ch; }
        else if (ch === ',' && d === 0) { rawParams.push(current.trim()); current = ''; }
        else { current += ch; }
      }
      if (current.trim()) rawParams.push(current.trim());
    }
    const paramNames = rawParams.filter(Boolean).map((p) => {
      const clean = p.replace('?', '').trim();
      const colonIdx = clean.indexOf(':');
      return colonIdx !== -1 ? clean.substring(0, colonIdx).trim() : clean;
    });
    const agg = (bcYaml.aggregates || []).find((a) => a.name === uc.aggregate);
    const aggProps = (agg && agg.properties) ? agg.properties : [];
    const payload = paramNames.map((paramName) => {
      const prop = aggProps.find((ap) => ap.name === paramName);
      return { name: paramName, type: prop ? prop.type : 'String' };
    });

    // No payload declared on the consumed event — check uc.input[] for source:body fields.
    // When present, those fields drive both the event.data() extraction and the command constructor.
    const ucBodyInputs = (uc.input || []).filter((i) => i.source !== 'authContext');
    if (ucBodyInputs.length > 0) {
      const commandPayload = ucBodyInputs.map((i) => ({ name: i.name, type: i.type || 'String' }));
      return {
        name:          ev.name,
        channel:       ev.channel || null,
        producer:      ev.channel ? ev.channel.split('.')[0] : (ev.sourceBc || 'unknown'),
        command:       uc.name,
        useCase:       uc.id,
        queueKey,
        payload:       commandPayload,
        commandPayload,
        filterExpr:    uc.trigger.filter || null,
      };
    }

    // No payload declared and no uc.input[] — command is empty, listener calls new XyzCommand().
    // The UC handler resolves what it needs from the aggregate repository using the event metadata.
    return {
      name:          ev.name,
      channel:       ev.channel || null,
      producer:      ev.channel ? ev.channel.split('.')[0] : (ev.sourceBc || 'unknown'),
      command:       uc.name,
      useCase:       uc.id,
      queueKey,
      payload:       [],
      commandPayload: [],
      // [G15] optional Java boolean expression evaluated on deserialized fields.
      filterExpr:    uc.trigger.filter || null,
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

  const enumNames = new Set((bcYaml.enums || []).map((e) => e.name));
  const voNames = new Set((bcYaml.valueObjects || []).map((v) => v.name));
  const eventDtoNames = new Set((bcYaml.eventDtos || []).map((d) => d.name));

  const metadataEnabled = !(config.events && config.events.metadata && config.events.metadata.enabled === false);

  const publishedEventCtxs = publishedEvents.map((e) =>
    buildEventContext(e, packageName, moduleName, asyncApiDoc, enumNames, voNames, metadataEnabled)
  );

  // Phase 4 (gap #13) — events with scope:internal must NOT generate IntegrationEvent,
  // MessageBroker port methods, broker adapter publish methods, handler bridge methods,
  // nor queue/exchange topology. They still get the DomainEvent record because the
  // aggregate emits it via raise() and the internal Spring event bus consumes it.
  const brokerEventCtxs = publishedEventCtxs.filter((ctx) => ctx.publishToBroker);

  let eventCount = 0;
  let integrationEventCount = 0;

  for (const event of publishedEvents) {
    await generateDomainEvent(event, packageName, moduleName, domainEventsDir, enumNames, voNames, metadataEnabled);
    eventCount++;
  }

  for (const eventCtx of brokerEventCtxs) {
    await generateIntegrationEvent(eventCtx, packageName, moduleName, appEventsDir);
    integrationEventCount++;
  }

  if (brokerEventCtxs.length > 0) {
    await generateMessageBrokerPort(brokerEventCtxs, packageName, moduleName, portsDir);
    // Phase 4 — annotate published events with their saga steps (if any).
    const annotatedCtxs = brokerEventCtxs.map((ctx) => ({
      ...ctx,
      sagaSteps: sagaEventIndex.get(ctx.name) || [],
    }));
    await generateDomainEventHandler(annotatedCtxs, packageName, moduleName, usecasesDir, outboxEnabled, sagasEnabled, config.broker);

    if (config.broker === 'kafka') {
      await generateKafkaMessageBrokerAdapter(brokerEventCtxs, packageName, moduleName, adaptersDir);
    } else {
      // Default: rabbitmq
      await generateRabbitMessageBrokerAdapter(brokerEventCtxs, packageName, moduleName, adaptersDir);
    }
  }

  // ── Per-BC RabbitMQ config (exchanges, queues, bindings, DLQs) ──────────
  if (config.broker === 'rabbitmq' && (brokerEventCtxs.length > 0 || resolvedConsumedEvents.length > 0)) {
    // Only include consumed events that have a listener (command field present)
    const consumedWithListener = resolvedConsumedEvents.filter((ev) => ev.command);

    // Persistent projections need queue+binding+DLQ beans — they have no UC command
    // so they are absent from resolvedConsumedEvents. Add synthetic entries here.
    for (const proj of (bcYaml.projections || [])) {
      if (proj.persistent !== true || !proj.source || proj.source.kind !== 'event') continue;
      const projKebab  = toKebabCase(proj.name);
      const eventKebab = toKebabCase(proj.source.event);
      const queueKey   = `${moduleName}-projection-${projKebab}-${eventKebab}`;
      consumedWithListener.push({ name: proj.source.event, producer: proj.source.from, queueKey });
      for (const src of (proj.additionalSources || [])) {
        const srcEventKebab = toKebabCase(src.event);
        const srcQueueKey   = `${moduleName}-projection-${projKebab}-${srcEventKebab}`;
        consumedWithListener.push({ name: src.event, producer: src.from || proj.source.from, queueKey: srcQueueKey });
      }
    }

    await generateBcRabbitMQConfig(
      brokerEventCtxs,
      consumedWithListener,
      packageName,
      moduleName,
      adaptersDir
    );
  }

  let listenerCount = 0;
  for (const consumed of resolvedConsumedEvents) {
    // Only generate listener if we have a command to dispatch to
    if (!consumed.command) continue;

    const sagaSteps = sagaEventIndex.get(consumed.name) || [];

    if (config.broker === 'kafka') {
      const listenersDir = path.join(bcBase, 'infrastructure', 'kafkaListener');
      await generateKafkaListener(consumed, packageName, moduleName, listenersDir, enumNames, voNames, consumerIdempotencyEnabled, sagasEnabled, sagaSteps, eventDtoNames);
    } else {
      const listenersDir = path.join(bcBase, 'infrastructure', 'rabbitListener');
      await generateRabbitListener(consumed, packageName, moduleName, listenersDir, enumNames, voNames, consumerIdempotencyEnabled, sagasEnabled, sagaSteps, eventDtoNames);
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
      // One exchange per publishing BC — only declared if at least one event has scope != 'internal'.
      const externalPublished = published.filter((e) => (e.scope || 'both') !== 'internal');
      if (externalPublished.length > 0) {
        exchangeMap.set(bcName, `${bcName}.events`);
      }

      for (const event of externalPublished) {
        const eventKebab = toKebabCase(event.name);
        const dotCase    = eventKebab.replace(/-/g, '.');
        // gap #1: when published[].channel is declared in the YAML, it takes
        // precedence over the derived kebab→dot fallback.
        const routingKey = event.channel || dotCase;
        // Publisher BC does not declare a queue for its own events.
        // Each consumer BC declares its own queue (e.g. {consumerBc}-{event-kebab})
        // bound to this exchange — see consumed[] loop below.
        // Only the routing-key needs to be registered so consumers can bind correctly.
        rkMap.set(eventKebab, routingKey);
      }
    }

    for (const event of consumed) {
      const eventKebab = toKebabCase(event.name);
      const dotCase    = eventKebab.replace(/-/g, '.');
      const queueKey   = event.queueKey || `${bcName}-${eventKebab}`;
      // gap #1: honour declared channel as the routing-key value.
      const routingKey = event.channel || dotCase;
      queueMap.set(queueKey, `${bcName}.${eventKebab}`);
      rkMap.set(queueKey,    routingKey);
      // Add producer BC exchange derived from channel (e.g. "inventory.stock-item.reserved" → "inventory")
      // or from sourceBc when channel is not declared. This ensures external producer exchanges are
      // declared even if that BC is not in allBcYamls.
      const producerBc = (event.channel ? event.channel.split('.')[0] : null) || event.sourceBc || null;
      if (producerBc && !exchangeMap.has(producerBc)) {
        exchangeMap.set(producerBc, `${producerBc}.events`);
      }
    }

    // Persistent projections (Phase 3): each one declares its own queue bound
    // to the source BC's exchange. Independent of domainEvents.consumed[].
    for (const proj of (bcYaml.projections || [])) {
      if (proj.persistent !== true || !proj.source || proj.source.kind !== 'event') continue;
      const projKebab  = toKebabCase(proj.name);
      // Primary source
      const eventKebab = toKebabCase(proj.source.event);
      const queueKey   = `${bcName}-projection-${projKebab}-${eventKebab}`;
      queueMap.set(queueKey, `${bcName}.${queueKey}`);
      rkMap.set(queueKey,    eventKebab.replace(/-/g, '.'));
      if (proj.source.from && !exchangeMap.has(proj.source.from)) {
        exchangeMap.set(proj.source.from, `${proj.source.from}.events`);
      }
      // Additional sources (partial updaters)
      for (const src of (proj.additionalSources || [])) {
        const srcEventKebab = toKebabCase(src.event);
        const srcQueueKey   = `${bcName}-projection-${projKebab}-${srcEventKebab}`;
        queueMap.set(srcQueueKey, `${bcName}.${srcQueueKey}`);
        rkMap.set(srcQueueKey, srcEventKebab.replace(/-/g, '.'));
        if (src.from && !exchangeMap.has(src.from)) {
          exchangeMap.set(src.from, `${src.from}.events`);
        }
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
      // Phase 4 (gap #13) — internal-only events have no broker topic.
      if ((event.scope || 'both') === 'internal') continue;
      const eventKebab = toKebabCase(event.name);
      topicMap.set(eventKebab, `${bcName}.${eventKebab}`);
    }

    for (const event of consumed) {
      const eventKebab = toKebabCase(event.name);
      const topicKey   = event.topicKey || `${bcName}-${eventKebab}`;
      // Derive producer BC from the first segment of the declared channel.
      // This ensures consumers subscribe to the same topic the producer publishes to.
      // Falls back to bcName (consumer) when channel is not declared — preserves prior behaviour.
      const producerBc = event.channel ? event.channel.split('.')[0] : bcName;
      topicMap.set(topicKey, `${producerBc}.${eventKebab}`);
    }

    // Persistent projections (Phase 3) declare an independent topic key.
    for (const proj of (bcYaml.projections || [])) {
      if (proj.persistent !== true || !proj.source || proj.source.kind !== 'event') continue;
      const projKebab  = toKebabCase(proj.name);
      // Primary source
      const eventKebab = toKebabCase(proj.source.event);
      const topicKey   = `${bcName}-projection-${projKebab}-${eventKebab}`;
      const sourceBc   = proj.source.from || bcName;
      topicMap.set(topicKey, `${sourceBc}.${eventKebab}`);
      // Additional sources (partial updaters)
      for (const src of (proj.additionalSources || [])) {
        const srcEventKebab = toKebabCase(src.event);
        const srcTopicKey   = `${bcName}-projection-${projKebab}-${srcEventKebab}`;
        const srcBc         = src.from || bcName;
        topicMap.set(srcTopicKey, `${srcBc}.${srcEventKebab}`);
      }
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
