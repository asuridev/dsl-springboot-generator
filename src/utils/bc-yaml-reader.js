'use strict';

const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const { PROHIBITED_TYPES } = require('./type-mapper');
const { toPascalCase } = require('./naming');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fail(msg) {
  throw new Error(`[bc-yaml-reader] ${msg}`);
}

function assertUnique(items, keyFn, label) {
  const seen = new Set();
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) fail(`Duplicate ${label}: "${key}"`);
    seen.add(key);
  }
}

function resolveType(type) {
  if (!type) return;
  const base = type.replace(/\(.*\)/, '').replace(/\[.*\]/, '').trim();
  if (PROHIBITED_TYPES.has(base)) {
    fail(`Prohibited type "${type}" found. Use canonical types per §11.`);
  }
}

// ─── Validators ──────────────────────────────────────────────────────────────

/**
 * Validate all properties of an aggregate / entity for prohibited types
 * and Decimal precision/scale rules.
 */
function validateProperties(properties, context) {
  if (!Array.isArray(properties)) return;
  for (const prop of properties) {
    resolveType(prop.type);

    if (prop.type === 'Decimal') {
      if (prop.precision == null || prop.scale == null) {
        fail(`Property "${prop.name}" in ${context} has type Decimal but is missing "precision" and/or "scale".`);
      }
    }
  }
}

/**
 * Full validation per BC-YAML-GENERATOR-SPEC §15.
 */
function validate(doc) {
  const bc = doc.bc;

  // ── 3. Uniqueness of IDs ───────────────────────────────────────────────────
  const useCases = doc.useCases || [];
  assertUnique(useCases, (uc) => uc.id, 'use case id');

  const errors = doc.errors || [];
  assertUnique(errors, (e) => e.code, 'error code');

  // Collect all rule IDs across aggregates
  const allRuleIds = new Set();
  const allErrorCodes = new Set(errors.map((e) => e.code));
  const allEventNames = new Set([
    ...((doc.domainEvents || {}).published || []).map((e) => e.name),
    ...((doc.domainEvents || {}).consumed || []).map((e) => e.name),
  ]);

  // ── domainRules schema (whitelist + allowed types) ──────────────────────
  const ALLOWED_RULE_TYPES = new Set([
    'uniqueness', 'statePrecondition', 'terminalState',
    'sideEffect', 'deleteGuard', 'crossAggregateConstraint',
  ]);
  const ALLOWED_RULE_KEYS = new Set([
    'id', 'type', 'errorCode', 'description',
    'appliesTo', 'targetAggregate', 'targetRepositoryMethod',
    'field', 'expectedStatus',
  ]);
  // Rule types that REQUIRE errorCode
  const RULE_TYPES_REQUIRING_ERROR = new Set([
    'uniqueness', 'statePrecondition', 'deleteGuard', 'crossAggregateConstraint',
  ]);

  for (const agg of doc.aggregates || []) {
    for (const rule of agg.domainRules || []) {
      if (!rule || typeof rule !== 'object') {
        fail(`Aggregate "${agg.name}" has an invalid domainRule entry; expected a mapping with id and type.`);
      }
      if (!rule.id) fail(`Aggregate "${agg.name}" has a domainRule without "id".`);
      if (!rule.type) fail(`domainRule "${rule.id}" is missing required field "type".`);
      if (!ALLOWED_RULE_TYPES.has(rule.type)) {
        fail(`domainRule "${rule.id}" has unsupported type "${rule.type}". Allowed types: ${[...ALLOWED_RULE_TYPES].join(', ')}.`);
      }
      for (const key of Object.keys(rule)) {
        if (!ALLOWED_RULE_KEYS.has(key)) {
          fail(`domainRule "${rule.id}" declares unsupported attribute "${key}". Allowed keys: ${[...ALLOWED_RULE_KEYS].join(', ')}.`);
        }
      }
      if (RULE_TYPES_REQUIRING_ERROR.has(rule.type) && !rule.errorCode) {
        fail(`domainRule "${rule.id}" of type "${rule.type}" requires an "errorCode".`);
      }
      if (rule.type === 'deleteGuard') {
        // Hints needed for executable generation are optional but mutually-coupled.
        if ((rule.targetAggregate && !rule.targetRepositoryMethod) ||
            (!rule.targetAggregate && rule.targetRepositoryMethod)) {
          fail(`domainRule "${rule.id}" (deleteGuard): "targetAggregate" and "targetRepositoryMethod" must be declared together.`);
        }
      }
      if (rule.type === 'crossAggregateConstraint') {
        if (rule.targetAggregate || rule.field || rule.expectedStatus) {
          if (!rule.targetAggregate || !rule.field || !rule.expectedStatus) {
            fail(`domainRule "${rule.id}" (crossAggregateConstraint): "targetAggregate", "field" and "expectedStatus" must be declared together.`);
          }
        }
      }
      if (allRuleIds.has(rule.id)) fail(`Duplicate domainRule id: "${rule.id}"`);
      allRuleIds.add(rule.id);
    }
    // Validate properties
    validateProperties(agg.properties, `aggregate ${agg.name}`);
    for (const entity of agg.entities || []) {
      validateProperties(entity.properties, `entity ${entity.name}`);
      // S6 — child entity relationship/cardinality whitelist
      if (entity.relationship !== undefined &&
          entity.relationship !== 'composition' &&
          entity.relationship !== 'aggregation') {
        fail(`entity "${entity.name}" in aggregate "${agg.name}": "relationship" must be "composition" or "aggregation" (got "${entity.relationship}").`);
      }
      if (entity.cardinality !== undefined &&
          entity.cardinality !== 'oneToMany' &&
          entity.cardinality !== 'oneToOne') {
        fail(`entity "${entity.name}" in aggregate "${agg.name}": "cardinality" must be "oneToMany" or "oneToOne" (got "${entity.cardinality}").`);
      }
    }
  }

  // ── Value Objects ──────────────────────────────────────────────────────────
  const voNames = new Set((doc.valueObjects || []).map((v) => v.name));
  const enumNames = new Set((doc.enums || []).map((e) => e.name));
  const aggregateNames = new Set((doc.aggregates || []).map((a) => a.name));
  for (const vo of doc.valueObjects || []) {
    if (!vo.name) fail('A valueObject entry is missing required field "name".');
    if (!Array.isArray(vo.properties) || vo.properties.length === 0) {
      fail(`Value object "${vo.name}" has no properties. A VO must declare at least one property.`);
    }
    validateProperties(vo.properties, `valueObject ${vo.name}`);

    // Each property type must resolve to a canonical type, an enum, another VO, or List[<resolvable>]
    for (const prop of vo.properties) {
      const baseType = (prop.type || '').replace(/^List\[(.+)\]$/, '$1');
      // Strip String(n) parameterization
      const head = baseType.replace(/\(.*\)/, '');
      const CANONICAL = new Set([
        'Uuid', 'String', 'Text', 'Integer', 'Long', 'Decimal', 'Boolean',
        'Date', 'DateTime', 'Duration', 'Email', 'Url', 'Money', 'PageRequest',
      ]);
      if (CANONICAL.has(head)) continue;
      // Enum<X> wrapper
      const enumWrap = /^Enum<(.+)>$/.exec(head);
      if (enumWrap) {
        if (!enumNames.has(enumWrap[1])) {
          fail(`Value object "${vo.name}" property "${prop.name}" references unknown enum "${enumWrap[1]}".`);
        }
        continue;
      }
      // PascalCase domain reference: must be enum or VO (not aggregate)
      if (enumNames.has(head) || voNames.has(head)) continue;
      if (aggregateNames.has(head)) {
        fail(`Value object "${vo.name}" property "${prop.name}" references aggregate "${head}". A VO may not embed an aggregate; use a Uuid reference or another VO.`);
      }
      fail(`Value object "${vo.name}" property "${prop.name}" has unresolved type "${prop.type}". Declare it under enums[] or valueObjects[], or use a canonical type.`);
    }
  }

  // ── Projections ────────────────────────────────────────────────────────────
  const RESERVED_PROJECTION_SUFFIX = /(Dto|Response|Request|Payload)$/;
  const ALLOWED_PROJECTION_PROP_KEYS = new Set([
    'name', 'type', 'required', 'description', 'example', 'serializedName', 'derivedFrom',
  ]);
  const projectionNames = new Set();
  for (const proj of doc.projections || []) {
    if (!proj.name) fail('A projection entry is missing required field "name".');
    if (projectionNames.has(proj.name)) fail(`Duplicate projection name: "${proj.name}"`);
    if (RESERVED_PROJECTION_SUFFIX.test(proj.name)) {
      fail(`Projection "${proj.name}" uses a reserved suffix (Dto/Response/Request/Payload). Choose a name that reflects the read-model intent (e.g. ProductSummary, OrderSnapshot).`);
    }
    if (!Array.isArray(proj.properties) || proj.properties.length === 0) {
      fail(`Projection "${proj.name}" must declare at least one property under "properties".`);
    }
    if (proj.source != null) {
      if (typeof proj.source !== 'string' || !/^(aggregate|readModel):[A-Z][A-Za-z0-9_]*$/.test(proj.source)) {
        fail(`Projection "${proj.name}" has invalid "source" value "${proj.source}". Expected "aggregate:<Name>" or "readModel:<Name>".`);
      }
    }
    for (const prop of proj.properties) {
      if (!prop || typeof prop !== 'object') {
        fail(`Projection "${proj.name}" has an invalid property entry; expected a mapping with at least "name" and "type".`);
      }
      for (const key of Object.keys(prop)) {
        if (!ALLOWED_PROJECTION_PROP_KEYS.has(key)) {
          fail(`Projection "${proj.name}" property "${prop.name || '<unnamed>'}" declares unsupported attribute "${key}". Allowed keys: ${[...ALLOWED_PROJECTION_PROP_KEYS].join(', ')}.`);
        }
      }
      if (!prop.name) fail(`Projection "${proj.name}" has a property without "name".`);
      if (!prop.type) fail(`Projection "${proj.name}" property "${prop.name}" is missing required field "type".`);
    }
    projectionNames.add(proj.name);
    validateProperties(proj.properties, `projection ${proj.name}`);
  }

  // Second pass: every property type in projections must resolve to a canonical
  // type, an enum, a VO, another projection or List[<resolvable>]. Aggregates
  // are not embeddable in projections — use their id (Uuid) instead.
  const CANONICAL_PROJ_TYPES = new Set([
    'Uuid', 'String', 'Text', 'Integer', 'Long', 'Decimal', 'Boolean',
    'Date', 'DateTime', 'Duration', 'Email', 'Url', 'Money',
  ]);
  for (const proj of doc.projections || []) {
    for (const prop of proj.properties || []) {
      const baseType = (prop.type || '').replace(/^List\[(.+)\]$/, '$1');
      const head = baseType.replace(/\(.*\)/, '');
      if (CANONICAL_PROJ_TYPES.has(head)) continue;
      const enumWrap = /^Enum<(.+)>$/.exec(head);
      if (enumWrap) {
        if (!enumNames.has(enumWrap[1])) {
          fail(`Projection "${proj.name}" property "${prop.name}" references unknown enum "${enumWrap[1]}".`);
        }
        continue;
      }
      if (enumNames.has(head) || voNames.has(head) || projectionNames.has(head)) continue;
      if (aggregateNames.has(head)) {
        fail(`Projection "${proj.name}" property "${prop.name}" references aggregate "${head}". A projection may not embed an aggregate; expose its identifier (Uuid) or compose another projection.`);
      }
      fail(`Projection "${proj.name}" property "${prop.name}" has unresolved type "${prop.type}". Declare it under enums[], valueObjects[] or projections[], or use a canonical type.`);
    }
  }

  // ── 1. Referential integrity ───────────────────────────────────────────────
  for (const uc of useCases) {
    // rules must reference declared rule IDs
    for (const ruleId of uc.rules || []) {
      if (!allRuleIds.has(ruleId)) {
        fail(`Use case "${uc.id}" references unknown rule "${ruleId}". Declare it in an aggregate's domainRules.`);
      }
    }

    // notFoundError references must exist in errors
    const notFoundErrors = Array.isArray(uc.notFoundError) ? uc.notFoundError : uc.notFoundError ? [uc.notFoundError] : [];
    for (const code of notFoundErrors) {
      if (!allErrorCodes.has(code)) {
        fail(`Use case "${uc.id}" notFoundError "${code}" not found in errors[].`);
      }
    }

    // emits must reference a published event (S22: accept string or list)
    const ucEmitsList = Array.isArray(uc.emits)
      ? uc.emits
      : (uc.emits && uc.emits !== 'null' ? [uc.emits] : []);
    {
      const seen = new Set();
      for (const ev of ucEmitsList) {
        if (seen.has(ev)) fail(`Use case "${uc.id}" declares duplicate emits entry "${ev}".`);
        seen.add(ev);
        if (!allEventNames.has(ev)) {
          fail(`Use case "${uc.id}" emits "${ev}" which is not declared in domainEvents.published.`);
        }
      }
    }
    uc.emitsList = ucEmitsList;

    // fkValidations error (new schema: fk.error; legacy: fk.notFoundError)
    for (const fk of uc.fkValidations || []) {
      const fkErrorCode = fk.error || fk.notFoundError;
      if (fkErrorCode && !allErrorCodes.has(fkErrorCode)) {
        fail(`Use case "${uc.id}" fkValidation error "${fkErrorCode}" not found in errors[].`);
      }
    }
  }

  // domainRules errorCode must exist in errors
  for (const agg of doc.aggregates || []) {
    for (const rule of agg.domainRules || []) {
      if (rule.errorCode && !allErrorCodes.has(rule.errorCode)) {
        fail(`domainRule "${rule.id}" errorCode "${rule.errorCode}" not found in errors[].`);
      }
    }

    // domainMethods[].emits must reference a published event (S22: accept string or list)
    for (const dm of agg.domainMethods || []) {
      const dmEmitsList = Array.isArray(dm.emits)
        ? dm.emits
        : (dm.emits && dm.emits !== 'null' && dm.emits !== null ? [dm.emits] : []);
      const seen = new Set();
      for (const ev of dmEmitsList) {
        if (seen.has(ev)) {
          fail(`domainMethod "${dm.name}" in aggregate "${agg.name}" declares duplicate emits entry "${ev}".`);
        }
        seen.add(ev);
        if (!allEventNames.has(ev)) {
          fail(`domainMethod "${dm.name}" in aggregate "${agg.name}" emits "${ev}" which is not declared in domainEvents.published.`);
        }
      }
      dm.emitsList = dmEmitsList;
    }
  }

  // command UCs must reference a declared domainMethod
  const aggByName = new Map((doc.aggregates || []).map((a) => [a.name, a]));
  for (const uc of useCases) {
    if (uc.type !== 'command' || !uc.method) continue;
    const agg = aggByName.get(uc.aggregate);
    if (!agg) continue;
    const dm = (agg.domainMethods || []).find((m) => m.name === uc.method);
    if (!dm) {
      fail(`Use case "${uc.id}" references method "${uc.method}" which is not declared in aggregate "${agg.name}" domainMethods.`);
    }
  }

  // query UCs with trigger.kind: http must declare uc.returns
  for (const uc of useCases) {
    if (uc.type !== 'query') continue;
    if (uc.trigger && uc.trigger.kind === 'http' && !uc.returns) {
      fail(`Use case "${uc.id}" (query, http) is missing required field "returns".`);
    }
  }

  // ── domainEvents schema (Phase 4: scope, broker hints, retry/dlq) ─────────
  const ALLOWED_SCOPES = new Set(['internal', 'integration', 'both']);
  const ALLOWED_BROKER_KEYS = new Set(['partitionKey', 'headers', 'retry', 'dlq']);
  const ALLOWED_RETRY_KEYS = new Set(['maxAttempts', 'backoff', 'initialMs', 'maxMs']);
  const ALLOWED_BACKOFF = new Set(['fixed', 'exponential']);
  const ALLOWED_DLQ_KEYS = new Set(['afterAttempts', 'target']);

  function validateRetry(retry, ctx) {
    if (retry == null) return;
    if (typeof retry !== 'object' || Array.isArray(retry)) {
      fail(`${ctx} "retry" must be a mapping.`);
    }
    for (const k of Object.keys(retry)) {
      if (!ALLOWED_RETRY_KEYS.has(k)) {
        fail(`${ctx} "retry.${k}" is not a recognised key. Allowed: ${[...ALLOWED_RETRY_KEYS].join(', ')}.`);
      }
    }
    if (retry.maxAttempts != null && (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1)) {
      fail(`${ctx} "retry.maxAttempts" must be a positive integer.`);
    }
    if (retry.backoff != null && !ALLOWED_BACKOFF.has(retry.backoff)) {
      fail(`${ctx} "retry.backoff" must be one of: ${[...ALLOWED_BACKOFF].join(', ')}.`);
    }
    if (retry.initialMs != null && (!Number.isInteger(retry.initialMs) || retry.initialMs < 0)) {
      fail(`${ctx} "retry.initialMs" must be a non-negative integer (milliseconds).`);
    }
    if (retry.maxMs != null && (!Number.isInteger(retry.maxMs) || retry.maxMs < 0)) {
      fail(`${ctx} "retry.maxMs" must be a non-negative integer (milliseconds).`);
    }
  }

  function validateDlq(dlq, ctx) {
    if (dlq == null) return;
    if (typeof dlq !== 'object' || Array.isArray(dlq)) {
      fail(`${ctx} "dlq" must be a mapping.`);
    }
    for (const k of Object.keys(dlq)) {
      if (!ALLOWED_DLQ_KEYS.has(k)) {
        fail(`${ctx} "dlq.${k}" is not a recognised key. Allowed: ${[...ALLOWED_DLQ_KEYS].join(', ')}.`);
      }
    }
    if (dlq.afterAttempts != null && (!Number.isInteger(dlq.afterAttempts) || dlq.afterAttempts < 1)) {
      fail(`${ctx} "dlq.afterAttempts" must be a positive integer.`);
    }
    if (dlq.target != null && typeof dlq.target !== 'string') {
      fail(`${ctx} "dlq.target" must be a string (queue/topic name).`);
    }
  }

  for (const ev of (doc.domainEvents || {}).published || []) {
    const ctx = `domainEvents.published "${ev.name}"`;
    if (ev.scope != null && !ALLOWED_SCOPES.has(ev.scope)) {
      fail(`${ctx} declares unsupported scope "${ev.scope}". Allowed: ${[...ALLOWED_SCOPES].join(', ')}.`);
    }
    if (ev.broker != null) {
      if (typeof ev.broker !== 'object' || Array.isArray(ev.broker)) {
        fail(`${ctx} "broker" must be a mapping.`);
      }
      for (const k of Object.keys(ev.broker)) {
        if (!ALLOWED_BROKER_KEYS.has(k)) {
          fail(`${ctx} declares unsupported broker key "${k}". Allowed: ${[...ALLOWED_BROKER_KEYS].join(', ')}.`);
        }
      }
      if (ev.broker.partitionKey != null) {
        if (typeof ev.broker.partitionKey !== 'string') {
          fail(`${ctx} "broker.partitionKey" must be a string (payload field name).`);
        }
        const fields = (ev.payload || []).map((p) => p.name);
        if (fields.length > 0 && !fields.includes(ev.broker.partitionKey)) {
          fail(`${ctx} "broker.partitionKey" references "${ev.broker.partitionKey}" which is not declared in payload.`);
        }
      }
      if (ev.broker.headers != null) {
        if (typeof ev.broker.headers !== 'object' || Array.isArray(ev.broker.headers)) {
          fail(`${ctx} "broker.headers" must be a mapping of header name → value template.`);
        }
      }
      validateRetry(ev.broker.retry, ctx);
      validateDlq(ev.broker.dlq, ctx);
    }
  }

  for (const ev of (doc.domainEvents || {}).consumed || []) {
    const ctx = `domainEvents.consumed "${ev.name}"`;
    validateRetry(ev.retry, ctx);
    validateDlq(ev.dlq, ctx);
  }

  // ── 4. readModel validation ────────────────────────────────────────────────
  for (const agg of doc.aggregates || []) {
    if (agg.readModel) {
      if (!agg.sourceBC) fail(`readModel aggregate "${agg.name}" must have "sourceBC".`);
      if (!agg.sourceEvents || agg.sourceEvents.length === 0) {
        fail(`readModel aggregate "${agg.name}" must have "sourceEvents".`);
      }
      // Only commands must be event-triggered; queries on a readModel aggregate
      // may still be exposed via HTTP (e.g. list endpoints on the LRM).
      const readModelCommands = useCases.filter(
        (uc) => uc.aggregate === agg.name && uc.type === 'command'
      );
      for (const uc of readModelCommands) {
        if (!uc.trigger || uc.trigger.kind !== 'event') {
          fail(`readModel aggregate "${agg.name}" command "${uc.id}" must have trigger.kind: event.`);
        }
      }
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Reads, parses, and validates arch/{bc}/{bc}.yaml relative to CWD.
 * @param {string} bcName - BC name in kebab-case (e.g. "catalog")
 * @returns {Promise<object>} Parsed and validated BC document
 */
/**
 * Normalize use cases that declare `returns:` as an inline list of properties.
 * Each such inline list is hoisted into a synthetic projection named
 * `${PascalCase(uc.name)}Result` and inserted into `doc.projections[]`.
 * `uc.returns` is then replaced with the projection name (string).
 *
 * Example:
 *   uc.returns:
 *     - { name: productId, type: Uuid }
 *     - { name: price, type: Money }
 *   → uc.returns: 'ValidateProductAndSnapPriceResult'
 *   → doc.projections += { name: 'ValidateProductAndSnapPriceResult', properties: [...] }
 */
function normalizeInlineReturns(doc) {
  if (!Array.isArray(doc.useCases)) return;
  doc.projections = doc.projections || [];
  const existingProjectionNames = new Set(doc.projections.map((p) => p.name));

  for (const uc of doc.useCases) {
    if (!Array.isArray(uc.returns)) continue;
    if (uc.returns.length === 0) {
      fail(`Use case "${uc.id || uc.name}" declares an empty inline "returns" list.`);
    }
    // Validate each entry has at least name + type before synthesizing
    for (const entry of uc.returns) {
      if (!entry || typeof entry !== 'object' || !entry.name || !entry.type) {
        fail(`Use case "${uc.id || uc.name}" has an invalid inline "returns" entry: each item must declare "name" and "type".`);
      }
    }
    const projectionName = `${toPascalCase(uc.name)}Result`;
    if (existingProjectionNames.has(projectionName)) {
      fail(`Cannot synthesize projection "${projectionName}" for use case "${uc.id || uc.name}": a projection with that name already exists. Rename the explicit projection or use a non-inline "returns".`);
    }
    doc.projections.push({
      name: projectionName,
      description: `Auto-generated projection for use case ${uc.id || uc.name}.`,
      properties: uc.returns,
    });
    existingProjectionNames.add(projectionName);
    uc.returns = projectionName;
  }
}

async function readBcYaml(bcName) {
  const filePath = path.join(process.cwd(), 'arch', bcName, `${bcName}.yaml`);

  if (!(await fs.pathExists(filePath))) {
    fail(`BC YAML not found at: ${filePath}`);
  }

  const raw = (await fs.readFile(filePath, 'utf-8')).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Pre-process: method signatures like `method: create(x, y?): ReturnType` contain
  // ": " which YAML interprets as a mapping entry. Quote these values before parsing.
  const preprocessed = raw.replace(
    /^(\s+(?:returns|signature):\s+)([^\n"'`#][^\n]*)$/gm,
    (match, prefix, value) => {
      if (value.startsWith('"') || value.startsWith("'")) return match;
      if (value.includes(': ') || value.includes('?')) {
        const escaped = value.replace(/"/g, '\\"');
        return `${prefix}"${escaped}"`;
      }
      return match;
    }
  );

  const doc = yaml.load(preprocessed);

  if (!doc.bc) fail(`Missing "bc" field in ${filePath}`);
  if (doc.bc !== bcName) fail(`"bc" field "${doc.bc}" does not match expected BC name "${bcName}".`);

  normalizeInlineReturns(doc);

  validate(doc);

  return doc;
}

module.exports = { readBcYaml };
