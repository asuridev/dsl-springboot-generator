'use strict';

const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Reads and parses arch/{bcName}/{bcName}-async-api.yaml relative to CWD.
 *
 * Returns:
 * {
 *   channels: Array<{
 *     channel: string,      — channel address (e.g. "catalog.product.activated")
 *     action: string,       — "send" | "receive"
 *     messageName: string,  — name of the message schema
 *     payload: object,      — raw payload schema object
 *   }>,
 *   messages: Map<string, object>  — messageName → schema
 * }
 *
 * @param {string} bcName - BC name in kebab-case (e.g. "catalog")
 * @returns {Promise<{ channels: Array<object>, messages: Map<string, object> }>}
 */
async function readAsyncApiYaml(bcName) {
  const filePath = path.join(process.cwd(), 'arch', bcName, `${bcName}-async-api.yaml`);

  if (!(await fs.pathExists(filePath))) {
    return { channels: [], messages: new Map() };
  }

  const raw = await fs.readFile(filePath, 'utf-8');
  const doc = yaml.load(raw);

  const channels = [];
  const messages = new Map();
  const schemas = {}; // components.schemas for $ref resolution

  // AsyncAPI 3.x format: top-level "channels" object + "operations" object
  const docChannels = doc.channels || {};
  const docOperations = doc.operations || {};
  const docComponents = doc.components || {};
  const docMessages = (docComponents.messages || {});
  const docSchemas = docComponents.schemas || {};
  Object.assign(schemas, docSchemas);

  // Collect component messages
  for (const [msgName, msgSchema] of Object.entries(docMessages)) {
    messages.set(msgName, msgSchema);
  }

  // Parse channels
  for (const [channelId, channelDef] of Object.entries(docChannels)) {
    const address = channelDef.address || channelId;
    const channelMessages = channelDef.messages || {};

    for (const [msgRefKey, msgRef] of Object.entries(channelMessages)) {
      // Resolve $ref if present
      let msgName = msgRefKey;
      let msgSchema = msgRef;

      if (msgRef && msgRef.$ref) {
        // e.g. $ref: '#/components/messages/ProductActivated'
        const refParts = msgRef.$ref.split('/');
        msgName = refParts[refParts.length - 1];
        msgSchema = docMessages[msgName] || msgRef;
        messages.set(msgName, msgSchema);
      }

      // Determine action from operations
      let action = 'send';
      for (const [opId, opDef] of Object.entries(docOperations)) {
        const opChannel = opDef.channel || {};
        const opChannelRef = opChannel.$ref || '';
        if (opChannelRef.includes(channelId) || opId.toLowerCase().includes(channelId.replace(/\./g, '').toLowerCase())) {
          action = opDef.action || 'send';
          break;
        }
      }

      channels.push({
        channelId,
        channel: address,
        action,
        messageName: msgName,
        payload: msgSchema.payload || null,
        headers: msgSchema.headers || null,
      });
    }
  }

  return { channels, messages, schemas };
}

module.exports = { readAsyncApiYaml };
