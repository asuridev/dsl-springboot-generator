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
 * Validate all properties of an aggregate / entity for prohibited types,
 * Decimal precision/scale rules, and readOnly+defaultValue type compatibility.
 *
 * @param {Array}  properties - the properties[] array from the YAML
 * @param {string} context    - human-readable location for error messages
 * @param {Array}  enums      - doc.enums array for enum value validation
 */
function validateProperties(properties, context, enums = []) {
  if (!Array.isArray(properties)) return;
  const enumNames = new Set((enums || []).map((e) => e.name));
  for (const prop of properties) {
    resolveType(prop.type);

    if (prop.type === 'Decimal') {
      if (prop.precision == null || prop.scale == null) {
        fail(`Property "${prop.name}" in ${context} has type Decimal but is missing "precision" and/or "scale".`);
      }
    }

    if (prop.readOnly === true && prop.defaultValue != null) {
      const dv = prop.defaultValue;
      const typeBase = (prop.type || '').replace(/\(\d+(?:,\s*\d+)?\)$/, '').trim();
      if (typeBase === 'Uuid') {
        if (dv !== 'generated') {
          fail(`Property "${prop.name}" in ${context}: readOnly Uuid must have defaultValue: generated.`);
        }
      } else if (typeBase === 'DateTime') {
        if (dv !== 'now()') {
          fail(`Property "${prop.name}" in ${context}: readOnly DateTime must have defaultValue: now().`);
        }
      } else if (typeBase === 'Integer' || typeBase === 'Long') {
        if (isNaN(Number(dv))) {
          fail(`Property "${prop.name}" in ${context}: readOnly Integer/Long defaultValue must be numeric, got "${dv}".`);
        }
      } else if (typeBase === 'Decimal') {
        if (isNaN(Number(dv))) {
          fail(`Property "${prop.name}" in ${context}: readOnly Decimal defaultValue must be numeric, got "${dv}".`);
        }
      } else if (typeBase === 'Boolean') {
        if (dv !== true && dv !== false && dv !== 'true' && dv !== 'false') {
          fail(`Property "${prop.name}" in ${context}: readOnly Boolean defaultValue must be true or false, got "${dv}".`);
        }
      } else if (enumNames.has(typeBase)) {
        const enumDef = (enums || []).find((e) => e.name === typeBase);
        const validValues = (enumDef?.values || []).map((v) => (typeof v === 'object' ? v.value : v));
        if (!validValues.includes(dv)) {
          fail(`Property "${prop.name}" in ${context}: defaultValue "${dv}" is not a valid value of enum ${typeBase}. Valid values: ${validValues.join(', ')}.`);
        }
      }
      // String, String(n) — any value accepted
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
    // [Phase 3, Gap E8] declarative multi-lookup; supersedes notFoundError
    'lookups',
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
  // [Phase 3, Gap E8] lookups[] keys.
  const ALLOWED_UC_LOOKUP_KEYS = new Set([
    'param', 'aggregate', 'errorCode', 'nestedIn', 'description',
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
    // [Phase 3, Gap E8] lookups[] — declarative multi-lookup. Supersedes the
    // single-entry `notFoundError`. Each entry binds an input param to an
    // aggregate (or a nested entity collection via `nestedIn`) and the error
    // to throw when the row is missing. The generator currently emits the
    // primary lookup (param matching loadAggregate input) as a real
    // findById.orElseThrow; additional lookups become enriched TODOs that
    // nominate the error class for Phase 3 humans.
    if (uc.lookups != null) {
      if (!Array.isArray(uc.lookups)) {
        fail(`Use case "${uc.id}" "lookups" must be a list.`);
      }
      if (uc.notFoundError != null) {
        fail(`Use case "${uc.id}" declares both "lookups" and "notFoundError". Use "lookups" exclusively (notFoundError is preserved as a deprecated alias for backward compatibility).`);
      }
      const seenLookupParams = new Set();
      for (const lk of uc.lookups) {
        if (!lk || typeof lk !== 'object' || Array.isArray(lk)) {
          fail(`Use case "${uc.id}" lookups[] contains a non-mapping entry.`);
        }
        for (const k of Object.keys(lk)) {
          if (!ALLOWED_UC_LOOKUP_KEYS.has(k)) {
            fail(`Use case "${uc.id}" lookup declares unsupported attribute "${k}". Allowed: ${[...ALLOWED_UC_LOOKUP_KEYS].join(', ')}.`);
          }
        }
        if (!lk.param || typeof lk.param !== 'string') {
          fail(`Use case "${uc.id}" lookups[] entry is missing required string "param".`);
        }
        if (!lk.errorCode || typeof lk.errorCode !== 'string') {
          fail(`Use case "${uc.id}" lookup on "${lk.param}" is missing required string "errorCode".`);
        }
        if (!lk.aggregate && !lk.nestedIn) {
          fail(`Use case "${uc.id}" lookup on "${lk.param}" must declare either "aggregate" or "nestedIn".`);
        }
        if (lk.nestedIn && typeof lk.nestedIn === 'string' && !/^[A-Z][A-Za-z0-9_]*\.[a-z][A-Za-z0-9_]*$/.test(lk.nestedIn)) {
          fail(`Use case "${uc.id}" lookup on "${lk.param}": "nestedIn" must be of the form "<Aggregate>.<collectionField>" (got "${lk.nestedIn}").`);
        }
        if (seenLookupParams.has(lk.param)) {
          fail(`Use case "${uc.id}" lookups[] declares duplicate param "${lk.param}".`);
        }
        seenLookupParams.add(lk.param);
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
    // Phase 1 — naming override, cause-chaining, and orphan-suppression
    'errorType', 'chainable', 'usedFor',
    // Phase 2 — parametrized message template + typed args
    'messageTemplate', 'args',
    // Phase 4 — taxonomy (business|infrastructure) + infra mapping hint
    'kind', 'triggeredBy',
  ]);
  const ALLOWED_ERROR_USED_FOR = new Set(['auto', 'manual']);
  const ALLOWED_ERROR_KIND = new Set(['business', 'infrastructure']);
  // Phase 2 — expanded set; new statuses (402, 408, 412, 415, 423, 429, 503, 504)
  // are routed by application-generator.js to DomainException subclasses caught
  // by the generic ResponseEntity handler in HandlerExceptions (dynamic status).
  const ALLOWED_HTTP_STATUSES = new Set([
    400, 401, 402, 403, 404, 408, 409, 412, 415, 422, 423, 429, 503, 504,
  ]);
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
    if (err.errorType != null) {
      if (typeof err.errorType !== 'string' || !/^[A-Z][A-Za-z0-9_]*$/.test(err.errorType)) {
        fail(`Error "${err.code}" has invalid "errorType" "${err.errorType}". Must be a PascalCase Java identifier.`);
      }
    }
    if (err.chainable != null && typeof err.chainable !== 'boolean') {
      fail(`Error "${err.code}" has invalid "chainable" "${err.chainable}". Must be a boolean.`);
    }
    if (err.usedFor != null && !ALLOWED_ERROR_USED_FOR.has(err.usedFor)) {
      fail(`Error "${err.code}" has invalid "usedFor" "${err.usedFor}". Allowed: ${[...ALLOWED_ERROR_USED_FOR].join(', ')}.`);
    }
    if (err.messageTemplate != null && typeof err.messageTemplate !== 'string') {
      fail(`Error "${err.code}" has invalid "messageTemplate" — must be a string.`);
    }
    if (err.args != null) {
      if (!Array.isArray(err.args)) {
        fail(`Error "${err.code}" has invalid "args" — must be a list of {name, type} objects.`);
      }
      const argNames = new Set();
      for (const a of err.args) {
        if (!a || typeof a !== 'object' || !a.name || !a.type) {
          fail(`Error "${err.code}" has an "args" entry missing required "name" and/or "type".`);
        }
        if (!/^[a-z][A-Za-z0-9_]*$/.test(a.name)) {
          fail(`Error "${err.code}" has invalid arg name "${a.name}". Must be a camelCase Java identifier.`);
        }
        if (argNames.has(a.name)) {
          fail(`Error "${err.code}" declares duplicate arg "${a.name}".`);
        }
        argNames.add(a.name);
        if (typeof a.type !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.<>,\s]*$/.test(a.type)) {
          fail(`Error "${err.code}" has invalid arg type "${a.type}" for "${a.name}".`);
        }
      }
      if (err.args.length > 0 && !err.messageTemplate) {
        fail(`Error "${err.code}" declares "args" but no "messageTemplate". Provide a messageTemplate that references the args (e.g. "{${err.args[0].name}}").`);
      }
    }
    // [Phase 4 — Gap E5] Error taxonomy + infrastructure mapping
    if (err.kind != null && !ALLOWED_ERROR_KIND.has(err.kind)) {
      fail(`Error "${err.code}" has invalid "kind" "${err.kind}". Allowed: ${[...ALLOWED_ERROR_KIND].join(', ')}.`);
    }
    if (err.triggeredBy != null) {
      if (typeof err.triggeredBy !== 'string' || !/^([A-Za-z_][A-Za-z0-9_]*\.)*[A-Z][A-Za-z0-9_]*$/.test(err.triggeredBy)) {
        fail(`Error "${err.code}" has invalid "triggeredBy" "${err.triggeredBy}". Must be a Java class name, optionally fully-qualified (e.g. "DataAccessException" or "org.springframework.dao.DataAccessException").`);
      }
      if (err.kind !== 'infrastructure') {
        fail(`Error "${err.code}" declares "triggeredBy" but "kind" is not "infrastructure". Set kind: infrastructure or remove triggeredBy.`);
      }
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
    // [Phase 3, Gap E6] uniqueness only — DB-level constraint name used to
    // translate DataIntegrityViolationException into the declared errorCode.
    'constraintName',
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
      // Phase 3: when type=uniqueness, the optional `field` hint must reference
      // a real property of the aggregate root OR any of its child entities.
      // With it, the generator can emit an executable guard in the command handler.
      // Without it, the rule still validates and an enriched TODO is emitted.
      if (rule.type === 'uniqueness' && rule.field) {
        const rootPropNames = (agg.properties || []).map((p) => p.name);
        const entityPropNames = (agg.entities || []).flatMap((e) => (e.properties || []).map((p) => p.name));
        const allPropNames = [...new Set([...rootPropNames, ...entityPropNames])];
        if (!allPropNames.includes(rule.field)) {
          fail(`domainRule "${rule.id}" (uniqueness): "field" "${rule.field}" does not match any property of aggregate "${agg.name}" (root or child entities). Allowed: ${allPropNames.join(', ')}.`);
        }
      }
      // [Phase 3, Gap E6] constraintName is only meaningful for uniqueness.
      if (rule.constraintName != null) {
        if (rule.type !== 'uniqueness') {
          fail(`domainRule "${rule.id}": "constraintName" is only allowed for type "uniqueness" (got "${rule.type}").`);
        }
        if (typeof rule.constraintName !== 'string' || !/^[a-z][a-z0-9_]*$/.test(rule.constraintName)) {
          fail(`domainRule "${rule.id}": "constraintName" must be a snake_case identifier (e.g. "uk_category_name"); got "${rule.constraintName}".`);
        }
        if (!rule.field) {
          fail(`domainRule "${rule.id}": "constraintName" requires "field" to be declared so the JPA unique constraint targets the correct column.`);
        }
      }
      if (allRuleIds.has(rule.id)) fail(`Duplicate domainRule id: "${rule.id}"`);
      allRuleIds.add(rule.id);
    }
    // Validate properties
    validateProperties(agg.properties, `aggregate ${agg.name}`, doc.enums);
    for (const entity of agg.entities || []) {
      validateProperties(entity.properties, `entity ${entity.name}`, doc.enums);
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
    validateProperties(vo.properties, `valueObject ${vo.name}`, doc.enums);

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
    validateProperties(proj.properties, `projection ${proj.name}`, doc.enums);  }

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

    // [Phase 3, Gap E8] lookups[].errorCode must exist in errors[]
    for (const lk of uc.lookups || []) {
      if (lk.errorCode && !allErrorCodes.has(lk.errorCode)) {
        fail(`Use case "${uc.id}" lookup on "${lk.param}" errorCode "${lk.errorCode}" not found in errors[].`);
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
      // S23: the 'create' domainMethod must return the aggregate name (not void).
      // Without it the generator cannot emit the public static factory method and
      // produces a private constructor with no accessible creation path.
      if (dm.name === 'create' && dm.returns !== agg.name) {
        fail(`domainMethod "create" in aggregate "${agg.name}" must have returns: ${agg.name} (got "${dm.returns || 'void'}"). The generator uses this to emit the public static factory method.`);
      }
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

  // ── 5. repositories validation (R16, R18, R19) ─────────────────────────────
  validateRepositories(doc);

  // ── 6. errors[] orphan WARN (Phase 1 / E15) ────────────────────────────────
  // An error declared in errors[] but never referenced by domainRule.errorCode,
  // notFoundError, fkValidations[].error|notFoundError, or validations[].errorCode
  // is dead code: the generated *Error.java is never thrown by any handler.
  // Suppress the warning by declaring `usedFor: manual` on the error entry.
  const referencedErrorCodes = new Set();
  for (const agg of doc.aggregates || []) {
    for (const rule of agg.domainRules || []) {
      if (rule.errorCode) referencedErrorCodes.add(rule.errorCode);
    }
  }
  for (const uc of useCases) {
    const nfe = Array.isArray(uc.notFoundError)
      ? uc.notFoundError
      : (uc.notFoundError ? [uc.notFoundError] : []);
    for (const c of nfe) referencedErrorCodes.add(c);
    for (const lk of uc.lookups || []) {
      if (lk.errorCode) referencedErrorCodes.add(lk.errorCode);
    }
    for (const fk of uc.fkValidations || []) {
      const c = fk.error || fk.notFoundError;
      if (c) referencedErrorCodes.add(c);
    }
    for (const v of uc.validations || []) {
      if (v.errorCode) referencedErrorCodes.add(v.errorCode);
    }
  }
  for (const err of errors) {
    if (err.usedFor === 'manual') continue;
    if (!referencedErrorCodes.has(err.code)) {
      // eslint-disable-next-line no-console
      console.warn(
        `\u001b[33m\u26a0\u001b[0m [bc-yaml-reader] Error "${err.code}" is declared in errors[] but never referenced by any domainRule, notFoundError, fkValidations or validations. Either reference it, remove it, or declare "usedFor: manual" to silence this warning.`
      );
    }
  }
}

// ─── repositories[] validation ───────────────────────────────────────────────

/**
 * Whitelist + structural validation of the repositories[] section. This block
 * historically had no validation, so typos in `aggregate`, `derivedFrom` and
 * method names propagated silently to the generator and produced empty or
 * uncompilable output. Per AGENTS.md the generator must stop on missing data;
 * this validator enforces that contract.
 */
function validateRepositories(doc) {
  const repositories = doc.repositories;
  if (repositories == null) return;
  if (!Array.isArray(repositories)) {
    fail(`"repositories" must be a list of repository entries, one per aggregate.`);
  }

  const ALLOWED_REPO_KEYS = new Set(['aggregate', 'queryMethods', 'methods', 'bulkOperations', 'autoDerive']);
  const ALLOWED_METHOD_KEYS = new Set([
    'name', 'params', 'returns', 'derivedFrom', 'signature',
    // queryMethods may additionally declare ordering hints:
    'defaultSort', 'sortable',
  ]);
  const ALLOWED_PARAM_KEYS = new Set([
    'name', 'type', 'required', 'filterOn', 'operator',
  ]);
  const ALLOWED_OPERATORS = new Set([
    'EQ', 'LIKE_CONTAINS', 'LIKE_STARTS', 'LIKE_ENDS', 'GTE', 'LTE', 'IN',
  ]);
  const RETURN_PATTERNS = [
    /^void$/,
    /^Boolean$/,
    /^Int$/,
    /^Long$/,
    /^[A-Z][A-Za-z0-9]*\?$/,           // T?
    /^Page\[[A-Z][A-Za-z0-9]*\]$/,     // Page[T]
    /^Slice\[[A-Z][A-Za-z0-9]*\]$/,    // Slice[T]  (R15)
    /^Stream\[[A-Z][A-Za-z0-9]*\]$/,   // Stream[T] (R15)
    /^List\[[A-Z][A-Za-z0-9]*\]$/,     // List[T]
    /^[A-Z][A-Za-z0-9]*$/,             // T
  ];

  const aggregateNames = new Set((doc.aggregates || []).map((a) => a.name));
  const aggregateByName = new Map((doc.aggregates || []).map((a) => [a.name, a]));

  // Domain rules can be declared at the document root *or* nested inside each
  // aggregate (the bc-yaml schema supports both). Collect from both scopes and
  // remember which aggregate each rule belongs to for deleteGuard lookup.
  const ruleIds = new Set();
  const ruleById = new Map();
  const deleteGuardByAggregate = new Map();
  const indexRule = (rule, ownerAggregate) => {
    if (!rule || !rule.id) return;
    ruleIds.add(rule.id);
    ruleById.set(rule.id, rule);
    if (rule.type === 'deleteGuard') {
      const target = ownerAggregate || rule.appliesTo || rule.aggregate;
      if (target) {
        const list = deleteGuardByAggregate.get(target) || [];
        list.push(rule);
        deleteGuardByAggregate.set(target, list);
      }
    }
  };
  for (const rule of (doc.domainRules || [])) indexRule(rule, null);
  for (const agg of (doc.aggregates || [])) {
    for (const rule of (agg.domainRules || [])) indexRule(rule, agg.name);
  }

  for (const repo of repositories) {
    if (!repo || typeof repo !== 'object' || Array.isArray(repo)) {
      fail(`repositories[] contains a non-mapping entry; each entry must be an object with "aggregate".`);
    }
    for (const key of Object.keys(repo)) {
      if (!ALLOWED_REPO_KEYS.has(key)) {
        fail(`Repository entry for "${repo.aggregate || '<unnamed>'}" declares unsupported key "${key}". Allowed: ${[...ALLOWED_REPO_KEYS].join(', ')}.`);
      }
    }
    if (!repo.aggregate) {
      fail(`A repositories[] entry is missing required field "aggregate".`);
    }
    if (!aggregateNames.has(repo.aggregate)) {
      fail(`Repository declares aggregate "${repo.aggregate}" but no aggregate with that name exists in aggregates[]. Did you mean one of: ${[...aggregateNames].join(', ')}?`);
    }
    const aggregate = aggregateByName.get(repo.aggregate);

    const allMethods = [
      ...(repo.queryMethods || []).map((m) => ({ ...m, _section: 'queryMethods' })),
      ...(repo.methods || []).map((m) => ({ ...m, _section: 'methods' })),
    ];

    // Method name uniqueness within the aggregate.
    const seenNames = new Set();
    for (const m of allMethods) {
      const mname = m.name || (m.signature ? (m.signature.match(/^(\w+)/) || [])[1] : null);
      if (!mname) {
        fail(`Repository for "${repo.aggregate}" has a method without "name" (or parsable "signature").`);
      }
      if (seenNames.has(mname)) {
        fail(`Repository for "${repo.aggregate}" declares duplicate method "${mname}".`);
      }
      seenNames.add(mname);
    }

    // R19: read models must not expose write methods.
    if (aggregate && aggregate.readModel === true) {
      for (const m of allMethods) {
        if (m._section !== 'methods') continue;
        if (m.name === 'save' || m.name === 'delete' || m.name === 'softDelete') {
          fail(`Repository for read-model aggregate "${repo.aggregate}" declares write method "${m.name}". Read models are populated via projection events; remove "${m.name}".`);
        }
      }
    }

    // Per-method validation.
    for (const m of allMethods) {
      const ctx = `repositories["${repo.aggregate}"].${m._section}["${m.name || m.signature}"]`;

      for (const key of Object.keys(m)) {
        if (key === '_section') continue;
        if (!ALLOWED_METHOD_KEYS.has(key)) {
          fail(`${ctx} declares unsupported key "${key}". Allowed: ${[...ALLOWED_METHOD_KEYS].join(', ')}.`);
        }
      }

      // returns whitelist (skip when only `signature:` is provided — parsed elsewhere).
      if (m.returns != null) {
        const matched = RETURN_PATTERNS.some((re) => re.test(String(m.returns).trim()));
        if (!matched) {
          fail(`${ctx} has unsupported "returns": "${m.returns}". Allowed forms: T, T?, List[T], Page[T], Int, Boolean, void.`);
        }
      }

      // defaultSort / sortable validation. Only meaningful in queryMethods and
      // (currently) only honoured by the generator for List[T] returns; we still
      // accept it on Page[T] but document that Pageable.sort wins at runtime.
      if (m.defaultSort != null) {
        if (m._section !== 'queryMethods') {
          fail(`${ctx} declares "defaultSort" outside of queryMethods. Move the method under "queryMethods".`);
        }
        if (typeof m.defaultSort !== 'object' || Array.isArray(m.defaultSort)) {
          fail(`${ctx} "defaultSort" must be an object with "field" and optional "direction".`);
        }
        if (!m.defaultSort.field || typeof m.defaultSort.field !== 'string') {
          fail(`${ctx} "defaultSort" requires a non-empty "field".`);
        }
        if (m.defaultSort.direction != null && !['ASC', 'DESC'].includes(String(m.defaultSort.direction).toUpperCase())) {
          fail(`${ctx} "defaultSort.direction" must be ASC or DESC; got "${m.defaultSort.direction}".`);
        }
        if (aggregate) {
          const aggFieldNames = new Set([
            ...((aggregate.properties || []).map((a) => a.name)),
            ...((aggregate.attributes || []).map((a) => a.name)),
            ...((aggregate.fields || []).map((a) => a.name)),
            'createdAt', 'updatedAt', 'deletedAt', 'id',
          ]);
          if (!aggFieldNames.has(m.defaultSort.field)) {
            fail(`${ctx} "defaultSort.field" = "${m.defaultSort.field}" is not a known attribute of aggregate "${repo.aggregate}".`);
          }
        }
      }
      if (m.sortable != null) {
        if (m._section !== 'queryMethods') {
          fail(`${ctx} declares "sortable" outside of queryMethods.`);
        }
        if (!Array.isArray(m.sortable) || m.sortable.length === 0) {
          fail(`${ctx} "sortable" must be a non-empty list of aggregate attribute names.`);
        }
        if (aggregate) {
          const aggFieldNames = new Set([
            ...((aggregate.properties || []).map((a) => a.name)),
            ...((aggregate.attributes || []).map((a) => a.name)),
            ...((aggregate.fields || []).map((a) => a.name)),
            'createdAt', 'updatedAt', 'deletedAt', 'id',
          ]);
          for (const f of m.sortable) {
            if (!aggFieldNames.has(f)) {
              fail(`${ctx} "sortable" lists unknown field "${f}" on aggregate "${repo.aggregate}".`);
            }
          }
        }
      }

      // params whitelist + operator/filterOn coupling.
      if (m.params != null) {
        if (!Array.isArray(m.params)) {
          fail(`${ctx} "params" must be a list.`);
        }
        for (const p of m.params) {
          if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
          // Inline form { name: Type } with no `name`/`type` keys is tolerated by the generator.
          const hasShape = 'name' in p || 'type' in p;
          if (hasShape) {
            for (const key of Object.keys(p)) {
              if (!ALLOWED_PARAM_KEYS.has(key)) {
                fail(`${ctx} param "${p.name || '<unnamed>'}" declares unsupported key "${key}". Allowed: ${[...ALLOWED_PARAM_KEYS].join(', ')}.`);
              }
            }
            if (p.operator != null && !ALLOWED_OPERATORS.has(p.operator)) {
              fail(`${ctx} param "${p.name}" has unsupported operator "${p.operator}". Allowed: ${[...ALLOWED_OPERATORS].join(', ')}.`);
            }
            if (p.filterOn != null) {
              if (!Array.isArray(p.filterOn) || p.filterOn.length === 0) {
                fail(`${ctx} param "${p.name}" has invalid "filterOn"; expected a non-empty list of aggregate property names.`);
              }
              if (p.operator == null) {
                fail(`${ctx} param "${p.name}" declares "filterOn" but is missing required "operator". Operators allowed with filterOn: LIKE_CONTAINS, LIKE_STARTS, LIKE_ENDS.`);
              }
            }
          }
        }
      }

      // Naming-vs-returns sanity.
      if (m.name && m.returns) {
        const ret = String(m.returns).trim();
        if (/^findBy[A-Z]/.test(m.name) && !/\?$/.test(ret) && !/^List\[/.test(ret) && !/^Page\[/.test(ret)) {
          fail(`${ctx} naming convention "findBy*" requires returns of T?, List[T] or Page[T]; got "${ret}".`);
        }
        if (/^countBy[A-Z]/.test(m.name) && ret !== 'Int') {
          fail(`${ctx} naming convention "countBy*" requires returns: Int; got "${ret}".`);
        }
        if (/^existsBy[A-Z]/.test(m.name) && ret !== 'Boolean') {
          fail(`${ctx} naming convention "existsBy*" requires returns: Boolean; got "${ret}".`);
        }
      }

      // Page[T] returns require a Pageable (PageRequest) param or a page+size pair.
      if (m.returns && /^Page\[/.test(String(m.returns).trim()) && Array.isArray(m.params)) {
        const hasPageable = m.params.some((p) => p && (p.type === 'PageRequest' || p.name === 'pageable'));
        const hasPagePair = m.params.some((p) => p && p.name === 'page' && p.type === 'Integer')
          && m.params.some((p) => p && p.name === 'size' && p.type === 'Integer');
        if (!hasPageable && !hasPagePair) {
          fail(`${ctx} returns Page[T] but declares neither a "PageRequest" param nor the "page:Integer + size:Integer" pair.`);
        }
      }

      // derivedFrom cross-checks (RULE id).
      if (m.derivedFrom != null) {
        const df = String(m.derivedFrom);
        if (df === 'implicit') {
          // ok
        } else if (df.startsWith('openapi:')) {
          if (df === 'openapi:' || df.length < 'openapi:'.length + 1) {
            fail(`${ctx} has empty "derivedFrom: openapi:" — provide an operationId.`);
          }
          // Cross-check against the OpenAPI document is performed later in the
          // build pipeline, after the OpenAPI YAML is loaded.
        } else {
          // Treat any other string as a domainRule id reference.
          if (!ruleIds.has(df)) {
            fail(`${ctx} has "derivedFrom: ${df}" but no domainRule with that id is defined. Allowed forms: "implicit", "openapi:<operationId>", or a domainRules[].id.`);
          }
        }
      }
    }

    // R18: delete(id) without softDelete on the aggregate must be backed by a
    // domainRule of type "deleteGuard"; otherwise the generator emits a hard
    // delete that silently bypasses any business invariant.
    const deleteMethod = (repo.methods || []).find(
      (m) => m && m.name === 'delete' && Array.isArray(m.params) && m.params.length === 1
    );
    if (deleteMethod && aggregate && aggregate.softDelete !== true) {
      const df = deleteMethod.derivedFrom;
      const guardsForAggregate = deleteGuardByAggregate.get(repo.aggregate) || [];
      const referencesGuard = df && ruleById.has(df) && ruleById.get(df).type === 'deleteGuard';
      if (!referencesGuard && guardsForAggregate.length === 0) {
        fail(
          `Repository for "${repo.aggregate}" declares "delete(id)" but the aggregate is not "softDelete: true" ` +
          `and no domainRule of type "deleteGuard" exists for it. Either add "softDelete: true" to the aggregate ` +
          `(soft-delete becomes the default), declare a domainRule of type "deleteGuard" and reference it via ` +
          `"derivedFrom: <RULE_ID>", or remove the "delete" method.`
        );
      }
    }
  }

  // R24: query use cases that do not load the aggregate (Path B — they delegate
  // straight to the repository) must have at least one queryMethod declared on
  // the matching repository entry. Without this, the use-case handler would
  // either invoke a non-existent repository method or silently degrade to a
  // findById that ignores the requested filters.
  const repoByAggregate = new Map();
  for (const repo of repositories) {
    if (repo && repo.aggregate) repoByAggregate.set(repo.aggregate, repo);
  }
  for (const uc of (doc.useCases || [])) {
    if (uc.type !== 'query') continue;
    if (uc.loadAggregate === true) continue;
    const aggName = uc.aggregate;
    if (!aggName) continue;
    if (!aggregateNames.has(aggName)) continue; // covered elsewhere
    const repo = repoByAggregate.get(aggName);
    const qmCount = repo && Array.isArray(repo.queryMethods) ? repo.queryMethods.length : 0;
    if (qmCount === 0) {
      fail(
        `Use case "${uc.id}" is a query against aggregate "${aggName}" but its repository declares no "queryMethods". ` +
        `Either set "loadAggregate: true" on the use case (Path A — find-then-map), or add the matching queryMethod ` +
        `to repositories[].queryMethods so the handler can call it directly.`
      );
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
