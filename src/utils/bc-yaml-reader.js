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
function validate(doc, opts = {}) {
  const bc = doc.bc;
  const systemActors = opts.systemActors instanceof Set ? opts.systemActors : null;

  // ── 3. Uniqueness of IDs ───────────────────────────────────────────────────
  const useCases = doc.useCases || [];
  assertUnique(useCases, (uc) => uc.id, 'use case id');

  // ── useCases schema (whitelist + actor cross-check) ───────────────────────
  // [G18] strict whitelist on useCases[] and useCases[].input[] keys; an
  // unknown key (e.g. "triger" or "inputs") aborts the build instead of
  // silently producing incomplete code.
  const ALLOWED_UC_KEYS = new Set([
    'id', 'name', 'type', 'actor', 'description',
    'trigger', 'aggregate', 'method',
    // [G6] multi-aggregate same-BC saga
    'aggregates', 'steps',
    'input', 'returns', 'rules', 'notFoundError',
    'fkValidations', 'implementation', 'emits',
    // [G7] declarative pagination/sorting
    'pagination',
    // [G3] declarative authorization
    'authorization',
    // [G2] declarative idempotency
    'idempotency',
    // [G9] bulk command wrapper
    'bulk',
    // [G10] async / job tracking
    'async',
    // [G20] cross-field validations (declarative guards beyond Bean Validation)
    'validations',
    // tolerated aliases / late-stage normalisations
    'emitsList',
  ]);
  const ALLOWED_UC_VALIDATION_KEYS = new Set(['id', 'expression', 'errorCode', 'description']);
  const ALLOWED_UC_TRIGGER_KEYS = new Set([
    'kind', 'operationId',
    // [G15] event-triggered UCs
    'event', 'channel', 'consumes', 'fromBc', 'filter',
  ]);
  const ALLOWED_UC_INPUT_KEYS = new Set([
    'name', 'type', 'required', 'source', 'loadAggregate',
    // [G11] header source
    'headerName',
    // [G5] defaults + numeric max
    'default', 'max',
    // [G12] multipart source
    'partName', 'maxSize', 'contentTypes',
    // [G8] SearchText fields[] (which aggregate properties to search)
    'fields',
  ]);
  const ALLOWED_UC_FK_KEYS = new Set([
    'aggregate', 'param', 'error', 'notFoundError', 'bc', 'conditional',
  ]);
  const ALLOWED_UC_TYPES = new Set(['command', 'query']);
  const ALLOWED_UC_TRIGGER_KINDS = new Set(['http', 'event']);
  const ALLOWED_UC_INPUT_SOURCES = new Set(['body', 'path', 'query', 'authContext', 'header', 'multipart']);
  const ALLOWED_UC_PAGINATION_KEYS = new Set(['defaultSize', 'maxSize', 'sortable', 'defaultSort']);
  const ALLOWED_UC_DEFAULT_SORT_KEYS = new Set(['field', 'direction']);
  const ALLOWED_UC_SORT_DIRECTIONS = new Set(['ASC', 'DESC']);
  // [G3] authorization whitelists
  const ALLOWED_UC_AUTHZ_KEYS = new Set(['rolesAnyOf', 'ownership']);
  const ALLOWED_UC_OWNERSHIP_KEYS = new Set(['field', 'claim', 'allowRoleBypass']);
  // [G2] idempotency whitelists
  const ALLOWED_UC_IDEMPOTENCY_KEYS = new Set(['header', 'ttl', 'storage']);
  const ALLOWED_UC_IDEMPOTENCY_STORAGES = new Set(['database', 'redis']);
  // [G9] bulk whitelists
  const ALLOWED_UC_BULK_KEYS = new Set(['itemType', 'maxItems', 'onItemError']);
  const ALLOWED_UC_BULK_ON_ITEM_ERROR = new Set(['continue', 'abort']);
  // [G10] async whitelists
  const ALLOWED_UC_ASYNC_KEYS = new Set(['mode', 'statusEndpoint']);
  const ALLOWED_UC_ASYNC_MODES = new Set(['jobTracking', 'fireAndForget']);
  // [G6] multi-aggregate same-BC saga whitelists
  const ALLOWED_UC_STEP_KEYS = new Set(['aggregate', 'method', 'onFailure']);
  const ALLOWED_UC_ON_FAILURE_KEYS = new Set(['compensate']);
  const ALLOWED_UC_COMPENSATE_KEYS = new Set(['aggregate', 'method']);
  const ALLOWED_UC_IMPLEMENTATIONS = new Set(['full', 'scaffold']);

  for (const uc of useCases) {
    if (!uc || typeof uc !== 'object' || Array.isArray(uc)) {
      fail(`useCases[] contains a non-mapping entry; each use case must be an object with at least "id", "name" and "type".`);
    }
    for (const key of Object.keys(uc)) {
      if (!ALLOWED_UC_KEYS.has(key)) {
        fail(`Use case "${uc.id || uc.name || '<unnamed>'}" declares unsupported attribute "${key}". Allowed keys: ${[...ALLOWED_UC_KEYS].join(', ')}.`);
      }
    }
    if (!uc.id) fail(`A useCases[] entry is missing required field "id".`);
    if (!uc.name) fail(`Use case "${uc.id}" is missing required field "name".`);
    if (!uc.type) fail(`Use case "${uc.id}" is missing required field "type".`);
    if (!ALLOWED_UC_TYPES.has(uc.type)) {
      fail(`Use case "${uc.id}" has unsupported type "${uc.type}". Allowed: ${[...ALLOWED_UC_TYPES].join(', ')}.`);
    }
    if (uc.implementation != null && !ALLOWED_UC_IMPLEMENTATIONS.has(uc.implementation)) {
      fail(`Use case "${uc.id}" has unsupported implementation "${uc.implementation}". Allowed: ${[...ALLOWED_UC_IMPLEMENTATIONS].join(', ')}.`);
    }
    if (uc.trigger != null) {
      if (typeof uc.trigger !== 'object' || Array.isArray(uc.trigger)) {
        fail(`Use case "${uc.id}" has invalid "trigger"; expected a mapping with "kind" (and optional "operationId").`);
      }
      for (const k of Object.keys(uc.trigger)) {
        if (!ALLOWED_UC_TRIGGER_KEYS.has(k)) {
          fail(`Use case "${uc.id}" trigger declares unsupported key "${k}". Allowed: ${[...ALLOWED_UC_TRIGGER_KEYS].join(', ')}.`);
        }
      }
      if (uc.trigger.kind && !ALLOWED_UC_TRIGGER_KINDS.has(uc.trigger.kind)) {
        fail(`Use case "${uc.id}" trigger.kind "${uc.trigger.kind}" is not supported. Allowed: ${[...ALLOWED_UC_TRIGGER_KINDS].join(', ')}.`);
      }
      if (uc.trigger.kind === 'http' && !uc.trigger.operationId) {
        fail(`Use case "${uc.id}" trigger.kind: http requires "operationId".`);
      }
      // [G15] event-triggered UC: require event name (event or consumes alias).
      if (uc.trigger.kind === 'event') {
        if (uc.trigger.event != null && uc.trigger.consumes != null) {
          fail(`Use case "${uc.id}" trigger declares both "event" and "consumes". Use one — "consumes" is the canonical key, "event" is a legacy alias.`);
        }
        // Normalise consumes → event so the messaging generator (which reads
        // uc.trigger.event) doesn't need to learn about both names.
        if (uc.trigger.consumes != null && uc.trigger.event == null) {
          uc.trigger.event = uc.trigger.consumes;
        }
        if (!uc.trigger.event || typeof uc.trigger.event !== 'string') {
          fail(`Use case "${uc.id}" trigger.kind: event requires "consumes" (or legacy "event") with the consumed event name.`);
        }
        if (uc.trigger.fromBc != null && typeof uc.trigger.fromBc !== 'string') {
          fail(`Use case "${uc.id}" trigger.fromBc must be a string (the bounded-context name that publishes the event).`);
        }
        if (uc.trigger.filter != null && typeof uc.trigger.filter !== 'string') {
          fail(`Use case "${uc.id}" trigger.filter must be a string (a Java boolean expression evaluated on the deserialized event fields, e.g. "amount.compareTo(BigDecimal.ZERO) > 0").`);
        }
        if (uc.trigger.channel != null && typeof uc.trigger.channel !== 'string') {
          fail(`Use case "${uc.id}" trigger.channel must be a string (AsyncAPI channel name).`);
        }
      } else {
        // Non-event triggers must not declare event-only keys.
        for (const k of ['event', 'consumes', 'channel', 'fromBc', 'filter']) {
          if (uc.trigger[k] != null) {
            fail(`Use case "${uc.id}" trigger.kind="${uc.trigger.kind}" but declares "${k}". Event-only keys are: event/consumes, channel, fromBc, filter.`);
          }
        }
      }
    }
    if (uc.input != null) {
      if (!Array.isArray(uc.input)) {
        fail(`Use case "${uc.id}" "input" must be a list of input mappings.`);
      }
      for (const inp of uc.input) {
        if (!inp || typeof inp !== 'object' || Array.isArray(inp)) {
          fail(`Use case "${uc.id}" input[] contains a non-mapping entry.`);
        }
        for (const k of Object.keys(inp)) {
          if (!ALLOWED_UC_INPUT_KEYS.has(k)) {
            fail(`Use case "${uc.id}" input "${inp.name || '<unnamed>'}" declares unsupported attribute "${k}". Allowed: ${[...ALLOWED_UC_INPUT_KEYS].join(', ')}.`);
          }
        }
        if (!inp.name) fail(`Use case "${uc.id}" has an input without "name".`);
        if (!inp.type) fail(`Use case "${uc.id}" input "${inp.name}" is missing required field "type".`);
        if (!inp.source) fail(`Use case "${uc.id}" input "${inp.name}" is missing required field "source".`);
        if (!ALLOWED_UC_INPUT_SOURCES.has(inp.source)) {
          fail(`Use case "${uc.id}" input "${inp.name}" has unsupported source "${inp.source}". Allowed: ${[...ALLOWED_UC_INPUT_SOURCES].join(', ')}.`);
        }
        // [G11] source: header requires headerName
        if (inp.source === 'header' && (!inp.headerName || typeof inp.headerName !== 'string')) {
          fail(`Use case "${uc.id}" input "${inp.name}" declares source: header but is missing required "headerName" (e.g. "X-Tenant-Id").`);
        }
        if (inp.headerName != null && inp.source !== 'header') {
          fail(`Use case "${uc.id}" input "${inp.name}" declares "headerName" but its source is "${inp.source}". headerName is only valid for source: header.`);
        }
        // [G12] source: multipart cross-validation with type and sub-keys
        if (inp.source === 'multipart' && inp.type !== 'File') {
          fail(`Use case "${uc.id}" input "${inp.name}" declares source: multipart but type is "${inp.type}". Multipart inputs must use canonical type "File".`);
        }
        if (inp.type === 'File' && inp.source !== 'multipart') {
          fail(`Use case "${uc.id}" input "${inp.name}" has type "File" but source is "${inp.source}". File inputs must declare source: multipart.`);
        }
        for (const k of ['partName', 'maxSize', 'contentTypes']) {
          if (inp[k] != null && inp.source !== 'multipart') {
            fail(`Use case "${uc.id}" input "${inp.name}" declares "${k}" but its source is "${inp.source}". "${k}" is only valid for source: multipart.`);
          }
        }
        if (inp.source === 'multipart') {
          if (inp.partName != null && typeof inp.partName !== 'string') {
            fail(`Use case "${uc.id}" input "${inp.name}" "partName" must be a string (the multipart form-data part identifier).`);
          }
          if (inp.maxSize != null) {
            if (typeof inp.maxSize !== 'string' || !/^\d+(B|KB|MB|GB)$/.test(inp.maxSize)) {
              fail(`Use case "${uc.id}" input "${inp.name}" "maxSize" must be a size string like "10MB" (units: B, KB, MB, GB).`);
            }
          }
          if (inp.contentTypes != null) {
            if (!Array.isArray(inp.contentTypes) || inp.contentTypes.length === 0 || inp.contentTypes.some((c) => typeof c !== 'string')) {
              fail(`Use case "${uc.id}" input "${inp.name}" "contentTypes" must be a non-empty array of MIME-type strings (e.g. ["image/png", "image/jpeg"]).`);
            }
          }
        }
        // [G5] max only on numeric inputs
        if (inp.max != null) {
          if (typeof inp.max !== 'number' || !Number.isInteger(inp.max)) {
            fail(`Use case "${uc.id}" input "${inp.name}" "max" must be an integer.`);
          }
          if (!/^(Integer|Long|int|long|BigDecimal)$/.test(String(inp.type))) {
            fail(`Use case "${uc.id}" input "${inp.name}" declares "max" but type "${inp.type}" is not numeric. Allowed numeric types: Integer, Long, BigDecimal.`);
          }
        }
        // [G8] SearchText requires fields[] (which aggregate properties to search).
        if (inp.type === 'SearchText') {
          if (!Array.isArray(inp.fields) || inp.fields.length === 0
              || inp.fields.some((f) => typeof f !== 'string' || !f.trim())) {
            fail(`Use case "${uc.id}" input "${inp.name}" declares type: SearchText but is missing a non-empty "fields" list (the aggregate property names to LIKE-match).`);
          }
        }
        if (inp.fields != null && inp.type !== 'SearchText') {
          fail(`Use case "${uc.id}" input "${inp.name}" declares "fields" but type is "${inp.type}". "fields" is only valid for type: SearchText.`);
        }
      }
      // [G12] when any input is multipart, no other input may be source: body
      const inputs = uc.input;
      const hasMultipart = inputs.some((i) => i.source === 'multipart');
      if (hasMultipart && inputs.some((i) => i.source === 'body')) {
        fail(`Use case "${uc.id}" mixes source: multipart with source: body. When uploading a file, send any additional fields via path/query/header — Spring's @RequestPart and @RequestBody cannot share the same request.`);
      }
    }
    // [G12] returns: BinaryStream is only valid for queries
    if (uc.returns === 'BinaryStream' && uc.type !== 'query') {
      fail(`Use case "${uc.id}" declares returns: BinaryStream but type is "${uc.type}". Binary downloads must be queries.`);
    }
    // [G7] pagination structure validation
    if (uc.pagination != null) {
      if (typeof uc.pagination !== 'object' || Array.isArray(uc.pagination)) {
        fail(`Use case "${uc.id}" "pagination" must be a mapping with keys: ${[...ALLOWED_UC_PAGINATION_KEYS].join(', ')}.`);
      }
      for (const k of Object.keys(uc.pagination)) {
        if (!ALLOWED_UC_PAGINATION_KEYS.has(k)) {
          fail(`Use case "${uc.id}" pagination declares unsupported key "${k}". Allowed: ${[...ALLOWED_UC_PAGINATION_KEYS].join(', ')}.`);
        }
      }
      const p = uc.pagination;
      if (p.defaultSize != null && (!Number.isInteger(p.defaultSize) || p.defaultSize <= 0)) {
        fail(`Use case "${uc.id}" pagination.defaultSize must be a positive integer.`);
      }
      if (p.maxSize != null && (!Number.isInteger(p.maxSize) || p.maxSize <= 0)) {
        fail(`Use case "${uc.id}" pagination.maxSize must be a positive integer.`);
      }
      if (p.sortable != null && (!Array.isArray(p.sortable) || p.sortable.some((s) => typeof s !== 'string'))) {
        fail(`Use case "${uc.id}" pagination.sortable must be an array of field-name strings.`);
      }
      if (p.defaultSort != null) {
        if (typeof p.defaultSort !== 'object' || Array.isArray(p.defaultSort)) {
          fail(`Use case "${uc.id}" pagination.defaultSort must be a mapping with keys: ${[...ALLOWED_UC_DEFAULT_SORT_KEYS].join(', ')}.`);
        }
        for (const k of Object.keys(p.defaultSort)) {
          if (!ALLOWED_UC_DEFAULT_SORT_KEYS.has(k)) {
            fail(`Use case "${uc.id}" pagination.defaultSort declares unsupported key "${k}". Allowed: ${[...ALLOWED_UC_DEFAULT_SORT_KEYS].join(', ')}.`);
          }
        }
        if (!p.defaultSort.field || typeof p.defaultSort.field !== 'string') {
          fail(`Use case "${uc.id}" pagination.defaultSort.field is required and must be a string.`);
        }
        if (p.defaultSort.direction != null && !ALLOWED_UC_SORT_DIRECTIONS.has(p.defaultSort.direction)) {
          fail(`Use case "${uc.id}" pagination.defaultSort.direction "${p.defaultSort.direction}" is not supported. Allowed: ${[...ALLOWED_UC_SORT_DIRECTIONS].join(', ')}.`);
        }
        if (p.sortable && !p.sortable.includes(p.defaultSort.field)) {
          fail(`Use case "${uc.id}" pagination.defaultSort.field "${p.defaultSort.field}" must be present in pagination.sortable[].`);
        }
      }
    }
    // [G3] authorization structure validation
    if (uc.authorization != null) {
      if (typeof uc.authorization !== 'object' || Array.isArray(uc.authorization)) {
        fail(`Use case "${uc.id}" "authorization" must be a mapping with keys: ${[...ALLOWED_UC_AUTHZ_KEYS].join(', ')}.`);
      }
      for (const k of Object.keys(uc.authorization)) {
        if (!ALLOWED_UC_AUTHZ_KEYS.has(k)) {
          fail(`Use case "${uc.id}" authorization declares unsupported key "${k}". Allowed: ${[...ALLOWED_UC_AUTHZ_KEYS].join(', ')}.`);
        }
      }
      const a = uc.authorization;
      if (a.rolesAnyOf != null) {
        if (!Array.isArray(a.rolesAnyOf) || a.rolesAnyOf.length === 0 || a.rolesAnyOf.some((r) => typeof r !== 'string' || !r.trim())) {
          fail(`Use case "${uc.id}" authorization.rolesAnyOf must be a non-empty array of role-name strings.`);
        }
      }
      if (a.ownership != null) {
        if (typeof a.ownership !== 'object' || Array.isArray(a.ownership)) {
          fail(`Use case "${uc.id}" authorization.ownership must be a mapping with keys: ${[...ALLOWED_UC_OWNERSHIP_KEYS].join(', ')}.`);
        }
        for (const k of Object.keys(a.ownership)) {
          if (!ALLOWED_UC_OWNERSHIP_KEYS.has(k)) {
            fail(`Use case "${uc.id}" authorization.ownership declares unsupported key "${k}". Allowed: ${[...ALLOWED_UC_OWNERSHIP_KEYS].join(', ')}.`);
          }
        }
        if (!a.ownership.field || typeof a.ownership.field !== 'string') {
          fail(`Use case "${uc.id}" authorization.ownership.field is required and must be a string (aggregate property name to compare against the caller).`);
        }
        if (!a.ownership.claim || typeof a.ownership.claim !== 'string') {
          fail(`Use case "${uc.id}" authorization.ownership.claim is required and must be a string (JWT claim name, e.g. "userId").`);
        }
        if (a.ownership.allowRoleBypass != null) {
          if (!Array.isArray(a.ownership.allowRoleBypass) || a.ownership.allowRoleBypass.some((r) => typeof r !== 'string' || !r.trim())) {
            fail(`Use case "${uc.id}" authorization.ownership.allowRoleBypass must be an array of role-name strings.`);
          }
        }
      }
    }
    // [G2] idempotency structure validation
    if (uc.idempotency != null) {
      if (typeof uc.idempotency !== 'object' || Array.isArray(uc.idempotency)) {
        fail(`Use case "${uc.id}" "idempotency" must be a mapping with keys: ${[...ALLOWED_UC_IDEMPOTENCY_KEYS].join(', ')}.`);
      }
      for (const k of Object.keys(uc.idempotency)) {
        if (!ALLOWED_UC_IDEMPOTENCY_KEYS.has(k)) {
          fail(`Use case "${uc.id}" idempotency declares unsupported key "${k}". Allowed: ${[...ALLOWED_UC_IDEMPOTENCY_KEYS].join(', ')}.`);
        }
      }
      const idem = uc.idempotency;
      if (!idem.header || typeof idem.header !== 'string') {
        fail(`Use case "${uc.id}" idempotency.header is required and must be a string (HTTP header name, e.g. "Idempotency-Key").`);
      }
      if (!idem.ttl || typeof idem.ttl !== 'string' || !/^P/.test(idem.ttl)) {
        fail(`Use case "${uc.id}" idempotency.ttl is required and must be an ISO-8601 duration (e.g. "PT24H", "P1D").`);
      }
      if (!idem.storage || !ALLOWED_UC_IDEMPOTENCY_STORAGES.has(idem.storage)) {
        fail(`Use case "${uc.id}" idempotency.storage is required. Allowed: ${[...ALLOWED_UC_IDEMPOTENCY_STORAGES].join(', ')}.`);
      }
      if (uc.type !== 'command') {
        fail(`Use case "${uc.id}" declares idempotency but type is "${uc.type}". Idempotency is only supported on commands.`);
      }
    }
    // [G9] bulk structure validation
    if (uc.bulk != null) {
      if (typeof uc.bulk !== 'object' || Array.isArray(uc.bulk)) {
        fail(`Use case "${uc.id}" "bulk" must be a mapping with keys: ${[...ALLOWED_UC_BULK_KEYS].join(', ')}.`);
      }
      for (const k of Object.keys(uc.bulk)) {
        if (!ALLOWED_UC_BULK_KEYS.has(k)) {
          fail(`Use case "${uc.id}" bulk declares unsupported key "${k}". Allowed: ${[...ALLOWED_UC_BULK_KEYS].join(', ')}.`);
        }
      }
      const b = uc.bulk;
      if (!b.itemType || typeof b.itemType !== 'string') {
        fail(`Use case "${uc.id}" bulk.itemType is required and must be the name of an existing command (e.g. "CreateProduct"). The bulk handler will dispatch one item command per element.`);
      }
      if (b.maxItems != null && (!Number.isInteger(b.maxItems) || b.maxItems <= 0)) {
        fail(`Use case "${uc.id}" bulk.maxItems must be a positive integer.`);
      }
      if (b.onItemError != null && !ALLOWED_UC_BULK_ON_ITEM_ERROR.has(b.onItemError)) {
        fail(`Use case "${uc.id}" bulk.onItemError "${b.onItemError}" is not supported. Allowed: ${[...ALLOWED_UC_BULK_ON_ITEM_ERROR].join(', ')}.`);
      }
      if (uc.type !== 'command') {
        fail(`Use case "${uc.id}" declares bulk but type is "${uc.type}". Bulk wrappers are only supported on commands.`);
      }
      if (uc.input != null && Array.isArray(uc.input) && uc.input.length > 0) {
        fail(`Use case "${uc.id}" declares both bulk and input[]. Bulk use cases are pure wrappers — the only payload is the items list.`);
      }
    }
    // [G10] async structure validation
    if (uc.async != null) {
      if (typeof uc.async !== 'object' || Array.isArray(uc.async)) {
        fail(`Use case "${uc.id}" "async" must be a mapping with keys: ${[...ALLOWED_UC_ASYNC_KEYS].join(', ')}.`);
      }
      for (const k of Object.keys(uc.async)) {
        if (!ALLOWED_UC_ASYNC_KEYS.has(k)) {
          fail(`Use case "${uc.id}" async declares unsupported key "${k}". Allowed: ${[...ALLOWED_UC_ASYNC_KEYS].join(', ')}.`);
        }
      }
      const a = uc.async;
      if (!a.mode || !ALLOWED_UC_ASYNC_MODES.has(a.mode)) {
        fail(`Use case "${uc.id}" async.mode is required. Allowed: ${[...ALLOWED_UC_ASYNC_MODES].join(', ')}.`);
      }
      if (a.statusEndpoint != null && typeof a.statusEndpoint !== 'string') {
        fail(`Use case "${uc.id}" async.statusEndpoint must be a string (operationId of the status query endpoint).`);
      }
      if (uc.type !== 'command') {
        fail(`Use case "${uc.id}" declares async but type is "${uc.type}". async is only supported on commands.`);
      }
      if (uc.bulk) {
        fail(`Use case "${uc.id}" declares both async and bulk. These wrappers are mutually exclusive.`);
      }
    }
    // [G6] multi-aggregate same-BC saga structure validation
    if (uc.aggregates != null || uc.steps != null) {
      if (!Array.isArray(uc.aggregates) || uc.aggregates.length < 2) {
        fail(`Use case "${uc.id}" declares "aggregates" but it must be a list of at least 2 aggregate names. For single-aggregate use cases, use "aggregate" (singular) + "method".`);
      }
      for (const a of uc.aggregates) {
        if (typeof a !== 'string' || !a.trim()) {
          fail(`Use case "${uc.id}" aggregates[] contains a non-string entry. Each entry must be the name of an aggregate declared in this BC.`);
        }
      }
      if (uc.aggregate || uc.method) {
        fail(`Use case "${uc.id}" declares both "aggregates" and "aggregate"/"method". These are mutually exclusive — multi-aggregate UCs declare steps[] instead.`);
      }
      if (uc.type !== 'command') {
        fail(`Use case "${uc.id}" declares "aggregates" but type is "${uc.type}". Multi-aggregate orchestration is only supported on commands (queries do not span aggregates in this DSL).`);
      }
      if (uc.bulk) {
        fail(`Use case "${uc.id}" declares both "aggregates" and "bulk". These wrappers are mutually exclusive.`);
      }
      if (uc.async) {
        fail(`Use case "${uc.id}" declares both "aggregates" and "async". These wrappers are mutually exclusive.`);
      }
      if (!Array.isArray(uc.steps) || uc.steps.length === 0) {
        fail(`Use case "${uc.id}" declares "aggregates" so "steps" is required and must be a non-empty list of { aggregate, method, onFailure? } entries.`);
      }
      const declaredAggSet = new Set(uc.aggregates);
      for (const step of uc.steps) {
        if (!step || typeof step !== 'object' || Array.isArray(step)) {
          fail(`Use case "${uc.id}" steps[] contains a non-mapping entry.`);
        }
        for (const k of Object.keys(step)) {
          if (!ALLOWED_UC_STEP_KEYS.has(k)) {
            fail(`Use case "${uc.id}" step declares unsupported key "${k}". Allowed: ${[...ALLOWED_UC_STEP_KEYS].join(', ')}.`);
          }
        }
        if (!step.aggregate || typeof step.aggregate !== 'string') {
          fail(`Use case "${uc.id}" step is missing required "aggregate" (must be one of: ${[...declaredAggSet].join(', ')}).`);
        }
        if (!declaredAggSet.has(step.aggregate)) {
          fail(`Use case "${uc.id}" step references aggregate "${step.aggregate}" which is not declared in this UC's aggregates list (${[...declaredAggSet].join(', ')}).`);
        }
        if (!step.method || typeof step.method !== 'string') {
          fail(`Use case "${uc.id}" step on aggregate "${step.aggregate}" is missing required "method".`);
        }
        if (step.onFailure != null) {
          if (typeof step.onFailure !== 'object' || Array.isArray(step.onFailure)) {
            fail(`Use case "${uc.id}" step.onFailure must be a mapping with keys: ${[...ALLOWED_UC_ON_FAILURE_KEYS].join(', ')}.`);
          }
          for (const k of Object.keys(step.onFailure)) {
            if (!ALLOWED_UC_ON_FAILURE_KEYS.has(k)) {
              fail(`Use case "${uc.id}" step.onFailure declares unsupported key "${k}". Allowed: ${[...ALLOWED_UC_ON_FAILURE_KEYS].join(', ')}.`);
            }
          }
          const comp = step.onFailure.compensate;
          if (comp == null) {
            fail(`Use case "${uc.id}" step.onFailure declares no "compensate". Either remove onFailure or declare onFailure.compensate: { aggregate, method }.`);
          }
          if (typeof comp !== 'object' || Array.isArray(comp)) {
            fail(`Use case "${uc.id}" step.onFailure.compensate must be a mapping with keys: ${[...ALLOWED_UC_COMPENSATE_KEYS].join(', ')}.`);
          }
          for (const k of Object.keys(comp)) {
            if (!ALLOWED_UC_COMPENSATE_KEYS.has(k)) {
              fail(`Use case "${uc.id}" step.onFailure.compensate declares unsupported key "${k}". Allowed: ${[...ALLOWED_UC_COMPENSATE_KEYS].join(', ')}.`);
            }
          }
          if (!comp.aggregate || !declaredAggSet.has(comp.aggregate)) {
            fail(`Use case "${uc.id}" step.onFailure.compensate.aggregate "${comp.aggregate || ''}" must be one of this UC's declared aggregates (${[...declaredAggSet].join(', ')}).`);
          }
          if (!comp.method || typeof comp.method !== 'string') {
            fail(`Use case "${uc.id}" step.onFailure.compensate is missing required "method".`);
          }
        }
      }
    }
    if (uc.fkValidations != null) {
      if (!Array.isArray(uc.fkValidations)) {
        fail(`Use case "${uc.id}" "fkValidations" must be a list.`);
      }
      for (const fk of uc.fkValidations) {
        if (!fk || typeof fk !== 'object' || Array.isArray(fk)) {
          fail(`Use case "${uc.id}" fkValidations[] contains a non-mapping entry.`);
        }
        for (const k of Object.keys(fk)) {
          if (!ALLOWED_UC_FK_KEYS.has(k)) {
            fail(`Use case "${uc.id}" fkValidation declares unsupported attribute "${k}". Allowed: ${[...ALLOWED_UC_FK_KEYS].join(', ')}.`);
          }
        }
      }
    }
    // [G20] cross-field validations (declarative guards)
    if (uc.validations != null) {
      if (!Array.isArray(uc.validations)) {
        fail(`Use case "${uc.id}" "validations" must be a list.`);
      }
      const seenValIds = new Set();
      for (const v of uc.validations) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) {
          fail(`Use case "${uc.id}" validations[] contains a non-mapping entry.`);
        }
        for (const k of Object.keys(v)) {
          if (!ALLOWED_UC_VALIDATION_KEYS.has(k)) {
            fail(`Use case "${uc.id}" validation declares unsupported attribute "${k}". Allowed: ${[...ALLOWED_UC_VALIDATION_KEYS].join(', ')}.`);
          }
        }
        if (!v.id || typeof v.id !== 'string') {
          fail(`Use case "${uc.id}" validations[] entry is missing required string "id".`);
        }
        if (seenValIds.has(v.id)) {
          fail(`Use case "${uc.id}" validations[] declares duplicate id "${v.id}".`);
        }
        seenValIds.add(v.id);
        if (!v.expression || typeof v.expression !== 'string') {
          fail(`Use case "${uc.id}" validation "${v.id}" is missing required string "expression".`);
        }
        if (!v.errorCode || typeof v.errorCode !== 'string') {
          fail(`Use case "${uc.id}" validation "${v.id}" is missing required string "errorCode".`);
        }
      }
    }
    // [G14] actor cross-validation (only when system.yaml declares actors[])
    if (systemActors && uc.actor && !systemActors.has(uc.actor)) {
      fail(`Use case "${uc.id}" actor "${uc.actor}" is not declared in system.yaml#/actors. Declare it there or fix the typo.`);
    }
  }

  // [G9] bulk.itemType cross-validation: must reference another command UC in the same BC.
  const ucNames = new Set(useCases.map((u) => u.name));
  for (const uc of useCases) {
    if (uc.bulk && uc.bulk.itemType && !ucNames.has(uc.bulk.itemType)) {
      fail(`Use case "${uc.id}" bulk.itemType "${uc.bulk.itemType}" does not match any use case name in this BC. Declare the item-level command first.`);
    }
    if (uc.bulk && uc.bulk.itemType) {
      const item = useCases.find((u) => u.name === uc.bulk.itemType);
      if (item && item.type !== 'command') {
        fail(`Use case "${uc.id}" bulk.itemType "${uc.bulk.itemType}" must reference a use case of type: command (found type: ${item.type}).`);
      }
      if (item && item.bulk) {
        fail(`Use case "${uc.id}" bulk.itemType "${uc.bulk.itemType}" must not itself be a bulk wrapper.`);
      }
    }
  }

  const errors = doc.errors || [];
  assertUnique(errors, (e) => e.code, 'error code');

  // ── errors[] schema (whitelist + httpStatus enum) ──────────────────────
  // [G18 cont.] strict whitelist on errors[] keys; httpStatus must be one
  // of the values supported by HandlerExceptions (otherwise the generated
  // error class would silently default to BusinessException → 422).
  const ALLOWED_ERROR_KEYS = new Set([
    'code', 'httpStatus', 'description', 'message', 'title',
  ]);
  const ALLOWED_HTTP_STATUSES = new Set([400, 401, 403, 404, 409, 422]);
  for (const err of errors) {
    if (!err || typeof err !== 'object' || Array.isArray(err)) {
      fail(`errors[] contains a non-mapping entry; each error must be an object with at least "code".`);
    }
    for (const key of Object.keys(err)) {
      if (!ALLOWED_ERROR_KEYS.has(key)) {
        fail(`Error "${err.code || '<unnamed>'}" declares unsupported attribute "${key}". Allowed keys: ${[...ALLOWED_ERROR_KEYS].join(', ')}.`);
      }
    }
    if (!err.code) fail(`An errors[] entry is missing required field "code".`);
    if (err.httpStatus != null && !ALLOWED_HTTP_STATUSES.has(err.httpStatus)) {
      fail(`Error "${err.code}" has unsupported httpStatus "${err.httpStatus}". Allowed: ${[...ALLOWED_HTTP_STATUSES].join(', ')}.`);
    }
  }

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

    // [G20] validations[].errorCode must exist in errors[]
    for (const v of uc.validations || []) {
      if (v.errorCode && !allErrorCodes.has(v.errorCode)) {
        fail(`Use case "${uc.id}" validation "${v.id}" errorCode "${v.errorCode}" not found in errors[].`);
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

  // [G15] event-triggered UCs: the consumed event must be declared in
  // domainEvents.consumed[] (cross-BC) or domainEvents.published[] (same-BC,
  // self-consumption — rare but legal). Ensures schema-time detection of
  // typos and missing event declarations.
  const publishedEventNames = new Set(((doc.domainEvents || {}).published || []).map((e) => e.name));
  const consumedEventNames = new Set(((doc.domainEvents || {}).consumed || []).map((e) => e.name));
  for (const uc of useCases) {
    if (!uc.trigger || uc.trigger.kind !== 'event') continue;
    const evName = uc.trigger.event;
    if (!evName) continue; // already validated above
    if (!publishedEventNames.has(evName) && !consumedEventNames.has(evName)) {
      fail(`Use case "${uc.id}" trigger.kind: event references "${evName}" which is not declared in domainEvents.consumed[] (cross-BC) nor domainEvents.published[] (same-BC self-consumption). Add the event to one of those lists or fix the typo.`);
    }
  }

  // [G8] SearchText.fields[] must reference real aggregate properties.
  // The Specification builder LIKE-matches each field, so unknown names would
  // produce non-compiling code. We resolve against uc.aggregate (or the first
  // entry of uc.aggregates for multi-aggregate UCs).
  for (const uc of useCases) {
    if (!Array.isArray(uc.input)) continue;
    const aggName = uc.aggregate || (Array.isArray(uc.aggregates) ? uc.aggregates[0] : null);
    if (!aggName) continue;
    const agg = aggByName.get(aggName);
    if (!agg) continue;
    const propNames = new Set((agg.properties || []).map((p) => p.name));
    for (const inp of uc.input) {
      if (inp.type !== 'SearchText' || !Array.isArray(inp.fields)) continue;
      for (const fieldName of inp.fields) {
        if (!propNames.has(fieldName)) {
          fail(`Use case "${uc.id}" input "${inp.name}" SearchText.fields references "${fieldName}" which is not declared as a property on aggregate "${agg.name}".`);
        }
      }
    }
  }

  // [G6] multi-aggregate UCs: each aggregate must exist; each step.method (and
  // onFailure.compensate.method) must be declared on the corresponding aggregate
  // domainMethods. After validation, alias uc.aggregate = uc.aggregates[0] so
  // existing controller/application grouping (which is per-aggregate) routes
  // the endpoint to the first aggregate's controller.
  for (const uc of useCases) {
    if (!Array.isArray(uc.aggregates) || uc.aggregates.length < 2) continue;
    for (const aggName of uc.aggregates) {
      if (!aggByName.has(aggName)) {
        fail(`Use case "${uc.id}" references aggregate "${aggName}" in aggregates[] which is not declared in this BC. Multi-aggregate orchestration is restricted to aggregates of the same bounded context — use system.yaml#/sagas for cross-BC.`);
      }
    }
    for (const step of (uc.steps || [])) {
      const agg = aggByName.get(step.aggregate);
      const dm = (agg.domainMethods || []).find((m) => m.name === step.method);
      if (!dm) {
        fail(`Use case "${uc.id}" step references method "${step.method}" which is not declared in aggregate "${agg.name}" domainMethods.`);
      }
      if (step.onFailure && step.onFailure.compensate) {
        const compAgg = aggByName.get(step.onFailure.compensate.aggregate);
        const compDm = (compAgg.domainMethods || []).find((m) => m.name === step.onFailure.compensate.method);
        if (!compDm) {
          fail(`Use case "${uc.id}" step.onFailure.compensate references method "${step.onFailure.compensate.method}" which is not declared in aggregate "${compAgg.name}" domainMethods.`);
        }
      }
    }
    // Alias: route the endpoint to the first declared aggregate's controller.
    uc.aggregate = uc.aggregates[0];
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

/**
 * [G24] Normalize the `Void` keyword in `useCases[].returns` to a missing
 * value (null). `Void` is the explicit form of "this UC produces no body";
 * downstream generators already treat a missing `returns` as void. This
 * collapses the two forms early so no generator/template has to special-case
 * the literal string `"Void"`.
 *
 * The capitalised `Optional[X]` form is left untouched: it has different
 * semantics (handler returns `Optional<X>`, controller returns
 * `ResponseEntity<X>` mapping `200`/`404`) and is handled in the application
 * and controller generators.
 */
function normalizeVoidReturns(doc) {
  if (!Array.isArray(doc.useCases)) return;
  for (const uc of doc.useCases) {
    if (typeof uc.returns === 'string' && uc.returns.trim() === 'Void') {
      uc.returns = null;
    }
  }
}

/**
 * [G9] When a use case declares `bulk:`, its return type is fixed to the shared
 * `BulkResult` record. Set `uc.returns` here so downstream generators (controller,
 * application) treat it consistently, and reject contradictory declarations.
 */
function normalizeBulkReturns(doc) {
  if (!Array.isArray(doc.useCases)) return;
  for (const uc of doc.useCases) {
    if (uc.bulk) {
      if (uc.returns && uc.returns !== 'BulkResult') {
        fail(`Use case "${uc.id}" declares bulk and returns: "${uc.returns}". Bulk wrappers always return BulkResult — remove the explicit returns key.`);
      }
      uc.returns = 'BulkResult';
    }
  }
}

/**
 * [G10] When a use case declares `async: { mode: jobTracking }`, the handler
 * returns a `JobReference` record (UUID jobId). For `fireAndForget` the handler
 * returns void. Set `uc.returns` accordingly and reject contradictory declarations.
 */
function normalizeAsyncReturns(doc) {
  if (!Array.isArray(doc.useCases)) return;
  for (const uc of doc.useCases) {
    if (!uc.async) continue;
    if (uc.async.mode === 'jobTracking') {
      if (uc.returns && uc.returns !== 'JobReference') {
        fail(`Use case "${uc.id}" declares async.mode=jobTracking and returns: "${uc.returns}". Job-tracking commands always return JobReference — remove the explicit returns key.`);
      }
      uc.returns = 'JobReference';
    } else if (uc.async.mode === 'fireAndForget') {
      if (uc.returns) {
        fail(`Use case "${uc.id}" declares async.mode=fireAndForget and returns: "${uc.returns}". Fire-and-forget commands cannot return a value — remove the returns key.`);
      }
    }
  }
}

async function readBcYaml(bcName, opts = {}) {
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
  normalizeVoidReturns(doc);

  validate(doc, opts);

  // [G9] Bulk UCs always return BulkResult — set after validate() has
  // confirmed the bulk block is well-formed.
  normalizeBulkReturns(doc);

  // [G10] Async UCs return JobReference (jobTracking) or void (fireAndForget).
  normalizeAsyncReturns(doc);

  return doc;
}

module.exports = { readBcYaml };
