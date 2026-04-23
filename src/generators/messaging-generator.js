'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toCamelCase, toPackagePath } = require('../utils/naming');
const { mapType } = require('../utils/type-mapper');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

// ─── AsyncAPI parsing ─────────────────────────────────────────────────────────

/**
 * Builds a map: eventName → channelName (routing key)
 * Uses the channels section of an AsyncAPI 2.x document.
 */
function buildChannelMap(asyncApiDoc) {
  const map = new Map();
  const channels = asyncApiDoc.channels || {};

  for (const [channelName, channelItem] of Object.entries(channels)) {
    const publish = channelItem.publish;
    if (!publish || !publish.message) continue;

    // Resolve message name from $ref or inline
    let messageName = null;
    const messageRef = publish.message.$ref;
    if (messageRef) {
      // "#/components/messages/ProductActivated" → "ProductActivated"
      messageName = messageRef.split('/').pop();
    } else if (publish.message.name) {
      messageName = publish.message.name;
    }

    if (messageName) {
      map.set(messageName, channelName);
    }
  }

  return map;
}

// ─── Event field type mapper ──────────────────────────────────────────────────

function javaTypeForEvent(type, packageName, moduleName, imports) {
  if (type === 'Uuid') {
    imports.add('java.util.UUID');
    return 'UUID';
  }
  if (type === 'DateTime') {
    imports.add('java.time.Instant');
    return 'Instant';
  }
  if (type === 'Decimal') {
    imports.add('java.math.BigDecimal');
    return 'BigDecimal';
  }
  if (type === 'Money') {
    imports.add(`${packageName}.${moduleName}.domain.valueobject.Money`);
    return 'Money';
  }
  if (type === 'Boolean') return 'boolean';
  if (type === 'Integer') return 'int';
  const stringMatch = /^String\(\d+\)$/.exec(type);
  if (stringMatch || type === 'Text' || type === 'Email' || type === 'Url') return 'String';
  return 'String';
}

// ─── Individual generators ────────────────────────────────────────────────────

async function generateDomainEvent(event, packageName, moduleName, eventsDir) {
  const imports = new Set();
  const fields = (event.payload || []).map((p) => ({
    type: javaTypeForEvent(p.type, packageName, moduleName, imports),
    name: p.name,
  }));

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

async function generatePublisher(event, channelName, systemName, packageName, moduleName, publisherDir) {
  const exchange = `${systemName}.events`;

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'messaging', 'EventPublisher.java.ejs'),
    path.join(publisherDir, `${event.name}Publisher.java`),
    {
      packageName,
      moduleName,
      eventName: event.name,
      exchange,
      routingKey: channelName,
    }
  );
}

// ─── RabbitMQ Config (shared, generated once) ─────────────────────────────────

async function generateRabbitMQConfig(systemName, packageName, sharedDir) {
  const exchange = `${systemName}.events`;

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'messaging', 'RabbitMQConfig.java.ejs'),
    path.join(sharedDir, 'infrastructure', 'configurations', 'rabbitmqConfig', 'RabbitMQConfig.java'),
    {
      packageName,
      exchange,
    }
  );
}

// ─── Main generator ───────────────────────────────────────────────────────────

/**
 * Generates domain events + publishers for one BC.
 * Returns { eventCount, publisherCount }.
 */
async function generateMessagingLayer(bcYaml, asyncApiDoc, config, outputDir) {
  const packageName = config.packageName;
  const systemName = config.systemName;
  const moduleName = bcYaml.bc;

  const publishedEvents = (bcYaml.domainEvents || {}).published || [];
  if (publishedEvents.length === 0) return { eventCount: 0, publisherCount: 0 };

  const channelMap = buildChannelMap(asyncApiDoc);

  const bcDir = path.join(
    outputDir,
    'src',
    'main',
    'java',
    ...toPackagePath(packageName).split('/'),
    moduleName
  );

  const eventsDir = path.join(bcDir, 'domain', 'events');
  const publisherDir = path.join(bcDir, 'infrastructure', 'messaging');

  let eventCount = 0;
  let publisherCount = 0;

  for (const event of publishedEvents) {
    // Generate domain event record
    await generateDomainEvent(event, packageName, moduleName, eventsDir);
    eventCount++;

    // Generate publisher (only if there is a channel for this event)
    const channelName = channelMap.get(event.name);
    if (channelName) {
      await generatePublisher(event, channelName, systemName, packageName, moduleName, publisherDir);
      publisherCount++;
    }
  }

  return { eventCount, publisherCount };
}

/**
 * Generates the shared RabbitMQConfig.
 */
async function generateSharedRabbitConfig(config, outputDir) {
  const packageName = config.packageName;
  const systemName = config.systemName;

  const sharedDir = path.join(
    outputDir,
    'src',
    'main',
    'java',
    ...toPackagePath(packageName).split('/'),
    'shared'
  );

  await generateRabbitMQConfig(systemName, packageName, sharedDir);
}

module.exports = { generateMessagingLayer, generateSharedRabbitConfig };
