'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPascalCase, toCamelCase, toPackagePath, pluralizeWord } = require('../utils/naming');
const { mapType, resolveCanonicalReturnType } = require('../utils/type-mapper');
const { mapDslValidations, mergeAnnotations } = require('../utils/validation-mapper');
const { mapRule } = require('../utils/domain-rule-mapper');
const { resolveVoDefinition, resolveMultiPropertyVo } = require('../utils/canonical-vo');
const { getOutboundHttpBcNames } = require('./outbound-http-generator');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

// ─── Constants ────────────────────────────────────────────────────────────────

const HTTP_TO_EXCEPTION = {
  // Classic statuses — keep historical mapping (BC).
  404: 'NotFoundException',
  409: 'ConflictException',
  400: 'BadRequestException',
  403: 'ForbiddenException',
  401: 'UnauthorizedException',
  422: 'BusinessException',
  // Phase 2 — extended statuses route to DomainException directly.
  // Reason: the generated *Error.java carries the dynamic httpStatus and is
  // caught by the generic @ExceptionHandler(DomainException.class) handler
  // in HandlerExceptions, which builds a ResponseEntity with that status.
  // Keeping them under DomainException avoids 7 new abstract subclasses.
  402: 'DomainException',
  408: 'DomainException',
  412: 'DomainException',
  415: 'DomainException',
  423: 'DomainException',
  429: 'DomainException',
  503: 'DomainException',
  504: 'DomainException',
};

// ─── Error helpers ────────────────────────────────────────────────────────────

// CART_NOT_FOUND → CartNotFoundError
function deriveErrorType(code) {
  return (code || '')
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join('') + 'Error';
}

// Compiles `"Hello {name}, count={n}"` + args=[{name},{n}] into a Java
// expression string: `"Hello " + String.valueOf(name) + ", count=" + String.valueOf(n)`.
// Unknown placeholders are kept literal (defensive).
function compileMessageTemplate(template, argNames) {
  if (!template) return null;
  const known = new Set(argNames || []);
  const parts = [];
  let lastIdx = 0;
  const re = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  let m;
  while ((m = re.exec(template)) !== null) {
    if (m.index > lastIdx) {
      parts.push(JSON.stringify(template.slice(lastIdx, m.index)));
    }
    if (known.has(m[1])) {
      parts.push(`String.valueOf(${m[1]})`);
    } else {
      parts.push(JSON.stringify(m[0]));
    }
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < template.length) {
    parts.push(JSON.stringify(template.slice(lastIdx)));
  }
  return parts.length ? parts.join(' + ') : '""';
}

// Last segment of a fully-qualified Java type. `java.util.UUID` → `UUID`.
function shortTypeName(fqn) {
  const ix = fqn.lastIndexOf('.');
  return ix === -1 ? fqn : fqn.slice(ix + 1);
}

function buildErrorMap(errors) {
  const map = {};
  for (const err of (errors || [])) {
    const errorType = err.errorType || deriveErrorType(err.code);
    const args = Array.isArray(err.args) ? err.args : [];
    map[err.code] = {
      errorType,
      httpStatus: err.httpStatus,
      baseException: HTTP_TO_EXCEPTION[err.httpStatus] || 'BusinessException',
      description: err.description || null,
      chainable: err.chainable === true,
      messageTemplate: err.messageTemplate || null,
      args,
    };
  }
  return map;
}

function normalizeNotFoundErrors(notFoundError) {
  if (!notFoundError || notFoundError === 'null') return [];
  return Array.isArray(notFoundError) ? notFoundError : [notFoundError];
}

// [Phase 3, Gap E8] Resolve the *primary* not-found error code for a UC.
// Order of precedence:
//   1. lookups[] entry whose `param` matches the input flagged loadAggregate:true
//   2. the first lookups[] entry that targets `uc.aggregate` (no nestedIn)
//   3. legacy uc.notFoundError (string or string[]; first entry wins)
function resolvePrimaryNotFoundError(uc) {
  const lookups = Array.isArray(uc.lookups) ? uc.lookups : [];
  if (lookups.length > 0) {
    const loadInput = (uc.input || []).find((i) => i.loadAggregate === true);
    if (loadInput) {
      const match = lookups.find((lk) => lk.param === loadInput.name && !lk.nestedIn);
      if (match) return match.errorCode;
    }
    const sameAgg = lookups.find((lk) => !lk.nestedIn && lk.aggregate === uc.aggregate);
    if (sameAgg) return sameAgg.errorCode;
  }
  return normalizeNotFoundErrors(uc.notFoundError)[0] || null;
}

// Returns the lookups[] entries that are NOT the primary lookup. Each becomes
// an enriched TODO in the generated handler so the Phase-3 implementer has
// the exact error class to throw without grepping the YAML again.
function additionalLookups(uc) {
  const lookups = Array.isArray(uc.lookups) ? uc.lookups : [];
  if (lookups.length === 0) return [];
  const primary = resolvePrimaryNotFoundError(uc);
  return lookups.filter((lk) => lk.errorCode !== primary);
}

// ─────────────────────────────────────────────────────────────────────────────
// Decorate UC `validations[]` entries with the resolved error class name.
// `expression` is always natural language (design-time, technology-agnostic).
// The generator always emits a // TODO — Fase 3 implements the predicate in Java.
// ─────────────────────────────────────────────────────────────────────────────
function enrichValidations(validations, errorMap) {
  if (!Array.isArray(validations)) return [];
  return validations.map((v) => {
    const errorEntry = v.errorCode ? errorMap[v.errorCode] : null;
    const errorClass = errorEntry ? errorEntry.errorType : null;
    // Normalize expression: YAML folded scalars (>) include trailing newlines and
    // may span multiple lines — collapse to a single space-separated string so it
    // can be safely embedded inside a single-line Java comment.
    const expression = typeof v.expression === 'string'
      ? v.expression.replace(/\s*[\r\n]+\s*/g, ' ').trim()
      : v.expression;
    return {
      ...v,
      expression,
      errorClass,
    };
  });
}

// Collects FQNs of error classes that the handler must import.
function validationErrorImports(enriched, packageName, moduleName) {
  const out = new Set();
  for (const v of enriched) {
    if (v.errorClass) {
      out.add(`${packageName}.${moduleName}.domain.errors.${v.errorClass}`);
    }
  }
  return [...out];
}

// ─── Repository method normalization ─────────────────────────────────────────

/**
 * Builds a nested map: { [aggName]: { [methodName]: [{name, type, required}] } }
 */
function normalizeRepoMethods(repositories) {
  const result = {};
  for (const repo of (repositories || [])) {
    result[repo.aggregate] = {};
    // Merge both standard methods and query-only methods into a single lookup map
    const allMethods = [...(repo.methods || []), ...(repo.queryMethods || [])];
    for (const method of allMethods) {
      result[repo.aggregate][method.name] = normalizeMethodParams(method);
    }
  }
  return result;
}

function normalizeMethodParams(method) {
  if (method.params && Array.isArray(method.params)) {
    return method.params.map((p) => {
      // Inline YAML flow form: [{id: 'Uuid'}] → {name: 'id', type: 'Uuid'}
      if (typeof p === 'object' && p !== null && !('name' in p) && !('type' in p)) {
        const entries = Object.entries(p);
        if (entries.length === 1) {
          const [name, type] = entries[0];
          return { name, type: String(type), required: true };
        }
      }
      return {
        name: p.name,
        type: p.type,
        required: p.required !== false,
      };
    });
  }
  if (method.signature) {
    return parseSignatureParams(method.signature);
  }
  return [];
}

/**
 * Parses a signature string like:
 *   "findById(Uuid): Customer?"
 *   "list(status?: CustomerStatus, PageRequest): Page[Customer]"
 */
function parseSignatureParams(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match || !match[1].trim()) return [];

  return match[1].split(',').map((p) => {
    p = p.trim();
    if (p.includes(':')) {
      // "status?: CustomerStatus"
      const colonIdx = p.indexOf(':');
      const nameWithOpt = p.substring(0, colonIdx).trim();
      const type = p.substring(colonIdx + 1).trim();
      const optional = nameWithOpt.endsWith('?');
      const name = nameWithOpt.replace('?', '').trim();
      return { name, type, required: !optional };
    } else {
      // "Uuid", "PageRequest", "String", etc.
      const optional = p.endsWith('?');
      const typeName = p.replace('?', '').trim();
      const name = inferParamNameFromType(typeName);
      return { name, type: typeName, required: !optional };
    }
  });
}

function inferParamNameFromType(typeName) {
  const map = {
    Uuid: 'id',
    String: 'query',
    PageRequest: 'page',
    Pageable: 'pageable',
    Email: 'email',
  };
  return map[typeName] || toCamelCase(typeName);
}

// ─── Property map ─────────────────────────────────────────────────────────────

function buildPropertyMap(agg) {
  const map = new Map();
  for (const p of agg.properties || []) map.set(p.name, p);
  for (const entity of agg.entities || []) {
    for (const p of entity.properties || []) {
      if (!map.has(p.name)) map.set(p.name, p);
    }
  }
  return map;
}

function resolveParamType(paramName, propMap) {
  if (propMap.has(paramName)) return propMap.get(paramName).type;

  // Strip 'new' prefix (e.g. newPrice → price)
  if (/^new[A-Z]/.test(paramName)) {
    const stripped = paramName.charAt(3).toLowerCase() + paramName.slice(4);
    if (propMap.has(stripped)) return propMap.get(stripped).type;
  }

  // Strip 'updated' prefix
  if (/^updated[A-Z]/.test(paramName)) {
    const stripped = paramName.charAt(7).toLowerCase() + paramName.slice(8);
    if (propMap.has(stripped)) return propMap.get(stripped).type;
  }

  // Ends with 'Id' → UUID
  if (paramName.endsWith('Id')) return 'Uuid';

  return 'String';
}

// ─── Method signature parsing ─────────────────────────────────────────────────

function parseMethodSignature(methodStr) {
  if (!methodStr) return { methodName: '', params: [], returnType: 'void' };
  const firstParen = methodStr.indexOf('(');
  // No parens: bare method name (e.g. "create")
  if (firstParen === -1) return { methodName: methodStr.trim(), params: [], returnType: 'void' };
  // Walk forward to find the matching closing paren (handles nested parens like String(200))
  let depth = 0;
  let closeParen = -1;
  for (let i = firstParen; i < methodStr.length; i++) {
    if (methodStr[i] === '(') depth++;
    else if (methodStr[i] === ')') {
      depth--;
      if (depth === 0) { closeParen = i; break; }
    }
  }
  if (closeParen === -1) return { methodName: methodStr, params: [], returnType: 'void' };
  const methodName = methodStr.substring(0, firstParen).trim();
  const paramsStr = methodStr.substring(firstParen + 1, closeParen).trim();
  const returnTypeMatch = methodStr.substring(closeParen + 1).match(/^\s*:\s*(.+)$/);
  const returnType = returnTypeMatch ? returnTypeMatch[1].trim() : 'void';
  // Split params on commas NOT inside nested parens
  const params = [];
  if (paramsStr) {
    let current = '';
    let d = 0;
    for (const ch of paramsStr) {
      if (ch === '(') { d++; current += ch; }
      else if (ch === ')') { d--; current += ch; }
      else if (ch === ',' && d === 0) { params.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    if (current.trim()) params.push(current.trim());
  }
  return {
    methodName,
    params: params.filter(Boolean).map((p) => {
      const optional = p.includes('?');
      const clean = p.replace('?', '').trim();
      // Support inline type hint: "paramName: TypeHint"
      const colonIdx = clean.indexOf(':');
      const name = colonIdx !== -1 ? clean.substring(0, colonIdx).trim() : clean;
      const typeHint = colonIdx !== -1 ? clean.substring(colonIdx + 1).trim() : null;
      return { name, optional, typeHint };
    }),
    returnType,
  };
}

function parseRepoMethodName(repoMethodStr) {
  if (!repoMethodStr) return '';
  const match = repoMethodStr.match(/^(\w+)/);
  return match ? match[1] : repoMethodStr;
}

// ─── Java type helpers ────────────────────────────────────────────────────────

/**
 * Returns true when a VO type has exactly one String-like property,
 * meaning it should be represented as a plain String in DTOs and commands.
 * e.g. PhoneNumber { value: String }, Email { value: Email }, Url { value: Url }
 */
function isSingleStringVo(voType, bcYaml) {
  const vo = (bcYaml && bcYaml.valueObjects || []).find((v) => v.name === voType);
  if (!vo || (vo.properties || []).length !== 1) return false;
  const t = vo.properties[0].type;
  return t === 'String' || t === 'Text' || t === 'Email' || t === 'Url' || /^String\(\d+\)$/.test(t);
}

// ─── Projection helpers ──────────────────────────────────────────────────────

/**
 * Extracts the inner type name from a `returns` value that may be a bare name,
 * `List[X]` or `Page[X]`. Returns null for non-string inputs.
 */
function extractInnerReturnTypeName(returns) {
  if (!returns || typeof returns !== 'string') return null;
  const m = /^(?:Page|List|Optional)\[(.+)\]$/.exec(returns);
  return m ? m[1] : returns;
}

// [G24] An Optional[X] return type makes the handler return Optional<X> and
// flips the controller to ResponseEntity<X> with 200/404 mapping.
function isOptionalReturnType(returnsStr) {
  return typeof returnsStr === 'string' && /^Optional\[/.test(returnsStr);
}

function findProjection(name, bcYaml) {
  if (!name) return null;
  return (bcYaml?.projections || []).find((p) => p.name === name) || null;
}

function projectionNamesInType(type, bcYaml) {
  const names = [];
  const visit = (raw) => {
    if (!raw || typeof raw !== 'string') return;
    const wrapped = /^(?:List|Page|Optional)\[(.+)\]$/.exec(raw);
    if (wrapped) {
      visit(wrapped[1]);
      return;
    }
    if (findProjection(raw, bcYaml)) names.push(raw);
  };
  visit(type);
  return names;
}

/**
 * Map of getterName → property declaration for derivability checks against
 * an aggregate root. Includes audit fields when applicable.
 */
function aggregateGetterMap(agg) {
  const map = new Map();
  for (const prop of (agg.properties || [])) {
    if (prop.hidden || prop.internal) continue;
    map.set(prop.name, prop);
  }
  if (agg.auditable) {
    map.set('createdAt', { name: 'createdAt', type: 'DateTime' });
    map.set('updatedAt', { name: 'updatedAt', type: 'DateTime' });
  }
  return map;
}

function isProjectionDerivable(projection, agg) {
  const m = aggregateGetterMap(agg);
  for (const p of (projection.properties || [])) {
    if (!m.has(p.name)) return false;
  }
  return true;
}

/**
 * Returns projections referenced by `returns` of any query UC for the given
 * aggregate, with cardinality info (single / list / paged).
 *
 * If a projection declares `source: aggregate:<Name>`, it is only included for
 * the aggregate whose name matches; this gives designers an explicit override
 * over the heuristic "any UC of this aggregate returns the projection".
 */
function projectionsUsedByAggregate(agg, bcYaml) {
  const result = new Map();
  for (const uc of (bcYaml.useCases || [])) {
    if (uc.aggregate !== agg.name) continue;
    if (uc.type !== 'query' || !uc.returns || typeof uc.returns !== 'string') continue;
    const inner = extractInnerReturnTypeName(uc.returns);
    const projection = findProjection(inner, bcYaml);
    if (!projection) continue;
    if (projection.source && /^aggregate:/.test(projection.source)) {
      const explicit = projection.source.split(':')[1];
      if (explicit !== agg.name) continue;
    }
    const isPaged = /^Page\[/.test(uc.returns);
    const isList = !isPaged && /^List\[/.test(uc.returns);
    const existing = result.get(inner) || { projection, single: false, list: false };
    if (isPaged || isList) existing.list = true; else existing.single = true;
    result.set(inner, existing);
  }
  return [...result.values()];
}

function javaTypeForDto(type, packageName, moduleName, imports, voNames = new Set(), bcYaml = null, eventDtoNames = new Set()) {
  // List[T] — recursive inner type resolution
  const listDtoMatch = /^List\[(.+)\]$/.exec(type);
  if (listDtoMatch) {
    imports.add('java.util.List');
    const innerJavaType = javaTypeForDto(listDtoMatch[1], packageName, moduleName, imports, voNames, bcYaml, eventDtoNames);
    return `List<${innerJavaType}>`;
  }
  // [G8] Range[T] — declarative range filter. Carried as Range<T> from the
  // shared module; the inner type is resolved recursively so its imports are
  // collected (e.g. Range[Money] needs both Range and Money imports).
  const rangeDtoMatch = /^Range\[(.+)\]$/.exec(type);
  if (rangeDtoMatch) {
    imports.add(`${packageName}.shared.application.dtos.Range`);
    const innerJavaType = javaTypeForDto(rangeDtoMatch[1], packageName, moduleName, imports, voNames, bcYaml, eventDtoNames);
    return `Range<${innerJavaType}>`;
  }
  // [G8] SearchText — wire-level String. The Specification builder consumes
  // it field-by-field per the input's fields[] declaration.
  if (type === 'SearchText') {
    return 'String';
  }
  if (type === 'Uuid') {
    imports.add('java.util.UUID');
    return 'UUID';
  }
  if (type === 'DateTime') {
    imports.add('java.time.Instant');
    return 'Instant';
  }
  if (type === 'Date') {
    imports.add('java.time.LocalDate');
    return 'LocalDate';
  }
  if (type === 'Duration') {
    imports.add('java.time.Duration');
    return 'Duration';
  }
  if (type === 'BigInt' || type === 'BigInteger') {
    imports.add('java.math.BigInteger');
    return 'BigInteger';
  }
  if (type === 'Json' || type === 'JSON') {
    imports.add('com.fasterxml.jackson.databind.JsonNode');
    return 'JsonNode';
  }
  // [G12] Multipart upload — Spring's MultipartFile carried through the command record.
  if (type === 'File') {
    imports.add('org.springframework.web.multipart.MultipartFile');
    return 'MultipartFile';
  }
  // [G12] Binary download — Spring's Resource produced by the query handler.
  if (type === 'BinaryStream') {
    imports.add('org.springframework.core.io.Resource');
    return 'Resource';
  }
  if (type === 'Text' || type === 'Email' || type === 'Url') return 'String';
  if (type === 'Boolean') return 'Boolean';
  if (type === 'Integer') return 'Integer';
  if (type === 'Long') return 'Long';
  if (type === 'Decimal') {
    imports.add('java.math.BigDecimal');
    return 'BigDecimal';
  }
  if (type === 'Money') {
    imports.add(`${packageName}.${moduleName}.domain.valueobject.Money`);
    return 'Money';
  }
  // StoredObject — canonical shared VO (object storage); lives in shared.*
  if (type === 'StoredObject') {
    imports.add(`${packageName}.shared.domain.valueobject.StoredObject`);
    return 'StoredObject';
  }
  const stringMatch = /^String\((\d+)\)$/.exec(type);
  if (stringMatch) return 'String';
  if (type === 'String') return 'String';
  // Enum<X> → X
  const enumMatch = /^Enum<(.+)>$/.exec(type);
  if (enumMatch) {
    const enumName = enumMatch[1];
    imports.add(`${packageName}.${moduleName}.domain.enums.${enumName}`);
    return enumName;
  }
  // eventDto type — incoming DTO from an external BC
  if (eventDtoNames.has(type)) {
    imports.add(`${packageName}.${moduleName}.application.dtos.incoming.${type}`);
    return type;
  }
  // Value object
  if (voNames.has(type)) {
    if (isSingleStringVo(type, bcYaml)) return 'String';
    imports.add(`${packageName}.${moduleName}.domain.valueobject.${type}`);
    return type;
  }
  // Projection — resolved to application/dtos/<Name> (no Dto suffix)
  const projectionNames = new Set(((bcYaml && bcYaml.projections) || []).map((p) => p.name));
  if (projectionNames.has(type)) {
    imports.add(`${packageName}.${moduleName}.application.dtos.${type}`);
    return type;
  }
  // Enum — only if declared
  const enumNames = new Set(((bcYaml && bcYaml.enums) || []).map((e) => e.name));
  if (enumNames.has(type)) {
    imports.add(`${packageName}.${moduleName}.domain.enums.${type}`);
    return type;
  }
  throw new Error(
    `[application-generator] javaTypeForDto: cannot resolve type "${type}". ` +
    `Declare it under enums[], valueObjects[] or projections[], or use a canonical type.`
  );
}

// Commands receive UUIDs as String and convert with UUID.fromString in handler
function javaTypeForCommand(type, packageName, moduleName, imports, voNames = new Set(), bcYaml = null) {
  if (type === 'Uuid') return 'String';
  return javaTypeForDto(type, packageName, moduleName, imports, voNames, bcYaml);
}

function getterName(fieldName) {
  return 'get' + fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
}

// ─── Composition entities (child DTOs) ─────────────────────────────────────────

// Domain field/getter name for a child entity, matching aggregate-generator.js:
// oneToMany → camelCase(plural(name)) (e.g. ProductImage → productImages),
// oneToOne  → camelCase(name).
function childDomainFieldName(entity) {
  const isOneToOne = entity.cardinality === 'oneToOne';
  return isOneToOne ? toCamelCase(entity.name) : toCamelCase(pluralizeWord(entity.name));
}

// Resolves the composition collection field name as it must appear in the
// serialized ResponseDto. The ResponseDto is serialized directly by the
// controller, so its field names must match the OpenAPI contract — which is the
// authoritative source for this name (it is NOT derivable from the entity name,
// e.g. ProductImage → "images", not "productImages").
function resolveCompositionFieldName(publicApiDoc, aggName, entity) {
  const isOneToOne = entity.cardinality === 'oneToOne';
  // No public OpenAPI for this BC → deterministic fallback to the domain field name.
  if (!publicApiDoc) return childDomainFieldName(entity);

  const schemas = (publicApiDoc.components && publicApiDoc.components.schemas) || {};
  const respSchema = schemas[`${aggName}Response`];
  // No "{Agg}Response" schema → no endpoint publishes this DTO, so its field names
  // aren't bound to any contract. Fall back to the domain-derived name rather than
  // failing. Fail-fast applies only when the schema EXISTS but omits the composition.
  if (!respSchema || !respSchema.properties) {
    return childDomainFieldName(entity);
  }
  const refSuffix = `/${entity.name}Response`;
  for (const [propName, propSchema] of Object.entries(respSchema.properties)) {
    if (!propSchema) continue;
    if (isOneToOne) {
      if (typeof propSchema.$ref === 'string' && propSchema.$ref.endsWith(refSuffix)) return propName;
    } else if (
      propSchema.type === 'array' &&
      propSchema.items &&
      typeof propSchema.items.$ref === 'string' &&
      propSchema.items.$ref.endsWith(refSuffix)
    ) {
      return propName;
    }
  }
  throw new Error(
    `[application-generator] El schema "${aggName}Response" no expone una propiedad ` +
    `${isOneToOne ? '' : 'array '}que referencie "${entity.name}Response" ` +
    `(composición "${entity.name}" declarada en el agregado "${aggName}"). ` +
    `Alinea {bc}-open-api.yaml con la composición del agregado.`
  );
}

// ─── ResponseDto fields ───────────────────────────────────────────────────────

// Builds the scalar (non-composition) record components for a set of properties.
// Shared by the aggregate ResponseDto and each child-entity ResponseDto.
function buildScalarDtoFields(props, packageName, moduleName, imports, voNames, bcYaml) {
  const fields = [];
  for (const prop of props || []) {
    if (prop.hidden || prop.internal) continue;
    const javaType = javaTypeForDto(prop.type, packageName, moduleName, imports, voNames, bcYaml);
    fields.push({ type: javaType, name: prop.name, annotations: [] });
  }
  return fields;
}

function buildResponseDtoFields(agg, packageName, moduleName, voNames = new Set(), bcYaml = null, publicApiDoc = null) {
  const imports = new Set();
  const fields = buildScalarDtoFields(agg.properties || [], packageName, moduleName, imports, voNames, bcYaml);

  // Composition entities → nested response DTO fields. Field name comes from the
  // OpenAPI response schema (the serialized contract), placed before audit fields.
  for (const entity of agg.entities || []) {
    const isOneToOne = entity.cardinality === 'oneToOne';
    const fieldName = resolveCompositionFieldName(publicApiDoc, agg.name, entity);
    const childDto = `${entity.name}ResponseDto`;
    if (isOneToOne) {
      fields.push({ type: childDto, name: fieldName, annotations: [] });
    } else {
      imports.add('java.util.List');
      fields.push({ type: `List<${childDto}>`, name: fieldName, annotations: [] });
    }
  }

  if (agg.auditable) {
    imports.add('java.time.Instant');
    fields.push({ type: 'Instant', name: 'createdAt', annotations: [] });
    fields.push({ type: 'Instant', name: 'updatedAt', annotations: [] });
  }

  return { fields, imports: [...imports].sort() };
}

// ─── Mapper fields ────────────────────────────────────────────────────────────

// Builds one mapper field for a scalar property. Getter-based fields return
// { name, getter } (the template prepends the receiver); conversion fields return
// { name, expr } with the receiver already inlined.
function buildScalarMapperField(prop, receiver, packageName, moduleName, voNames, bcYaml, imports) {
  javaTypeForDto(prop.type, packageName, moduleName, imports, voNames, bcYaml); // side-effect: collect imports
  const baseGetter = getterName(prop.name);
  // Url type — domain holds URI, DTO expects String; emit an explicit conversion.
  if (prop.type === 'Url') {
    const expr = prop.required
      ? `${receiver}.${baseGetter}().toString()`
      : `${receiver}.${baseGetter}() != null ? ${receiver}.${baseGetter}().toString() : null`;
    return { name: prop.name, expr };
  }
  // List[T] with single-prop VO inner type → stream().map(Vo::getValue).toList()
  const listInnerMatch = /^List\[(.+)\]$/.exec(prop.type);
  let getter;
  if (listInnerMatch) {
    const innerType = listInnerMatch[1];
    const innerVo = (bcYaml?.valueObjects || []).find((v) => v.name === innerType && (v.properties || []).length === 1);
    getter = innerVo
      ? `${baseGetter}().stream().map(${innerType}::getValue).toList`
      : baseGetter;
  } else {
    const isSingleStrVo = voNames.has(prop.type) && isSingleStringVo(prop.type, bcYaml);
    getter = isSingleStrVo
      ? `${baseGetter}().getValue`
      : baseGetter;
  }
  return { name: prop.name, getter };
}

function buildMapperFields(agg, packageName, moduleName, voNames = new Set(), bcYaml = null) {
  const imports = new Set();
  const fields = [];

  for (const prop of agg.properties || []) {
    if (prop.hidden || prop.internal) continue;
    fields.push(buildScalarMapperField(prop, 'domain', packageName, moduleName, voNames, bcYaml, imports));
  }

  // Composition entities → mapped via dedicated child mapper methods. Ordering
  // (scalars, compositions, audit) must mirror buildResponseDtoFields exactly so
  // the record's positional constructor args line up.
  for (const entity of agg.entities || []) {
    const isOneToOne = entity.cardinality === 'oneToOne';
    const getter = getterName(childDomainFieldName(entity));
    const childMethod = `to${entity.name}ResponseDto`;
    const expr = isOneToOne
      ? `${childMethod}(domain.${getter}())`
      : `domain.${getter}().stream().map(this::${childMethod}).toList()`;
    fields.push({ name: toCamelCase(entity.name), expr });
  }

  if (agg.auditable) {
    fields.push({ name: 'createdAt', getter: 'getCreatedAt' });
    fields.push({ name: 'updatedAt', getter: 'getUpdatedAt' });
  }

  return { fields, imports: [...imports].sort() };
}

// ─── Validation helpers ─────────────────────────────────────────────────────

const JAKARTA = 'jakarta.validation.constraints';

/**
 * Builds a flat Map<fieldName, propertyDef> from aggregate root properties
 * and all child entity properties. Used to resolve DSL validations[] for
 * command and query input fields.
 */
function buildAggPropertyMap(agg) {
  const map = new Map();
  for (const prop of (agg.properties || [])) {
    map.set(prop.name, prop);
  }
  for (const entity of (agg.entities || [])) {
    for (const prop of (entity.properties || [])) {
      if (!map.has(prop.name)) map.set(prop.name, prop);
    }
  }
  return map;
}

/**
 * Returns Jakarta constraint annotations implied by the canonical YAML type itself
 * (independent of any explicit validations[] declaration):
 *   - String(n) → @Size(max = n)
 *   - Email     → @Email
 */
function getTypeValidationAnnotations(rawType, imports) {
  const stringNMatch = /^String\((\d+)\)$/.exec(rawType);
  if (stringNMatch) {
    imports.add(`${JAKARTA}.Size`);
    return [`@Size(max = ${stringNMatch[1]})`];
  }
  if (rawType === 'Email') {
    imports.add(`${JAKARTA}.Email`);
    return ['@Email'];
  }
  return [];
}

function getCollectionSizeAnnotations(inputOrSchema, imports) {
  const min = inputOrSchema?.minSize ?? inputOrSchema?.minItems;
  const max = inputOrSchema?.maxSize ?? inputOrSchema?.maxItems;
  if (min == null && max == null) return [];
  imports.add(`${JAKARTA}.Size`);
  const attrs = [];
  if (min != null) attrs.push(`min = ${min}`);
  if (max != null) attrs.push(`max = ${max}`);
  return [`@Size(${attrs.join(', ')})`];
}

/**
 * Returns the presence annotation (@NotBlank for String, @NotNull for all others)
 * when the field is required. Returns [] for optional fields.
 */
function buildRequiredAnnotation(javaType, imports) {
  if (javaType === 'String') {
    imports.add(`${JAKARTA}.NotBlank`);
    return ['@NotBlank'];
  }
  imports.add(`${JAKARTA}.NotNull`);
  return ['@NotNull'];
}

/**
 * Drops presence constraints (`notEmpty`) from a property's validations[] before
 * they reach mapDslValidations(). On an optional or path-bound command field a
 * presence constraint is wrong: an absent (null) value must be allowed, otherwise
 * a partial update sending only the other fields fails with 422. Content
 * constraints (@Size/@Pattern/@Email/min/max/…) are preserved.
 */
function stripPresenceValidations(validations) {
  return (validations || []).filter((v) => Object.keys(v)[0] !== 'notEmpty');
}

// ─── Command fields ───────────────────────────────────────────────────────────

function buildCommandFields(uc, agg, packageName, moduleName, voNames = new Set(), bcYaml = null, eventDtoNames = new Set()) {
  const imports = new Set();
  const fields = [];
  const voRequestsNeeded = new Set();
  const propMap = buildAggPropertyMap(agg);
  const isEventTriggered = !!(uc.trigger && uc.trigger.kind === 'event');
  let commandInputs = uc.input || [];

  // Event-triggered commands: uc.input[] narrows the command payload. When absent,
  // mirror the listener fallback and use the consumed event payload. If neither is
  // declared, the command record stays empty and the listener calls new XyzCommand().
  if (isEventTriggered && !commandInputs.some((i) => i.source !== 'authContext')) {
    // bc-yaml-reader normalises trigger.consumes → trigger.event, so trigger.event is
    // the canonical (always-populated) key. Reading trigger.consumes here missed the
    // consumed event whenever the YAML used `event:` (e.g. sagas), yielding an empty
    // command record while the listener still constructs it with the payload fields.
    const consumedEvent = (bcYaml?.domainEvents?.consumed || []).find((event) => event.name === uc.trigger.event);
    commandInputs = consumedEvent?.payload || [];
    if (commandInputs.length === 0) {
      return { fields, imports: [...imports].sort(), voRequestsNeeded };
    }
  }

  for (const input of commandInputs) {
    // Fields sourced from authContext are injected in the handler, not in the command record
    if (input.source === 'authContext') continue;

    // [G12] Multipart inputs travel through the command record. The binary File
    // part is carried as MultipartFile; typed form-data parts (String/enum/
    // number sent alongside the upload) carry their real Java type. Bean
    // Validation annotations (@NotNull/@Size) do not behave well across
    // multipart boundaries — the controller emits explicit guards instead.
    if (input.source === 'multipart') {
      if (input.type === 'File') {
        imports.add('org.springframework.web.multipart.MultipartFile');
        fields.push({ type: 'MultipartFile', name: input.name, annotations: [] });
      } else {
        const javaType = javaTypeForCommand(input.type, packageName, moduleName, imports, voNames, bcYaml);
        fields.push({ type: javaType, name: input.name, annotations: [] });
      }
      continue;
    }

    const rawType = input.type;
    const isOptional = input.required === false;
    // Fields bound to @PathVariable are validated by HTTP routing, not the request body.
    // Emitting @NotBlank/@NotNull on them causes 422 when Spring deserializes a body
    // that doesn't contain the path segment.
    const isPathField = input.source === 'path';

    // Detect List[MultiPropVO] — e.g. List[Topics] where Topics has >1 property
    const listInnerMatch = /^List\[(.+)\]$/.exec(rawType);
    const listInnerVoName = listInnerMatch ? listInnerMatch[1] : null;
    const listInnerVoDef = listInnerVoName
      ? resolveVoDefinition(listInnerVoName, bcYaml)
      : null;

    if (!isEventTriggered && listInnerVoDef && (listInnerVoDef.properties || []).length > 1) {
      // ── List[MultiPropVO] (e.g. List[Topics]) — emit List<{VoName}Request> with @Valid ──
      imports.add('java.util.List');
      imports.add('jakarta.validation.Valid');
      const annotations = [];
      if (!isOptional && !isPathField) {
        imports.add(`${JAKARTA}.NotNull`);
        annotations.push('@NotNull');
      }
      annotations.push(...getCollectionSizeAnnotations(input, imports));
      annotations.push('@Valid');
      fields.push({ type: `List<${listInnerVoName}Request>`, name: input.name, annotations });
      voRequestsNeeded.add(listInnerVoName);
    } else {

    // Look up VO definition for any type that matches a declared valueObject, or
    // a canonical auto-emitted VO (e.g. Money). [R3] Routing canonical Money here
    // makes a `type: Money` body input become a MoneyRequest DTO with @Valid instead
    // of binding the domain VO directly to the wire.
    const voDefinition = resolveVoDefinition(rawType, bcYaml);

    if (!isEventTriggered && voDefinition && (voDefinition.properties || []).length > 1) {
      // ── Multi-property VO (e.g. Money) — emit one nested {VoName}Request field with @Valid ──
      const requestType = `${rawType}Request`;
      imports.add('jakarta.validation.Valid');
      const annotations = [];
      if (!isOptional && !isPathField) {
        imports.add(`${JAKARTA}.NotNull`);
        annotations.push('@NotNull');
      }
      annotations.push('@Valid');
      fields.push({ type: requestType, name: input.name, annotations });
      voRequestsNeeded.add(rawType);
    } else if (voDefinition && (voDefinition.properties || []).length === 1) {
      // ── Single-property VO (e.g. PhoneNumber { value: String(20) }) — collapse to primitive ──
      const voProp = voDefinition.properties[0];
      const mapped = mapType(voProp.type, voProp);
      if (mapped.importHint) imports.add(mapped.importHint);

      const typeAnnotations = getTypeValidationAnnotations(voProp.type, imports);
      // Presence constraints (notEmpty) must not survive on optional/path fields.
      const voValidations = (isOptional || isPathField)
        ? stripPresenceValidations(voProp.validations)
        : (voProp.validations || []);
      const { annotations: dslAnnotations, imports: dslImports } =
        mapDslValidations(voValidations, voProp.type);
      for (const imp of dslImports) imports.add(imp);
      const mergedAnnotations = mergeAnnotations(typeAnnotations, dslAnnotations);

      const fieldRequired = !isOptional && !isPathField && voProp.required !== false;
      const requiredAnnotations = fieldRequired
        ? buildRequiredAnnotation(mapped.javaType, imports)
        : [];

      fields.push({ type: mapped.javaType, name: input.name, annotations: [...requiredAnnotations, ...mergedAnnotations] });
    } else {
      // ── Primitive, enum, Uuid, or unknown type ──
      // Event-triggered: use javaTypeForDto (Uuid → UUID, keeps domain VO types)
      // HTTP-triggered: use javaTypeForCommand (Uuid → String, for handler conversion)
      const javaType = isEventTriggered
        ? javaTypeForDto(rawType, packageName, moduleName, imports, voNames, bcYaml, eventDtoNames)
        : javaTypeForCommand(rawType, packageName, moduleName, imports, voNames, bcYaml);
      const propDef = propMap.get(input.name);

      // 1. Required annotation (@NotBlank / @NotNull) — omitted for path variable fields
      const requiredAnnotations = (isOptional || isPathField) ? [] : buildRequiredAnnotation(javaType, imports);

      // 2. Type-based annotations (e.g. @Size(max=n) for String(n), @Email)
      const typeAnnotations = getTypeValidationAnnotations(rawType, imports);
      const collectionAnnotations = /^List\[/.test(rawType) ? getCollectionSizeAnnotations(input, imports) : [];

      // 3. DSL validations[] from aggregate property definition.
      //    Presence constraints (notEmpty) are dropped on optional/path fields so a
      //    partial update omitting this field is not rejected with 422.
      const skipPresence = isOptional || isPathField;
      const effectiveValidations = skipPresence
        ? stripPresenceValidations(propDef ? propDef.validations : [])
        : (propDef ? propDef.validations : []);
      const { annotations: dslAnnotations, imports: dslImports } =
        mapDslValidations(effectiveValidations, rawType);
      for (const imp of dslImports) imports.add(imp);

      // 4. Merge @Size(max=n) + @Size(min=N) → @Size(min=N, max=n)
      const mergedAnnotations = mergeAnnotations([...typeAnnotations, ...collectionAnnotations], dslAnnotations);

      // 5. Final order: required → type/dsl merged
      fields.push({ type: javaType, name: input.name, annotations: [...requiredAnnotations, ...mergedAnnotations] });
    }

    } // end List[MultiPropVO] else
  }

  return { fields, imports: [...imports].sort(), voRequestsNeeded };
}

// ─── Paged query detection ────────────────────────────────────────────────────
// A query is paged when uc.returns declares Page[X].
function isPagedReturnType(returnsStr) {
  return returnsStr && /^Page\[/.test(returnsStr);
}

// ─── Query fields ─────────────────────────────────────────────────────────────

function buildQueryFields(uc, agg, repoMethods, bcYaml = null, packageName = null, moduleName = null) {
  const fields = [];
  const imports = new Set();
  const propMap = buildAggPropertyMap(agg);
  const enumNames = new Set((bcYaml?.enums || []).map((e) => e.name));

  for (const input of (uc.input || [])) {
    // Fields sourced from authContext are injected in the handler, not exposed
    // in the controller request nor in the Query record.
    if (input.source === 'authContext') continue;

    const type = input.type;
    const isOptional = input.required === false;

    // [G8] Range[T] — declarative range filter; carried as Range<T> in the Query record.
    const rangeMatch = /^Range\[(.+)\]$/.exec(type);
    if (rangeMatch) {
      const inner = mapType(rangeMatch[1]);
      if (packageName) imports.add(`${packageName}.shared.application.dtos.Range`);
      if (inner.importHint) imports.add(inner.importHint);
      const requiredAnnotations = isOptional ? [] : (() => {
        imports.add(`${JAKARTA}.NotNull`);
        return ['@NotNull'];
      })();
      fields.push({ type: `Range<${inner.javaType}>`, name: input.name, annotations: requiredAnnotations });
      continue;
    }
    // [G8] SearchText — wire-level String; aggregate fields[] consumed by Specs builder.
    if (type === 'SearchText') {
      const requiredAnnotations = isOptional ? [] : (() => {
        imports.add(`${JAKARTA}.NotBlank`);
        return ['@NotBlank'];
      })();
      fields.push({ type: 'String', name: input.name, annotations: requiredAnnotations });
      continue;
    }

    const listMatch = /^List\[(.+)\]$/.exec(type);
    if (listMatch) {
      // List[T] multi-value query param — carried as List<…> in the Query record.
      // Inner follows the query convention: Uuid → String (wire-level), enum → enum,
      // else the canonical scalar Java type. @NotEmpty (not @NotBlank) validates a List.
      const innerType = listMatch[1];
      const innerJava = innerType === 'Uuid' ? 'String'
        : enumNames.has(innerType) ? innerType
        : mapType(innerType).javaType;
      imports.add('java.util.List');
      if (innerJava !== 'String') {
        const innerHint = mapType(innerType).importHint;
        if (innerHint) imports.add(innerHint);
      }
      if (enumNames.has(innerType) && packageName && moduleName) {
        imports.add(`${packageName}.${moduleName}.domain.enums.${innerType}`);
      }
      const requiredAnnotations = isOptional ? [] : (() => {
        imports.add(`${JAKARTA}.NotEmpty`);
        return ['@NotEmpty'];
      })();
      fields.push({ type: `List<${innerJava}>`, name: input.name, annotations: requiredAnnotations });
      continue;
    }
    if (type === 'Integer' && (input.name === 'page' || input.name === 'size')) {
      // Pagination primitives — no validation annotations
      fields.push({ type: 'int', name: input.name, annotations: [] });
    } else if (type === 'PageRequest' || type === 'Pageable') {
      // PageRequest/Pageable input — expand to int page + int size pagination fields
      const existing = new Set(fields.map((f) => f.name));
      if (!existing.has('page')) fields.push({ type: 'int', name: 'page', annotations: [] });
      if (!existing.has('size')) fields.push({ type: 'int', name: 'size', annotations: [] });
    } else if (type === 'Uuid') {
      // Uuid path/query params come in as String
      const requiredAnnotations = isOptional ? [] : (() => {
        imports.add(`${JAKARTA}.NotBlank`);
        return ['@NotBlank'];
      })();
      fields.push({ type: 'String', name: input.name, annotations: requiredAnnotations });
    } else if (enumNames.has(type)) {
      // [G5] Strong-typed enum query field — Spring binds the enum directly,
      // eliminating the need for Enum.valueOf in the handler.
      if (packageName && moduleName) {
        imports.add(`${packageName}.${moduleName}.domain.enums.${type}`);
      }
      const requiredAnnotations = isOptional ? [] : (() => {
        imports.add(`${JAKARTA}.NotNull`);
        return ['@NotNull'];
      })();
      fields.push({ type, name: input.name, annotations: requiredAnnotations });
    } else {
      // String / other filter params
      const propDef = propMap.get(input.name);
      const requiredAnnotations = isOptional ? [] : (() => {
        imports.add(`${JAKARTA}.NotBlank`);
        return ['@NotBlank'];
      })();
      const typeAnnotations = getTypeValidationAnnotations(type, imports);
      const { annotations: dslAnnotations, imports: dslImports } =
        mapDslValidations(propDef ? propDef.validations : [], type);
      for (const imp of dslImports) imports.add(imp);
      const mergedAnnotations = mergeAnnotations(typeAnnotations, dslAnnotations);
      fields.push({ type: 'String', name: input.name, annotations: [...requiredAnnotations, ...mergedAnnotations] });
    }
  }

  // [G7] Declarative pagination — when uc.pagination is declared, ensure the Query
  // record exposes int page, int size, String sortBy, String sortDirection. Existing
  // page/size inputs are honoured (already added above); sortBy/sortDirection are
  // synthesised so the YAML does not need to declare them explicitly.
  if (uc.pagination) {
    const existing = new Set(fields.map((f) => f.name));
    if (!existing.has('page')) fields.push({ type: 'int', name: 'page', annotations: [] });
    if (!existing.has('size')) fields.push({ type: 'int', name: 'size', annotations: [] });
    if (!existing.has('sortBy')) fields.push({ type: 'String', name: 'sortBy', annotations: [] });
    if (!existing.has('sortDirection')) fields.push({ type: 'String', name: 'sortDirection', annotations: [] });
  }

  return { fields, imports: [...imports] };
}

// ─── Query return type ────────────────────────────────────────────────────────

function buildQueryReturnType(uc, agg, repoMethods) {
  const raw = uc.returns;
  if (!raw) return `${agg.name}ResponseDto`;

  // [G12] BinaryStream → Resource (Spring core io).
  if (raw === 'BinaryStream') return 'Resource';

  // Normalize OpenAPI schema name → Java class name.
  // Any *Response schema becomes *ResponseDto (covers aggregate responses like CategoryResponse
  // and custom internal-API schemas like OrderTotalResponse).
  // Bare aggregate name (e.g. "Order") also maps to its main ResponseDto.
  const normalize = (name) => {
    if (name === agg.name) return `${agg.name}ResponseDto`;
    if (name.endsWith('Response')) return `${name}Dto`;
    return name;
  };

  // Page[SomeDto] → PagedResponse<SomeDto>
  const pageMatch = /^Page\[(.+)\]$/.exec(raw);
  if (pageMatch) return `PagedResponse<${normalize(pageMatch[1])}>`;
  // List[SomeDto] → List<SomeDto>
  const listMatch = /^List\[(.+)\]$/.exec(raw);
  if (listMatch) return `List<${normalize(listMatch[1])}>`;
  // [G24] Optional[SomeDto] → Optional<SomeDto>
  const optMatch = /^Optional\[(.+)\]$/.exec(raw);
  if (optMatch) return `Optional<${normalize(optMatch[1])}>`;
  // [G4] canonical scalar return type (Uuid→UUID, Decimal→BigDecimal, etc.)
  const canonical = resolveCanonicalReturnType(raw);
  if (canonical) return canonical.javaType;
  // Bare DTO name (e.g. ProductResponse → ProductResponseDto)
  return normalize(raw);
}

// ─── Is sub-entity query? ─────────────────────────────────────────────────────

/**
 * Returns true when a query UC is about a nested entity rather than the aggregate root.
 * In this case we cannot auto-generate a correct body — generate scaffold instead.
 */
function isSubEntityQuery(uc, agg) {
  const ucNameLower = uc.name.toLowerCase();
  for (const entity of agg.entities || []) {
    if (ucNameLower.includes(entity.name.toLowerCase())) return true;
  }
  return false;
}

// ─── Command handler body ─────────────────────────────────────────────────────

/**
 * [G3] Appends an ownership guard to the lines[] when uc.authorization.ownership
 * is declared. The guard compares the loaded aggregate's `field` against the JWT
 * claim resolved via SecurityContextUtil, and throws ForbiddenException when the
 * caller is neither the owner nor a member of allowRoleBypass[].
 *
 * Mutates `lines` and `extraImports` in place. No-op when no ownership block is
 * declared.
 */
function appendOwnershipGuard(lines, extraImports, uc, aggVarName, packageName) {
  const ownership = uc && uc.authorization && uc.authorization.ownership;
  if (!ownership) return;
  const { field, claim } = ownership;
  const bypass = ownership.allowRoleBypass || [];
  extraImports.add(`${packageName}.shared.infrastructure.security.SecurityContextUtil`);
  extraImports.add(`${packageName}.shared.domain.customExceptions.ForbiddenException`);
  extraImports.add('java.util.Objects');
  const bypassExpr = bypass.length > 0
    ? ` && !SecurityContextUtil.hasAnyRole(${bypass.map((r) => `"${r.replace(/^ROLE_/, '')}"`).join(', ')})`
    : '';
  const getter = `get${field.charAt(0).toUpperCase() + field.slice(1)}`;
  lines.push(`        // [G3] Ownership guard — derived_from: useCases[${uc.id}].authorization`);
  lines.push(`        if (!Objects.equals(String.valueOf(${aggVarName}.${getter}()), SecurityContextUtil.currentUserClaim("${claim}"))${bypassExpr}) {`);
  lines.push(`            throw new ForbiddenException("Access denied: you do not own this resource.");`);
  lines.push(`        }`);
}

// When the error has constructor args, `ErrorType::new` is not a valid Supplier<T>
// (Supplier requires a no-arg functional interface). Emit a lambda instead.
// rawExpr:  the raw String input expression  (e.g. command.productId())
// uuidExpr: the UUID expression              (e.g. UUID.fromString(command.productId()))
// The first arg's declared type decides which expression to use.
function buildOrElseThrowExpr(errorType, errorEntry, rawExpr, uuidExpr) {
  const args = Array.isArray(errorEntry?.args) ? errorEntry.args : [];
  if (args.length === 0) return `orElseThrow(${errorType}::new)`;
  const STRING_TYPES = new Set(['String', 'Email', 'Url', 'Text']);
  function exprForArg(a, i) {
    if (i !== 0) return `null /* TODO: supply ${a.name} (${a.type}) */`;
    return STRING_TYPES.has(a.type) ? rawExpr : uuidExpr;
  }
  const argExprs = args.map((a, i) => exprForArg(a, i)).join(', ');
  return `orElseThrow(() -> new ${errorType}(${argExprs}))`;
}

// Returns a "throw new ErrorType(args)" expression, resolving constructor args from errorEntry.
function buildThrowNewExpr(errorType, errorEntry, rawExpr, uuidExpr) {
  const args = Array.isArray(errorEntry?.args) ? errorEntry.args : [];
  if (args.length === 0) return `throw new ${errorType}()`;
  const STRING_TYPES = new Set(['String', 'Email', 'Url', 'Text']);
  function exprForArg(a, i) {
    if (i !== 0) return `null /* TODO: supply ${a.name} (${a.type}) */`;
    return STRING_TYPES.has(a.type) ? rawExpr : uuidExpr;
  }
  const argExprs = args.map((a, i) => exprForArg(a, i)).join(', ');
  return `throw new ${errorType}(${argExprs})`;
}

function commandUuidExpr(inputOrParam, uc) {
  const rawExpr = `command.${inputOrParam.name}()`;
  const eventTriggered = !!(uc && uc.trigger && uc.trigger.kind === 'event');
  return inputOrParam.type === 'Uuid' && eventTriggered ? rawExpr : `UUID.fromString(${rawExpr})`;
}

function resolveCommandInputForDomainParam(param, uc, aggregateDef) {
  const inputs = uc.input || [];
  const byName = new Map(inputs.map((input) => [input.name, input]));
  if (byName.has(param.name)) return byName.get(param.name);

  const explicitName = param.input || param.inputName || param.sourceInput || param.field;
  if (explicitName && byName.has(explicitName)) return byName.get(explicitName);

  const candidates = [];
  const aggregatePrefix = toCamelCase(aggregateDef?.name || '');
  if (aggregatePrefix && param.name.startsWith(aggregatePrefix) && param.name.length > aggregatePrefix.length) {
    const rest = param.name.slice(aggregatePrefix.length);
    if (/^[A-Z]/.test(rest)) candidates.push(rest.charAt(0).toLowerCase() + rest.slice(1));
  }
  for (const entity of aggregateDef?.entities || []) {
    const entityCamel = toCamelCase(entity.name);
    if (param.name === `${entityCamel}Id` && entityCamel.startsWith(aggregatePrefix)) {
      const rest = entityCamel.slice(aggregatePrefix.length);
      if (rest) candidates.push(`${rest.charAt(0).toLowerCase() + rest.slice(1)}Id`);
    }
  }

  for (const candidate of candidates) {
    if (byName.has(candidate)) return byName.get(candidate);
  }

  return null;
}

function buildCommandHandlerBody(uc, agg, errorMap, packageName, moduleName, bcYaml) {
  const lines = [];
  const extraImports = new Set();

  const isCreate = uc.method === 'create';
  // Event-triggered commands keep the domain VO type on their fields (buildCommandFields
  // skips the {Vo}Request interposition when isEventTriggered), so the handler must NOT
  // re-assemble them — passing command.field() directly is correct. Only HTTP commands
  // carry a {Vo}Request that needs `new Vo(req.a(), req.b())`.
  const isEventTriggered = !!(uc.trigger && uc.trigger.kind === 'event');
  const aggVarName = toCamelCase(agg.name);
  const repoFieldName = `${aggVarName}Repository`;

  extraImports.add('java.util.UUID');
  extraImports.add(`${packageName}.${moduleName}.domain.aggregate.${agg.name}`);

  // Load aggregate (for non-create operations) — find the input with loadAggregate: true
  const loadAggInput = (uc.input || []).find((i) => i.loadAggregate === true);
  // [Phase 3, Gap E8] lookups[] supersedes notFoundError. Resolve the primary
  // lookup (one that drives findById.orElseThrow) and surface additional
  // lookups as enriched TODOs.
  const primaryNotFound = resolvePrimaryNotFoundError(uc);
  const hasNotFoundError = primaryNotFound != null;

  if (!isCreate && loadAggInput && hasNotFoundError) {
    const errorEntry = errorMap[primaryNotFound];
    const errorType = errorEntry ? errorEntry.errorType : 'NotFoundException';
    extraImports.add(`${packageName}.${moduleName}.domain.errors.${errorType}`);
    const rawCmdExpr = `command.${loadAggInput.name}()`;
    const uuidCmdExpr = commandUuidExpr(loadAggInput, uc);
    lines.push(
      `        ${agg.name} ${aggVarName} = ${repoFieldName}.findById(${uuidCmdExpr}).${buildOrElseThrowExpr(errorType, errorEntry, rawCmdExpr, uuidCmdExpr)};`
    );
  }

  // [Phase 3, Gap E8] Additional lookups → enriched TODO with the exact class.
  for (const lk of additionalLookups(uc)) {
    const errorEntry = errorMap[lk.errorCode];
    const errorType = errorEntry ? errorEntry.errorType : lk.errorCode;
    extraImports.add(`${packageName}.${moduleName}.domain.errors.${errorType}`);
    if (lk.nestedIn) {
      lines.push(`        // TODO useCase(${uc.id}, lookup:${lk.param}): locate the ${lk.nestedIn} entry matching command.${lk.param}() and throw new ${errorType}() if missing.`);
    } else {
      const lkRepo = `${toCamelCase(lk.aggregate)}Repository`;
      lines.push(`        // TODO useCase(${uc.id}, lookup:${lk.param}): ${lkRepo}.findById(UUID.fromString(command.${lk.param}())).orElseThrow(${errorType}::new);`);
    }
  }

  // [G3] Ownership guard — runs after the aggregate is loaded.
  appendOwnershipGuard(lines, extraImports, uc, aggVarName, packageName);

  // FK validations — local repos check via findById; cross-BC ports check via existsX (G13).
  for (const fk of uc.fkValidations || []) {
    const fkErrorCode = fk.error || fk.notFoundError; // support both schemas
    const fkErrorEntry = fkErrorCode ? errorMap[fkErrorCode] : null;
    const fkErrorType = fkErrorEntry ? fkErrorEntry.errorType : 'NotFoundException';
    const fkParam = fk.param || fk.field; // support both schemas
    const fkAggregate = fk.aggregate || fk.references;
    if (!fkAggregate) continue;
    const fkRawExpr = `command.${fkParam}()`;
    const fkInput = (uc.input || []).find((input) => input.name === fkParam);
    const fkUuidExpr = commandUuidExpr({ name: fkParam, type: fkInput ? fkInput.type : 'String' }, uc);
    const isConditionalFk = fk.conditional === true || fkInput?.required === false;
    const appendFkLine = (line) => {
      if (isConditionalFk) {
        lines.push(`        if (${fkRawExpr} != null) {`);
        lines.push(`    ${line}`);
        lines.push('        }');
      } else {
        lines.push(line);
      }
    };
    if (hasLocalReadModel(fk, bcYaml || { bc: moduleName, aggregates: [] })) {
      const fkRepoFieldName = `${toCamelCase(fkAggregate)}Repository`;
      extraImports.add(`${packageName}.${moduleName}.domain.errors.${fkErrorType}`);
      appendFkLine(
        `        if (${fkRepoFieldName}.findById(${fkUuidExpr}).isEmpty()) ${buildThrowNewExpr(fkErrorType, fkErrorEntry, fkRawExpr, fkUuidExpr)};`
      );
    } else if (fk.bc) {
      // [G13] Cross-BC FK without local read model — invoke ServicePort.existsX(UUID).
      const portFieldName = `${toCamelCase(fk.bc)}ServicePort`;
      const methodName = `exists${fkAggregate}`;
      extraImports.add(`${packageName}.${moduleName}.domain.errors.${fkErrorType}`);
      appendFkLine(
        `        if (!${portFieldName}.${methodName}(${fkUuidExpr})) ${buildThrowNewExpr(fkErrorType, fkErrorEntry, fkRawExpr, fkUuidExpr)};`
      );
    }
  }

  // Resolve domainMethod params to build the call args
  const aggDef = (bcYaml?.aggregates || []).find((a) => a.name === agg.name);
  const dm = (aggDef?.domainMethods || []).find((m) => m.name === uc.method);
  // Prefer explicit params[]; fall back to parsing signature: string when params[] is absent.
  let dmParams = dm?.params || [];
  if (dmParams.length === 0 && dm?.signature) {
    const parsedSig = parseMethodSignature(dm.signature);
    if (parsedSig && parsedSig.params && parsedSig.params.length > 0) {
      dmParams = parsedSig.params.map((p) => ({ name: p.name, type: p.typeHint || null }));
    }
  }

  const callArgs = [];
  const ucInputByName = new Map((uc.input || []).map((input) => [input.name, input]));

  if (isCreate && dmParams.length === 0) {
    // Bare 'create' with no explicit params — derive args from uc.input[] (exclude loadAggregate inputs)
    for (const input of (uc.input || [])) {
      if (input.source === 'authContext') {
        extraImports.add('org.springframework.security.core.context.SecurityContextHolder');
        callArgs.push(`UUID.fromString(SecurityContextHolder.getContext().getAuthentication().getName())`);
        continue;
      }
      // Check for List[MultiPropVO] — convert List<VoRequest> → List<DomainVo>
      const listInnerMatchI = /^List\[(.+)\]$/.exec(input.type);
      const listInnerVoNameI = listInnerMatchI ? listInnerMatchI[1] : null;
      const listInnerVoDefI = (!isEventTriggered && listInnerVoNameI)
        ? resolveMultiPropertyVo(listInnerVoNameI, bcYaml)
        : null;
      // Resolve declared AND canonical (e.g. Money) multi-prop VOs so the command's
      // {Vo}Request field is re-assembled into the domain VO instead of passed raw.
      // Skip for event-triggered commands — their field is already the domain VO.
      const inputVoDef = isEventTriggered ? null : resolveMultiPropertyVo(input.type, bcYaml);
      if (listInnerVoDefI) {
        extraImports.add(`${packageName}.${moduleName}.domain.valueobject.${listInnerVoNameI}`);
        const ctorArgs = listInnerVoDefI.properties.map((p) => `r.${p.name}()`).join(', ');
        callArgs.push(`command.${input.name}().stream().map(r -> new ${listInnerVoNameI}(${ctorArgs})).toList()`);
      } else if (inputVoDef) {
        extraImports.add(`${packageName}.${moduleName}.domain.valueobject.${input.type}`);
        const propGetters = inputVoDef.properties.map((p) => `command.${input.name}().${p.name}()`).join(', ');
        callArgs.push(`new ${input.type}(${propGetters})`);
      } else if (input.type === 'Uuid') {
        callArgs.push(commandUuidExpr(input, uc));
      } else if (input.type === 'Url') {
        extraImports.add('java.net.URI');
        callArgs.push(`URI.create(command.${input.name}())`);
      } else {
        callArgs.push(`command.${input.name}()`);
      }
    }
  } else {
    // Use domainMethod params as the source of truth for the call args
    for (const p of dmParams) {
      const authContextArg = buildAuthContextQueryArg(p, ucInputByName, extraImports, packageName);
      if (authContextArg) {
        callArgs.push(authContextArg);
        continue;
      }
      // If the matching aggregate property declares source: authContext, inject from SecurityContext.
      const aggPropDef = (aggDef?.properties || []).find((prop) => prop.name === p.name);
      if (aggPropDef?.source === 'authContext') {
        extraImports.add(`${packageName}.shared.infrastructure.security.SecurityContextUtil`);
        extraImports.add('java.util.UUID');
        callArgs.push(`UUID.fromString(SecurityContextUtil.currentUserClaim("sub"))`);
        continue;
      }
      const commandInput = resolveCommandInputForDomainParam(p, uc, aggDef);
      const commandParam = commandInput ? { ...p, name: commandInput.name, type: commandInput.type || p.type } : p;
      // Check for List[MultiPropVO] — convert List<VoRequest> → List<DomainVo>
      const listInnerMatchP = /^List\[(.+)\]$/.exec(p.type);
      const listInnerVoNameP = listInnerMatchP ? listInnerMatchP[1] : null;
      const listInnerVoDefP = (!isEventTriggered && listInnerVoNameP)
        ? resolveMultiPropertyVo(listInnerVoNameP, bcYaml)
        : null;
      const paramVoDef = isEventTriggered ? null : resolveMultiPropertyVo(p.type, bcYaml);
      if (listInnerVoDefP) {
        extraImports.add(`${packageName}.${moduleName}.domain.valueobject.${listInnerVoNameP}`);
        const ctorArgs = listInnerVoDefP.properties.map((prop) => `r.${prop.name}()`).join(', ');
        callArgs.push(`command.${commandParam.name}().stream().map(r -> new ${listInnerVoNameP}(${ctorArgs})).toList()`);
      } else if (paramVoDef) {
        extraImports.add(`${packageName}.${moduleName}.domain.valueobject.${p.type}`);
        const propGetters = paramVoDef.properties.map((prop) => `command.${commandParam.name}().${prop.name}()`).join(', ');
        callArgs.push(`new ${p.type}(${propGetters})`);
      } else if (p.type === 'Uuid') {
        callArgs.push(commandUuidExpr(commandParam, uc));
      } else if (p.type === 'Url') {
        extraImports.add('java.net.URI');
        callArgs.push(`URI.create(command.${commandParam.name}())`);
      } else {
        callArgs.push(`command.${commandParam.name}()`);
      }
    }
  }

  // ── Domain rules: emit checks declared in the UC.rules whitelist ─────────
  // The mapper is conservative — rules without executable hints become TODO
  // comments (no inference). Returns extra repos that must be added to the
  // handler's constructor by the caller (via the returned `extraRepos`).
  const aggregateDef = (bcYaml?.aggregates || []).find((a) => a.name === agg.name);
  const aggregateRules = (aggregateDef?.domainRules || []);
  const ucRuleIds = new Set(uc.rules || []);
  const extraRepos = [];
  const seenRepoNames = new Set();
  for (const rule of aggregateRules) {
    if (!ucRuleIds.has(rule.id)) continue;
    const ruleCtx = {
      uc,
      agg,
      aggVarName,
      errorMap,
      packageName,
      moduleName,
      bcYaml,
      isCreate,
    };
    const result = mapRule(rule, ruleCtx);
    if (!result || !result.lines || result.lines.length === 0) continue;
    for (const line of result.lines) lines.push(line);
    for (const imp of result.extraImports || []) extraImports.add(imp);
    for (const r of result.extraRepos || []) {
      if (seenRepoNames.has(r.repoFieldName)) continue;
      seenRepoNames.add(r.repoFieldName);
      extraRepos.push(r);
    }
  }

  // Domain method invocation
  if (isCreate) {
    // Early-identity: the aggregate id is generated at the controller and travels
    // in the command as its first component. Pass it as the first factory/ctor
    // argument so the domain receives identity instead of generating it.
    const createArgs = [`command.id()`, ...callArgs];
    const hasStaticFactory = dm && dm.returns === agg.name;
    const factoryCall = hasStaticFactory
      ? `${agg.name}.create(${createArgs.join(', ')})`
      : `new ${agg.name}(${createArgs.join(', ')})`;
    lines.push(`        ${agg.name} ${aggVarName} = ${factoryCall};`);
  } else {
    // When the UC method is "delete" on a softDelete aggregate, invoke softDelete() in the domain
    const effectiveMethod =
      uc.method === 'delete' && agg.softDelete === true ? 'softDelete' : uc.method;
    // The aggregate variable is only declared when the findById block above ran.
    // If neither loadAggInput nor hasNotFoundError is set (e.g. readModel upsert with no
    // notFoundError), aggVarName is undefined — fall back to scaffold to avoid broken code.
    const aggWasDeclared = loadAggInput && hasNotFoundError;
    if (aggWasDeclared) {
      if (uc.method === 'delete' && !agg.softDelete) {
        // Physical delete — call repository.delete(id) directly; no domain method exists.
        lines.push(`        ${repoFieldName}.delete(${aggVarName}.getId());`);
      } else {
        lines.push(`        ${aggVarName}.${effectiveMethod}(${callArgs.join(', ')});`);
      }
    } else {
      lines.push(`        // TODO: load ${agg.name} (e.g. by unique key) then call .${effectiveMethod}(${callArgs.join(', ') || '...'}) — see ${moduleName}-flows.md`);
      lines.push(`        throw new UnsupportedOperationException("Not implemented: ${uc.id} ${uc.name}");`);
      extraImports.add('java.lang.UnsupportedOperationException');
    }
  }

  // Save — only emit when the aggregate variable was actually declared.
  // Physical deletes call repository.delete() above — skip save.
  const isPhysicalDelete = uc.method === 'delete' && !agg.softDelete;
  const aggWasDeclaredForSave = !isPhysicalDelete && (isCreate || (loadAggInput && hasNotFoundError));
  if (aggWasDeclaredForSave) {
    lines.push(`        ${repoFieldName}.save(${aggVarName});`);
  }

  return { body: lines.join('\n'), extraImports: [...extraImports].sort(), extraRepos };
}

/**
 * [Phase 3 #2 + #8] Build a guided scaffold body for a command handler whose UC
 * is `implementation: scaffold`.
 *
 * Returns:
 *   - stepsBlock: numbered `// N. ...` comments (8-space indented) reflecting the
 *     execution order the implementer must follow — load → lookups → FK checks →
 *     domain rules → domain method → save. Rendered before the TODO + throw.
 *   - extraRepos: cross-aggregate repositories required by the UC's domainRules
 *     (deleteGuard / crossAggregateConstraint), so the handler constructor is
 *     wired correctly even though the body is not implemented yet.
 *
 * No executable Java (and therefore no extra imports) is emitted: the repository
 * imports are added by the template's fkRepos loop, and the own-aggregate repo by
 * `injectRepository`.
 */
function buildScaffoldHandlerGuide(uc, agg, errorMap, packageName, moduleName, bcYaml) {
  const steps = [];
  const extraRepos = [];
  const seenRepo = new Set();
  const aggVarName = toCamelCase(agg.name);
  const repoFieldName = `${aggVarName}Repository`;
  const isCreate = uc.method === 'create';
  const hasOwnRepository = (bcYaml?.repositories || []).some((r) => r.aggregate === agg.name);
  let n = 1;
  const step = (text) => steps.push(`        // ${n++}. ${text}`);

  // 1. Load or build the aggregate (repository-dependent steps require a repo)
  const loadAggInput = (uc.input || []).find((i) => i.loadAggregate === true);
  const primaryNotFound = resolvePrimaryNotFoundError(uc);
  const aggLoaded = !isCreate && loadAggInput && primaryNotFound && hasOwnRepository;
  if (isCreate) {
    step(`Build the ${agg.name} aggregate (${agg.name}.create(...) / new ${agg.name}(...))`);
  } else if (aggLoaded) {
    const errEntry = errorMap[primaryNotFound];
    const errType = errEntry ? errEntry.errorType : primaryNotFound;
    step(`Load ${agg.name} via ${repoFieldName}.findById(...) (throws ${errType})`);
  } else if (uc.method && hasOwnRepository) {
    step(`Load the ${agg.name} (e.g. by unique key) for .${uc.method}(...)`);
  }

  // 2. Additional lookups
  for (const lk of additionalLookups(uc)) {
    const errEntry = errorMap[lk.errorCode];
    const errType = errEntry ? errEntry.errorType : lk.errorCode;
    step(`Lookup "${lk.param}" (throws ${errType})`);
  }

  // 3. FK validations
  for (const fk of (uc.fkValidations || [])) {
    const fkAgg = fk.aggregate || fk.references;
    if (!fkAgg) continue;
    const fkErr = fk.error || fk.notFoundError;
    const fkErrEntry = fkErr ? errorMap[fkErr] : null;
    const fkErrType = fkErrEntry ? fkErrEntry.errorType : (fkErr || 'NotFound');
    step(`FK validation: ${fkAgg} exists for "${fk.param || fk.field}" (throws ${fkErrType})`);
  }

  // 4. Domain rules — run the rule-mapper to collect cross-aggregate repos and
  //    to surface each rule at its correct enforcement site.
  const aggregateDef = (bcYaml?.aggregates || []).find((a) => a.name === agg.name);
  const ucRuleIds = new Set(uc.rules || []);
  for (const rule of (aggregateDef?.domainRules || [])) {
    if (!ucRuleIds.has(rule.id)) continue;
    const result = mapRule(rule, {
      uc, agg, aggVarName, errorMap, packageName, moduleName, bcYaml, isCreate,
    });
    for (const r of (result.extraRepos || [])) {
      if (seenRepo.has(r.repoFieldName)) continue;
      seenRepo.add(r.repoFieldName);
      extraRepos.push(r);
    }
    const desc = rule.description ? rule.description.trim() : '';
    if (rule.type === 'terminalState') {
      step(`domainRule(${rule.id}, terminalState): enforced by ${aggVarName}.${uc.method || 'method'}()`);
    } else if (rule.type === 'sideEffect') {
      step(`domainRule(${rule.id}, sideEffect): ${desc}`);
    } else {
      // [Phase 3 #1B] When the rule was resolved to an enforcement method via a
      // repository.method.derivedFrom trace, name it so the Phase 3 implementer
      // knows which injected repository call enforces the rule.
      const via = (result.extraRepos || []).filter((r) => r.viaMethod);
      const viaTxt = via.length
        ? ` — enforce via ${via.map((r) => `${r.repoFieldName}.${r.viaMethod}(...)`).join(', ')}`
        : '';
      step(`domainRule(${rule.id}, ${rule.type}): ${desc || 'enforce before invoking the domain method'}${viaTxt}`);
    }
  }

  // 5. Domain method invocation
  if (!isCreate && uc.method) {
    const effectiveMethod = uc.method === 'delete' && agg.softDelete === true ? 'softDelete' : uc.method;
    if (uc.method === 'delete' && !agg.softDelete && hasOwnRepository) {
      step(`${repoFieldName}.delete(${aggVarName}.getId())`);
    } else {
      step(`${aggVarName}.${effectiveMethod}(...)`);
    }
  }

  // 6. Save (skip for physical delete, already covered above; requires a repo)
  const isPhysicalDelete = uc.method === 'delete' && !agg.softDelete;
  if (hasOwnRepository && !isPhysicalDelete && (isCreate || aggLoaded)) {
    step(`${repoFieldName}.save(${aggVarName})`);
  }

  return { stepsBlock: steps.join('\n'), extraRepos };
}

// ─── Query handler body ───────────────────────────────────────────────────────

function buildQueryHandlerBody(uc, agg, repoMethods, errorMap, packageName, moduleName, projection = null, bcYaml = null) {
  const lines = [];
  const extraImports = new Set();

  const aggVarName = toCamelCase(agg.name);
  const repoFieldName = `${aggVarName}Repository`;
  const mapperFieldName = `${aggVarName}ApplicationMapper`;

  const notFoundErrors = normalizeNotFoundErrors(uc.notFoundError);
  const hasNotFoundError = notFoundErrors.length > 0;
  // [Phase 3, Gap E8] lookups[] supersedes notFoundError for primary lookup.
  const primaryNotFound = resolvePrimaryNotFoundError(uc);
  const hasPrimary = primaryNotFound != null;
  // Surface additional lookups as enriched TODOs (the query handler may load
  // related entities for an enriched response, similar to commands).
  for (const lk of additionalLookups(uc)) {
    const errorEntry = errorMap[lk.errorCode];
    const errorType = errorEntry ? errorEntry.errorType : lk.errorCode;
    extraImports.add(`${packageName}.${moduleName}.domain.errors.${errorType}`);
    if (lk.nestedIn) {
      lines.push(`        // TODO useCase(${uc.id}, lookup:${lk.param}): locate the ${lk.nestedIn} entry matching query.${lk.param}() and throw new ${errorType}() if missing.`);
    } else {
      const lkRepo = `${toCamelCase(lk.aggregate)}Repository`;
      lines.push(`        // TODO useCase(${uc.id}, lookup:${lk.param}): ${lkRepo}.findById(UUID.fromString(query.${lk.param}())).orElseThrow(${errorType}::new);`);
    }
  }

  extraImports.add('java.util.UUID');
  extraImports.add(`${packageName}.${moduleName}.domain.aggregate.${agg.name}`);

  // When the return is a projection, we map domain → projection via mapper.to<Projection>()
  // instead of mapper.toResponseDto(). The mapper is generated alongside (G2).
  const mapperSingleMethod = projection ? `to${projection.name}` : 'toResponseDto';

  // ── Path A: loadAggregate: true → findById ──────────────────────────────────
  const loadAggInput = (uc.input || []).find((i) => i.loadAggregate === true);
  const returnTypeStr = uc.returns || `${agg.name}ResponseDto`;
  const isPaged = isPagedReturnType(returnTypeStr);
  const isList = !isPaged && /^List\[/.test(returnTypeStr);
  const isOptional = !isPaged && !isList && isOptionalReturnType(returnTypeStr);

  if (loadAggInput) {
    // Path A: single entity by ID
    const hasOwnership = !!(uc.authorization && uc.authorization.ownership);
    if (isOptional && !hasOwnership) {
      // [G24] Optional[X] semantics: do not throw when missing — let the
      // controller translate the empty Optional into a 404 response.
      extraImports.add('java.util.Optional');
      lines.push(
        `        return ${repoFieldName}.findById(UUID.fromString(query.${loadAggInput.name}())).map(${mapperFieldName}::${mapperSingleMethod});`
      );
      return { body: lines.join('\n'), extraImports: [...extraImports].sort() };
    }
    const errorEntry = hasPrimary ? errorMap[primaryNotFound] : null;
    const errorType = errorEntry ? errorEntry.errorType : null;
    if (errorType) {
      extraImports.add(`${packageName}.${moduleName}.domain.errors.${errorType}`);
      const rawQExpr = `query.${loadAggInput.name}()`;
      const uuidQExpr = `UUID.fromString(${rawQExpr})`;
      lines.push(
        `        ${agg.name} ${aggVarName} = ${repoFieldName}.findById(${uuidQExpr}).${buildOrElseThrowExpr(errorType, errorEntry, rawQExpr, uuidQExpr)};`
      );
    } else {
      lines.push(
        `        ${agg.name} ${aggVarName} = ${repoFieldName}.findById(UUID.fromString(query.${loadAggInput.name}())).orElseThrow();`
      );
    }
    // [G3] Ownership guard after load.
    appendOwnershipGuard(lines, extraImports, uc, aggVarName, packageName);
    if (isOptional) {
      // Ownership-protected Optional[X]: load+guard force orElseThrow path; wrap result in Optional.of.
      extraImports.add('java.util.Optional');
      lines.push(`        return Optional.of(${mapperFieldName}.${mapperSingleMethod}(${aggVarName}));`);
    } else {
      lines.push(`        return ${mapperFieldName}.${mapperSingleMethod}(${aggVarName});`);
    }
    return { body: lines.join('\n'), extraImports: [...extraImports].sort() };
  }

  // ── Path B: find queryMethod by operationId or param match ──────────────────
  const operationId = uc.trigger?.operationId;
  const aggRepoMethods = repoMethods[agg.name] || {};

  // Primary: match by derivedFrom: openapi:{operationId}
  let repoMethodName = null;
  let methodParams = [];

  // Find the queryMethod entry that has derivedFrom matching this operationId
  // repoMethods stores params per method name; we need the original repo to find derivedFrom
  // So we do a secondary lookup — repoMethods already merged queryMethods so scan by name match
  // Strategy: find the method whose params names match uc.input names
  const inputNames = new Set((uc.input || []).filter((i) => i.name !== 'page' && i.name !== 'size').map((i) => i.name));
  const hasPaging = (uc.input || []).some((i) => i.name === 'page' || i.name === 'size');

  // First: try exact param-name match
  for (const [methodName, params] of Object.entries(aggRepoMethods)) {
    if (methodName === 'findById' || methodName === 'save' || methodName === 'delete') continue;
    const repoParamNames = new Set(
      params.filter((p) => p.name !== 'page' && p.name !== 'size' && p.type !== 'PageRequest' && p.type !== 'Pageable').map((p) => p.name)
    );
    const allMatch = [...inputNames].every((n) => repoParamNames.has(n));
    if (allMatch && (hasPaging || repoParamNames.size === inputNames.size)) {
      repoMethodName = methodName;
      methodParams = params;
      break;
    }
  }

  // Fallback: first list/findAll method for this aggregate
  if (!repoMethodName) {
    for (const [methodName, params] of Object.entries(aggRepoMethods)) {
      if (methodName.startsWith('list') || methodName.startsWith('findAll')) {
        repoMethodName = methodName;
        methodParams = params;
        break;
      }
    }
  }

  if (!repoMethodName) {
    // No matching repo method — scaffold
    lines.push(`        // TODO: implement query logic`);
    lines.push(`        throw new UnsupportedOperationException("Not implemented yet");`);
    return { body: lines.join('\n'), extraImports: [...extraImports].sort() };
  }

  if (isList && !isPaged) {
    extraImports.add('java.util.List');
    const callArgs = buildListCallArgs(methodParams, extraImports, packageName, uc);
    lines.push(
      `        List<${agg.name}> entities = ${repoFieldName}.${repoMethodName}(${callArgs});`
    );
    lines.push(
      `        return entities.stream().map(${mapperFieldName}::${mapperSingleMethod}).toList();`
    );
  } else if (isPaged) {
    extraImports.add('org.springframework.data.domain.Page');
    extraImports.add('org.springframework.data.domain.PageRequest');
    extraImports.add(`${packageName}.shared.application.dtos.PagedResponse`);

    const callArgs = buildPagedCallArgs(methodParams, agg, packageName, moduleName, extraImports, uc, bcYaml);
    lines.push(
      `        Page<${agg.name}> page = ${repoFieldName}.${repoMethodName}(${callArgs});`
    );
    lines.push(
      `        return PagedResponse.of(page.getContent().stream().map(${mapperFieldName}::${mapperSingleMethod}).toList(), query.page(), query.size(), page.getTotalElements());`
    );
  } else {
    // Single entity via non-loadAggregate path (findBy{Field})
    const callArgs = buildListCallArgs(methodParams, extraImports, packageName, uc);
    if (isOptional) {
      // [G24] Optional[X]: do not throw — let the controller produce 200/404.
      extraImports.add('java.util.Optional');
      lines.push(
        `        return ${repoFieldName}.${repoMethodName}(${callArgs}).map(${mapperFieldName}::${mapperSingleMethod});`
      );
      return { body: lines.join('\n'), extraImports: [...extraImports].sort() };
    }
    const errorEntry = hasPrimary ? errorMap[primaryNotFound] : null;
    const errorType = errorEntry ? errorEntry.errorType : null;
    if (errorType) {
      extraImports.add(`${packageName}.${moduleName}.domain.errors.${errorType}`);
      // For path B (findBy{Field}), derive raw/uuid expressions from the first method param.
      const firstParam = methodParams[0];
      const pathBRawExpr = firstParam ? `query.${firstParam.name}()` : callArgs;
      const pathBUuidExpr = (firstParam?.type === 'Uuid') ? `UUID.fromString(${pathBRawExpr})` : pathBRawExpr;
      lines.push(
        `        ${agg.name} entity = ${repoFieldName}.${repoMethodName}(${callArgs}).${buildOrElseThrowExpr(errorType, errorEntry, pathBRawExpr, pathBUuidExpr)};`
      );
    } else {
      lines.push(
        `        ${agg.name} entity = ${repoFieldName}.${repoMethodName}(${callArgs}).orElseThrow();`
      );
    }
    lines.push(`        return ${mapperFieldName}.${mapperSingleMethod}(entity);`);
  }

  return { body: lines.join('\n'), extraImports: [...extraImports].sort() };
}

function buildAuthContextQueryArg(param, ucInputByName, imports, packageName) {
  const input = ucInputByName.get(param.name);
  if (!input || input.source !== 'authContext') return null;
  imports.add(`${packageName}.shared.infrastructure.security.SecurityContextUtil`);
  if (param.type === 'Uuid') {
    imports.add('java.util.UUID');
    return `UUID.fromString(SecurityContextUtil.currentUserClaim("sub"))`;
  }
  return `SecurityContextUtil.currentUserClaim("sub")`;
}

function buildListCallArgs(methodParams, imports, packageName, uc = null) {
  const args = [];
  const ucInputByName = new Map(((uc && uc.input) || []).map((i) => [i.name, i]));
  for (const param of methodParams) {
    const authContextArg = buildAuthContextQueryArg(param, ucInputByName, imports, packageName);
    if (authContextArg) {
      args.push(authContextArg);
      continue;
    }
    if (param.type === 'Uuid') {
      imports.add('java.util.UUID');
      args.push(`UUID.fromString(query.${param.name}())`);
    } else {
      args.push(`query.${param.name}()`);
    }
  }
  return args.join(', ');
}

function buildPagedCallArgs(methodParams, agg, packageName, moduleName, imports, uc = null, bcYaml = null) {
  const args = [];
  // [G5] Inputs declared with enum type are bound by Spring directly to the enum field
  // on the Query record — no Enum.valueOf needed in handler.
  const enumNamesSet = new Set((bcYaml?.enums || []).map((e) => e.name));
  const ucInputByName = new Map(((uc && uc.input) || []).map((i) => [i.name, i]));
  // [G7] When uc.pagination is declared, PageRequest is built with explicit Sort.
  const hasPagination = !!(uc && uc.pagination);
  for (const param of methodParams) {
    const authContextArg = buildAuthContextQueryArg(param, ucInputByName, imports, packageName);
    if (authContextArg) {
      args.push(authContextArg);
      continue;
    }
    if (param.type === 'PageRequest' || param.type === 'Pageable') {
      if (hasPagination) {
        imports.add('org.springframework.data.domain.Sort');
        args.push(
          'PageRequest.of(query.page(), query.size(), Sort.by(Sort.Direction.fromString(query.sortDirection()), query.sortBy()))'
        );
      } else {
        args.push('PageRequest.of(query.page(), query.size())');
      }
    } else if (param.type === 'Integer' && (param.name === 'page' || param.name === 'size')) {
      args.push(`query.${param.name}()`);
    } else if (param.type === 'Uuid') {
      args.push(
        `query.${param.name}() != null ? UUID.fromString(query.${param.name}()) : null`
      );
    } else if (param.type === 'String' || /^String\(/.test(param.type)) {
      args.push(`query.${param.name}()`);
    } else if (/^Range</.test(param.type)) {
      // [G8] Range<T> repo param — pass directly from the query record.
      args.push(`query.${param.name}()`);
    } else {
      // Enum<X> or bare enum type
      const enumMatch = /^Enum<(.+)>$/.exec(param.type);
      const enumName = enumMatch ? enumMatch[1] : param.type;
      imports.add(`${packageName}.${moduleName}.domain.enums.${enumName}`);
      const ucInp = ucInputByName.get(param.name);
      const isStrongTyped = ucInp && enumNamesSet.has(ucInp.type);
      if (isStrongTyped) {
        // query.X() already returns the enum
        args.push(`query.${param.name}()`);
      } else if (!param.required) {
        args.push(
          `query.${param.name}() != null ? ${enumName}.valueOf(query.${param.name}()) : null`
        );
      } else {
        args.push(`${enumName}.valueOf(query.${param.name}())`);
      }
    }
  }
  return args.join(', ');
}

// ─── FK repo list ─────────────────────────────────────────────────────────────

/**
 * Returns true if the FK aggregate is satisfied by a local repository.
 * Either same-BC FK, or cross-BC FK with a local read model aggregate
 * (aggregate with readModel: true and sourceBC matching fk.bc).
 */
function hasLocalReadModel(fk, bcYaml) {
  if (!fk.bc || fk.bc === bcYaml.bc) return true;
  return (bcYaml.aggregates || []).some(
    (agg) => agg.readModel === true && agg.sourceBC === fk.bc && agg.name === fk.aggregate
  );
}

/**
 * Splits fkValidations into:
 *   - fkRepos:  FKs satisfied by a local repository (same BC or LRM)
 *   - fkPorts:  FKs requiring a cross-BC service port (no LRM exists)
 *
 * Each fkPorts entry: { portName, portFieldName, bc, bcPascal, aggregate,
 *                       field, notFoundError, methodName, importPath, isNew }
 */
function buildFkDependencies(uc, packageName, moduleName, mainAggregateName, bcYaml) {
  const fkRepos = [];
  const fkPorts = [];
  const seenPorts = new Set();
  const seenRepos = new Set();

  // BCs handled by outbound-http-generator already emit a unified ServicePort —
  // do NOT generate a separate ServicePort.java.ejs file for them.
  const outboundHttpBcNames = getOutboundHttpBcNames(bcYaml);

  for (const fk of (uc.fkValidations || [])) {
    // Support both 'aggregate' and 'references' as the aggregate name key
    const fkAggregate = fk.aggregate || fk.references;
    if (!fkAggregate) continue; // skip malformed fkValidation entries
    if (fkAggregate === mainAggregateName) continue;
    if (hasLocalReadModel(fk, bcYaml)) {
      const repoFieldName = `${toCamelCase(fkAggregate)}Repository`;
      if (seenRepos.has(repoFieldName)) continue; // same aggregate referenced by >1 fkValidation
      seenRepos.add(repoFieldName);
      fkRepos.push({
        repoName: `${fkAggregate}Repository`,
        repoFieldName,
      });
    } else {
      // Cross-BC without LRM → service port in application/ports/
      const bcPascal = toPascalCase(fk.bc);
      const portName = `${bcPascal}ServicePort`;
      const portFieldName = `${toCamelCase(fk.bc)}ServicePort`;
      // isNew = false when the outbound HTTP generator already owns this port file
      const managedByOutboundGenerator = outboundHttpBcNames.has(fk.bc);
      fkPorts.push({
        portName,
        portFieldName,
        bc: fk.bc,
        bcPascal,
        aggregate: fkAggregate,
        field: fk.param || fk.field,           // support both schemas
        notFoundError: fk.error || fk.notFoundError, // support both schemas
        methodName: `exists${fkAggregate}`,
        importPath: `${packageName}.${moduleName}.application.ports.${portName}`,
        isNew: !seenPorts.has(portName) && !managedByOutboundGenerator,
      });
      seenPorts.add(portName);
    }
  }

  return { fkRepos, fkPorts };
}

// ─── Object storage wiring ────────────────────────────────────────────────────

/**
 * Builds the storage-port injection descriptors and the deterministic call
 * preamble for a use case's `storageCalls[]` (object storage, Fase 2).
 *
 * The returned `storagePorts` reuse the generic fkPorts injection machinery
 * (import + field + ctor + assignment). The `preamble` is rendered before the
 * handler body/scaffold — it performs the put/signUrl/delete operations and
 * binds their results to locals named by `bindsTo`. StoredObject and URI are
 * fully-qualified to avoid import bookkeeping. `get` is handled by the query
 * handler (returns Resource), so it is a no-op here.
 *
 * @param {object} uc          - the use case
 * @param {Map}    storeIndex  - map storeName → objectStorage entry (for ownedBy)
 * @param {string} packageName
 * @param {string} moduleName  - the BC owning the handler
 * @returns {{storagePorts: Array, preamble: string}}
 */
function buildStorageWiring(uc, storeIndex, packageName, moduleName) {
  const calls = Array.isArray(uc.storageCalls) ? uc.storageCalls : [];
  if (calls.length === 0) return { storagePorts: [], preamble: '' };

  const SO_FQN = `${packageName}.shared.domain.valueobject.StoredObject`;
  const ports = new Map(); // portFieldName → descriptor
  const lines = [];

  for (const sc of calls) {
    const store = storeIndex && storeIndex.get ? storeIndex.get(sc.store) : null;
    const ownerBc = (store && store.ownedBy) || moduleName;
    const storePascal = toPascalCase(sc.store);
    const portName = `${storePascal}StoragePort`;
    const portFieldName = `${toCamelCase(sc.store)}StoragePort`;
    if (!ports.has(portFieldName)) {
      ports.set(portFieldName, {
        portName,
        portFieldName,
        importPath: `${packageName}.${ownerBc}.application.ports.${portName}`,
        isNew: false,
      });
    }
    const field = portFieldName;
    const trace = `derived_from: storageCalls[${sc.store}:${sc.operation}]`;

    if (sc.operation === 'put') {
      const bindsTo = sc.bindsTo || 'storedObject';
      const inputAcc = sc.input
        ? `command.${toCamelCase(sc.input)}()`
        : '/* TODO: bind the multipart file input */ null';
      lines.push(`        // storage put → ${sc.store} (${trace})`);
      lines.push(`        ${SO_FQN} ${bindsTo} = ${field}.put(${inputAcc});`);
    } else if (sc.operation === 'signUrl') {
      const bindsTo = sc.bindsTo || 'signedUrl';
      lines.push(`        // storage signUrl → ${sc.store} (${trace})`);
      if (sc.input) {
        lines.push(`        java.net.URI ${bindsTo} = ${field}.signUrl(command.${toCamelCase(sc.input)}());`);
      } else {
        lines.push(`        String ${bindsTo}Key = null; // TODO useCase(${uc.id}, storageCalls): resolve storageKey (e.g. from the loaded aggregate)`);
        lines.push(`        java.net.URI ${bindsTo} = ${field}.signUrl(${bindsTo}Key);`);
      }
    } else if (sc.operation === 'delete') {
      lines.push(`        // storage delete → ${sc.store} (${trace})`);
      if (sc.input) {
        lines.push(`        ${field}.delete(command.${toCamelCase(sc.input)}());`);
      } else {
        const keyVar = `${toCamelCase(sc.store)}StorageKey`;
        lines.push(`        String ${keyVar} = null; // TODO useCase(${uc.id}, storageCalls): resolve storageKey from the loaded aggregate`);
        lines.push(`        ${field}.delete(${keyVar});`);
      }
    } else if (sc.operation === 'get') {
      lines.push(`        // storage get → ${sc.store} handled by the query handler (returns Resource) (${trace})`);
    }
  }

  return { storagePorts: [...ports.values()], preamble: lines.join('\n') };
}

/**
 * Build storage wiring for a QUERY handler — only the `get` operation is valid
 * on a query (it returns the binary Resource). Other operations on a query are
 * ignored here (they are handled by the command handler). Returns the storage
 * port to inject and the body that returns the Resource.
 *
 * Determinism guard: a `get` storageCall requires the use case to return a
 * binary stream (returnType === 'Resource'); otherwise we stop and notify.
 *
 * @returns {{storagePorts: Array, getBody: string}}
 */
function buildQueryStorageWiring(uc, storeIndex, packageName, moduleName, returnType) {
  const calls = Array.isArray(uc.storageCalls) ? uc.storageCalls : [];
  const gets = calls.filter((c) => c.operation === 'get');
  if (gets.length === 0) return { storagePorts: [], getBody: '' };

  if (returnType !== 'Resource') {
    throw new Error(
      `[storage-generator] useCase "${uc.id}" declares storageCalls.get but does not return a ` +
        'binary stream (returns: BinaryStream). A storage "get" must stream the object back. ' +
        'Fix the design YAML before generating.'
    );
  }

  const ports = new Map();
  const lines = [];
  for (const sc of gets) {
    const store = storeIndex && storeIndex.get ? storeIndex.get(sc.store) : null;
    const ownerBc = (store && store.ownedBy) || moduleName;
    const storePascal = toPascalCase(sc.store);
    const portName = `${storePascal}StoragePort`;
    const portFieldName = `${toCamelCase(sc.store)}StoragePort`;
    if (!ports.has(portFieldName)) {
      ports.set(portFieldName, {
        portName,
        portFieldName,
        importPath: `${packageName}.${ownerBc}.application.ports.${portName}`,
      });
    }
    const trace = `derived_from: storageCalls[${sc.store}:get]`;
    lines.push(`        // storage get → ${sc.store} (${trace})`);
    if (sc.input) {
      lines.push(`        return ${portFieldName}.get(query.${toCamelCase(sc.input)}());`);
    } else {
      lines.push(`        String storageKey = null; // TODO useCase(${uc.id}, storageCalls): resolve storageKey from the query`);
      lines.push(`        return ${portFieldName}.get(storageKey);`);
    }
  }

  return { storagePorts: [...ports.values()], getBody: lines.join('\n') };
}

// ─── VO Request record helpers ────────────────────────────────────────────────

/**
 * Builds field descriptors for a {VoName}Request record.
 * Each property of the VO gets the full annotation pipeline:
 *   mapType → typeValidationAnnotations → mapDslValidations → mergeAnnotations → buildRequiredAnnotation
 */
function buildVoRequestFields(voDefinition) {
  const imports = new Set();
  const fields = [];

  for (const voProp of voDefinition.properties || []) {
    const mapped = mapType(voProp.type, voProp);
    if (mapped.importHint) imports.add(mapped.importHint);

    const typeAnnotations = getTypeValidationAnnotations(voProp.type, imports);
    const { annotations: dslAnnotations, imports: dslImports } =
      mapDslValidations(voProp.validations || [], voProp.type);
    for (const imp of dslImports) imports.add(imp);
    const mergedAnnotations = mergeAnnotations(typeAnnotations, dslAnnotations);

    const fieldRequired = voProp.required !== false;
    const requiredAnnotations = fieldRequired
      ? buildRequiredAnnotation(mapped.javaType, imports)
      : [];

    fields.push({ type: mapped.javaType, name: voProp.name, annotations: [...requiredAnnotations, ...mergedAnnotations] });
  }

  return { fields, imports: [...imports].sort() };
}

/**
 * Generates a {VoName}Request record in {bcDir}/application/commands/.
 * Called once per unique multi-property VO used as a command input.
 */
async function generateVoRequestRecord(voName, bcYaml, packageName, moduleName, bcDir) {
  // [R3] Fall back to a canonical VO (e.g. Money) when not declared in valueObjects[],
  // so the MoneyRequest record is generated for canonical Money body inputs.
  const voDefinition = resolveVoDefinition(voName, bcYaml);
  if (!voDefinition) return;

  const { fields, imports } = buildVoRequestFields(voDefinition);
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'VoRequest.java.ejs'),
    path.join(bcDir, 'application', 'commands', `${voName}Request.java`),
    { packageName, moduleName, voName, imports, fields }
  );
}

// ─── Individual generators ────────────────────────────────────────────────────

async function generateDomainErrors(errors, errorMap, moduleName, packageName, bcDir) {
  const errorsDir = path.join(bcDir, 'domain', 'errors');
  for (const err of errors) {
    const entry = errorMap[err.code] || { baseException: 'BusinessException' };
    const errorType = entry.errorType || deriveErrorType(err.code);
    const args = Array.isArray(entry.args) ? entry.args : [];
    const argNames = args.map((a) => a.name);
    const messageExpr = compileMessageTemplate(entry.messageTemplate, argNames);
    // Java imports for arg types.
    // Handles both FQN types (contain a dot) and well-known short names that
    // need an explicit import (UUID, BigDecimal, Instant, etc.).
    const WELL_KNOWN_ARG_IMPORTS = {
      UUID: 'java.util.UUID',
      BigDecimal: 'java.math.BigDecimal',
      BigInteger: 'java.math.BigInteger',
      Instant: 'java.time.Instant',
      LocalDate: 'java.time.LocalDate',
      LocalDateTime: 'java.time.LocalDateTime',
      ZonedDateTime: 'java.time.ZonedDateTime',
      OffsetDateTime: 'java.time.OffsetDateTime',
      Duration: 'java.time.Duration',
      List: 'java.util.List',
      Map: 'java.util.Map',
      Set: 'java.util.Set',
    };
    const javaImports = [];
    const seen = new Set();
    for (const a of args) {
      const raw = String(a.type).split('<')[0].trim();
      if (seen.has(raw)) continue;
      seen.add(raw);
      if (WELL_KNOWN_ARG_IMPORTS[raw]) {
        javaImports.push(WELL_KNOWN_ARG_IMPORTS[raw]);
      } else if (raw.includes('.') && !raw.startsWith('java.lang.')) {
        javaImports.push(raw);
      }
    }
    // Constructor-parameter typed declarations (using short names where imported).
    const ctorParams = args
      .map((a) => {
        const raw = String(a.type).trim();
        const head = raw.split('<')[0].trim();
        if (head.includes('.') && !head.startsWith('java.lang.')) {
          // replace head with its short form
          return `${shortTypeName(head)}${raw.slice(head.length)} ${a.name}`;
        }
        return `${raw.startsWith('java.lang.') ? raw.slice('java.lang.'.length) : raw} ${a.name}`;
      })
      .join(', ');
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'domain', 'DomainError.java.ejs'),
      path.join(errorsDir, `${errorType}.java`),
      {
        packageName,
        moduleName,
        errorType,
        errorCode: err.code,
        baseException: entry.baseException,
        description: entry.description || err.description || null,
        chainable: entry.chainable === true,
        isInfrastructure: err.kind === 'infrastructure',
        httpStatus: entry.httpStatus || null,
        messageTemplate: entry.messageTemplate || null,
        messageExpr,
        args,
        argNames,
        ctorParams,
        javaImports,
      }
    );
  }
}

async function generatePackageInfo(moduleName, packageName, bcDir, systemName) {
  const bcDisplayName = toPascalCase(moduleName);
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'module', 'package-info.java.ejs'),
    path.join(bcDir, 'package-info.java'),
    { packageName, moduleName, bcDisplayName, projectName: systemName }
  );
}

async function generateResponseDto(agg, moduleName, packageName, bcDir, voNames = new Set(), bcYaml = null, publicApiDoc = null) {
  const { fields, imports } = buildResponseDtoFields(agg, packageName, moduleName, voNames, bcYaml, publicApiDoc);
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'ResponseDto.java.ejs'),
    path.join(bcDir, 'application', 'dtos', `${agg.name}ResponseDto.java`),
    { packageName, moduleName, aggregateName: agg.name, imports, fields }
  );

  // One nested ResponseDto per composition entity, built from the child entity's
  // own scalar properties (same template as the aggregate DTO).
  for (const entity of agg.entities || []) {
    const childImports = new Set();
    const childFields = buildScalarDtoFields(entity.properties || [], packageName, moduleName, childImports, voNames, bcYaml);
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'application', 'ResponseDto.java.ejs'),
      path.join(bcDir, 'application', 'dtos', `${entity.name}ResponseDto.java`),
      { packageName, moduleName, aggregateName: entity.name, imports: [...childImports].sort(), fields: childFields }
    );
  }
}

async function generateApplicationMapper(agg, moduleName, packageName, bcDir, voNames = new Set(), bcYaml = null) {
  const { fields, imports } = buildMapperFields(agg, packageName, moduleName, voNames, bcYaml);
  const importsSet = new Set(imports);

  // Child entity mappers (composition) — one method per child entity. The parent
  // mapper fields reference these via `this::to{Entity}ResponseDto`.
  const childMappers = [];
  for (const entity of agg.entities || []) {
    importsSet.add(`${packageName}.${moduleName}.domain.entity.${entity.name}`);
    importsSet.add(`${packageName}.${moduleName}.application.dtos.${entity.name}ResponseDto`);
    const childFields = [];
    for (const prop of entity.properties || []) {
      if (prop.hidden || prop.internal) continue;
      childFields.push(buildScalarMapperField(prop, 'child', packageName, moduleName, voNames, bcYaml, importsSet));
    }
    childMappers.push({ entityName: entity.name, fields: childFields });
  }

  // Projection mapper methods (G2): one per projection referenced by a query UC
  // for this aggregate. Derivable projections produce a real body; the rest
  // produce a TODO scaffold to be completed in Phase 3.
  const projectionMethods = [];
  for (const usage of projectionsUsedByAggregate(agg, bcYaml)) {
    const { projection, list: needsList } = usage;
    const derivable = isProjectionDerivable(projection, agg);
    importsSet.add(`${packageName}.${moduleName}.application.dtos.${projection.name}`);
    if (needsList) importsSet.add('java.util.List');

    let pmFields = [];
    if (derivable) {
      const aggMap = aggregateGetterMap(agg);
      const enumNames = new Set((bcYaml?.enums || []).map((e) => e.name));
      for (const prop of projection.properties || []) {
        // Collect type imports via the side-effect call (matches existing pattern in buildMapperFields)
        const projJavaType = javaTypeForDto(prop.type, packageName, moduleName, importsSet, voNames, bcYaml);
        for (const nestedProjectionName of projectionNamesInType(prop.type, bcYaml)) {
          if (nestedProjectionName !== projection.name) {
            importsSet.add(`${packageName}.${moduleName}.application.dtos.${nestedProjectionName}`);
          }
        }
        const aggProp = aggMap.get(prop.name);
        const baseGetter = getterName(prop.name);
        // Url type — domain holds URI, DTO expects String; emit an explicit conversion.
        if (aggProp.type === 'Url') {
          const expr = aggProp.required
            ? `domain.${baseGetter}().toString()`
            : `domain.${baseGetter}() != null ? domain.${baseGetter}().toString() : null`;
          pmFields.push({ name: prop.name, expr });
          continue;
        }
        // Enum domain field projected as a serialized String — emit enum.name() conversion.
        if (enumNames.has(aggProp.type) && projJavaType === 'String') {
          const expr = aggProp.required
            ? `domain.${baseGetter}().name()`
            : `domain.${baseGetter}() != null ? domain.${baseGetter}().name() : null`;
          pmFields.push({ name: prop.name, expr });
          continue;
        }
        // List[T] with single-prop VO inner type — same handling as response mapper
        const listInnerMatch = /^List\[(.+)\]$/.exec(aggProp.type || '');
        let getter;
        if (listInnerMatch) {
          const innerType = listInnerMatch[1];
          const innerVo = (bcYaml?.valueObjects || []).find((v) => v.name === innerType && (v.properties || []).length === 1);
          getter = innerVo ? `${baseGetter}().stream().map(${innerType}::getValue).toList` : baseGetter;
        } else {
          const isSingleStrVo = voNames.has(aggProp.type) && isSingleStringVo(aggProp.type, bcYaml);
          getter = isSingleStrVo ? `${baseGetter}().getValue` : baseGetter;
        }
        pmFields.push({ name: prop.name, getter });
      }
    }
    projectionMethods.push({
      projectionName: projection.name,
      derivable,
      list: needsList,
      fields: pmFields,
    });
  }

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'ApplicationMapper.java.ejs'),
    path.join(bcDir, 'application', 'mappers', `${agg.name}ApplicationMapper.java`),
    {
      packageName,
      moduleName,
      aggregateName: agg.name,
      imports: [...importsSet].sort(),
      fields,
      projectionMethods,
      childMappers,
    }
  );
}

async function generateCommand(uc, agg, moduleName, packageName, bcDir, errorMap, voNames = new Set(), bcYaml = null, eventDtoNames = new Set()) {
  const ucClassName = toPascalCase(uc.name);
  const { fields, imports, voRequestsNeeded } = buildCommandFields(uc, agg, packageName, moduleName, voNames, bcYaml, eventDtoNames);
  // Early-identity: create commands carry the aggregate id as their first
  // component. The id is generated at the application edge (controller) and
  // never deserialized from the client body — @JsonIgnore keeps it out of the
  // request contract while still flowing through to the handler/factory.
  if (uc.method === 'create') {
    fields.unshift({ type: 'UUID', name: 'id', annotations: ['@com.fasterxml.jackson.annotation.JsonIgnore'] });
    if (!imports.includes('java.util.UUID')) imports.push('java.util.UUID');
  }
  // [G4] command return type: when uc.returns is declared, the record implements
  // ReturningCommand<R> instead of Command. Reuses query return-type resolution
  // (Page[X], List[X], <AggName>Response → <AggName>ResponseDto, bare DTO).
  const returnType = uc.returns ? buildQueryReturnType(uc, agg, []) : null;
  // Add ResponseDto import when returnType references it (mirror controller import logic)
  const cmdImports = [...imports];
  if (returnType) {
    const baseDto = returnType
      .replace(/^PagedResponse<(.+)>$/, '$1')
      .replace(/^List<(.+)>$/, '$1')
      .replace(/^Optional<(.+)>$/, '$1');
    if (returnType.startsWith('PagedResponse<')) {
      cmdImports.push(`${packageName}.shared.application.dtos.PagedResponse`);
    }
    if (returnType.startsWith('List<')) {
      cmdImports.push('java.util.List');
    }
    if (returnType.startsWith('Optional<')) {
      cmdImports.push('java.util.Optional');
    }
    // [G9/G10] BulkResult and JobReference live in shared.application.dtos.
    if (baseDto === 'BulkResult' || baseDto === 'JobReference') {
      cmdImports.push(`${packageName}.shared.application.dtos.${baseDto}`);
    } else {
      // [G4] canonical scalar return type — import stdlib, not BC DTO.
      const canonicalReturn = resolveCanonicalReturnType(uc.returns);
      if (canonicalReturn) {
        if (canonicalReturn.importHint) cmdImports.push(canonicalReturn.importHint);
      } else {
        cmdImports.push(`${packageName}.${moduleName}.application.dtos.${baseDto}`);
      }
    }
  }
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'UcCommand.java.ejs'),
    path.join(bcDir, 'application', 'commands', `${ucClassName}Command.java`),
    {
      packageName,
      moduleName,
      useCaseName: ucClassName,
      useCaseId: uc.id,
      description: uc.description || '',
      imports: [...new Set(cmdImports)],
      fields,
      returnType,
    }
  );
  return voRequestsNeeded;
}

async function generateServicePort(port, packageName, moduleName, bcDir) {
  const portsDir = path.join(bcDir, 'application', 'ports');
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'ServicePort.java.ejs'),
    path.join(portsDir, `${port.portName}.java`),
    {
      packageName,
      moduleName,
      portName: port.portName,
      bc: port.bc,
      bcPascal: port.bcPascal,
      aggregate: port.aggregate,
      methodName: port.methodName,
    }
  );
}

async function generateCommandHandler(uc, agg, moduleName, packageName, bcDir, errorMap, bcYaml, repoMethods, storeIndex = null) {
  const ucClassName = toPascalCase(uc.name);
  const aggVarName = toCamelCase(agg.name);
  const repoName = `${agg.name}Repository`;
  const repoFieldName = `${aggVarName}Repository`;
  const { fkRepos, fkPorts } = buildFkDependencies(uc, packageName, moduleName, agg.name, bcYaml);

  // [object storage] inject storage ports + build the deterministic call preamble.
  const { storagePorts, preamble: storagePreamble } = buildStorageWiring(uc, storeIndex, packageName, moduleName);
  for (const sp of storagePorts) {
    if (!fkPorts.some((p) => p.portFieldName === sp.portFieldName)) fkPorts.push(sp);
  }

  // Detect properties that must be injected from SecurityContext (not from command)
  const authContextFields = (agg.properties || [])
    .filter((p) => p.source === 'authContext')
    .map((p) => {
      const javaType = p.type === 'Uuid' ? 'UUID' : p.type;
      return { name: p.name, javaType };
    });

  // Generate service port interfaces for cross-BC dependencies (one file per unique port)
  for (const port of fkPorts) {
    if (port.isNew) {
      await generateServicePort(port, packageName, moduleName, bcDir);
    }
  }

  let body = '';
  let extraImports = [];
  let scaffoldSteps = '';

  // Merge domain-rule-mapper's extra repos into fkRepos, dedupe by repoFieldName.
  // Seed with the aggregate's own repo (repoFieldName) so an extraRepo pointing at the
  // primary repository is not injected twice (primary field + duplicate fkRepos entry).
  const mergeExtraRepos = (extra) => {
    const seen = new Set([repoFieldName, ...fkRepos.map((r) => r.repoFieldName)]);
    for (const r of (extra || [])) {
      if (seen.has(r.repoFieldName)) continue;
      seen.add(r.repoFieldName);
      fkRepos.push(r);
    }
  };

  if (uc.implementation === 'full') {
    const result = buildCommandHandlerBody(uc, agg, errorMap, packageName, moduleName, bcYaml);
    body = result.body;
    extraImports = result.extraImports;
    mergeExtraRepos(result.extraRepos);
  } else if (!uc.async) {
    // [Phase 3 #2 + #8] Scaffold command handler — emit a numbered step guide and
    // wire the constructor with the cross-aggregate repos its rules will need.
    const guide = buildScaffoldHandlerGuide(uc, agg, errorMap, packageName, moduleName, bcYaml);
    scaffoldSteps = guide.stepsBlock;
    mergeExtraRepos(guide.extraRepos);
  }

  // [G4] command return type: when uc.returns is declared, the handler
  // implements ReturningCommandHandler<C, R> and the handle() method returns R.
  const returnType = uc.returns ? buildQueryReturnType(uc, agg, repoMethods) : null;
  if (returnType) {
    const baseDto = returnType
      .replace(/^PagedResponse<(.+)>$/, '$1')
      .replace(/^List<(.+)>$/, '$1')
      .replace(/^Optional<(.+)>$/, '$1');
    if (returnType.startsWith('PagedResponse<')) {
      extraImports.push(`${packageName}.shared.application.dtos.PagedResponse`);
    }
    if (returnType.startsWith('List<')) {
      extraImports.push('java.util.List');
    }
    if (returnType.startsWith('Optional<')) {
      extraImports.push('java.util.Optional');
    }
    // [G9/G10] BulkResult and JobReference live in shared.application.dtos.
    if (baseDto === 'BulkResult' || baseDto === 'JobReference') {
      extraImports.push(`${packageName}.shared.application.dtos.${baseDto}`);
    } else {
      // [G4] canonical scalar return type — import stdlib, not BC DTO.
      const canonicalReturn = resolveCanonicalReturnType(uc.returns);
      if (canonicalReturn) {
        if (canonicalReturn.importHint) extraImports.push(canonicalReturn.importHint);
      } else {
        extraImports.push(`${packageName}.${moduleName}.application.dtos.${baseDto}`);
      }
    }
    // For implementation: full + returns the auto-generated body has no return stmt;
    // emit a TODO so the developer knows to map the result. The scaffold branch
    // already throws UnsupportedOperationException so no fix is needed there.
    if (uc.implementation === 'full' && body) {
      body = body + `\n        // TODO useCase(${uc.id}, returns): map result to ${returnType}\n        return null;`;
    }
  }

  // [G10] Async jobTracking handlers persist a PENDING async_job row and return
  // JobReference(jobId). The handler depends on AsyncJobRepository, which lives
  // in shared.infrastructure.asyncJob — modelled as a synthetic fkPort entry so
  // the template renders the import + constructor parameter correctly.
  if (uc.async && uc.async.mode === 'jobTracking') {
    if (!fkPorts.some((p) => p.portFieldName === 'asyncJobRepository')) {
      fkPorts.push({
        portName: 'AsyncJobRepository',
        portFieldName: 'asyncJobRepository',
        importPath: `${packageName}.shared.infrastructure.asyncJob.AsyncJobRepository`,
        isNew: false,
      });
    }
    extraImports.push(`${packageName}.shared.infrastructure.asyncJob.AsyncJobJpa`);
    extraImports.push(`${packageName}.shared.infrastructure.asyncJob.AsyncJobStatus`);
    extraImports.push('java.time.Instant');
    extraImports.push('java.util.UUID');
    // Replace whatever body was computed: jobTracking is fundamentally a
    // scaffold (the worker is out of scope) — persist PENDING and return.
    body =
      `        // [G10] Persist a PENDING job row; the actual work is performed by\n` +
      `        // a worker (out of scope for the generator).\n` +
      `        UUID jobId = UUID.randomUUID();\n` +
      `        Instant now = Instant.now();\n` +
      `        AsyncJobJpa job = AsyncJobJpa.builder()\n` +
      `                .id(jobId)\n` +
      `                .type("${ucClassName}")\n` +
      `                .status(AsyncJobStatus.PENDING)\n` +
      `                .createdAt(now)\n` +
      `                .updatedAt(now)\n` +
      `                .build();\n` +
      `        asyncJobRepository.save(job);\n` +
      `        // TODO useCase(${uc.id}, async): implement worker that picks up\n` +
      `        //      PENDING async_job rows of type="${ucClassName}", transitions\n` +
      `        //      them to RUNNING/SUCCEEDED/FAILED and writes the result.\n` +
      `        return new JobReference(jobId);`;
  }

  // [G10] Async fireAndForget handlers dispatch and return immediately. The
  // worker is out of scope; emit a TODO so the developer wires up @Async or a
  // message-based offload as appropriate.
  if (uc.async && uc.async.mode === 'fireAndForget') {
    body =
      `        // TODO useCase(${uc.id}, async): offload the work to an @Async\n` +
      `        //      method, a Spring @Scheduled job, or a message-broker\n` +
      `        //      consumer. The controller responds 202 Accepted as soon as\n` +
      `        //      this method returns.`;
  }

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'UcCommandHandler.java.ejs'),
    path.join(bcDir, 'application', 'usecases', `${ucClassName}CommandHandler.java`),
    {
      packageName,
      moduleName,
      useCaseName: ucClassName,
      useCaseId: uc.id,
      description: uc.description || '',
      aggregateName: agg.name,
      repoName,
      repoFieldName,
      fkRepos,
      fkPorts,
      needsMapper: false,
      mapperName: '',
      mapperFieldName: '',
      authContextFields,
      // [Phase 3 #2] Scaffold command handlers that operate on their aggregate
      // need its repository injected (to load and/or save). Only inject when a
      // repository is actually declared for the aggregate — some aggregates
      // (e.g. event-driven ones) have none. `full` keeps its prior behaviour;
      // async handlers manage their own persistence (AsyncJobRepository).
      injectRepository: !uc.async && (
        uc.implementation === 'full'
        || (
          (bcYaml?.repositories || []).some((r) => r.aggregate === agg.name)
          && (!!uc.method || (uc.input || []).some((i) => i.loadAggregate === true))
        )
      ),
      implementation: (uc.async ? 'full' : (uc.implementation || 'scaffold')),
      body,
      scaffoldSteps,
      storagePreamble,
      imports: extraImports,
      returnType,
      // [G20] declarative cross-field validations — enriched with errorClass/throwable (Phase 3, Gap E9)
      validations: (function() {
        const enriched = enrichValidations(uc.validations, errorMap);
        for (const imp of validationErrorImports(enriched, packageName, moduleName)) {
          if (!extraImports.includes(imp)) extraImports.push(imp);
        }
        return enriched;
      })(),
    }
  );
}

async function generateQuery(uc, agg, moduleName, packageName, bcDir, repoMethods, bcYaml = null) {
  const ucClassName = toPascalCase(uc.name);
  const returnType = buildQueryReturnType(uc, agg, repoMethods);
  const { fields, imports: fieldImports } = buildQueryFields(uc, agg, repoMethods, bcYaml, packageName, moduleName);
  const baseImports = buildQueryImports(returnType, packageName, moduleName, agg);
  const imports = [...new Set([...baseImports, ...fieldImports])].sort();

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'UcQuery.java.ejs'),
    path.join(bcDir, 'application', 'queries', `${ucClassName}Query.java`),
    {
      packageName,
      moduleName,
      useCaseName: ucClassName,
      useCaseId: uc.id,
      description: uc.description || '',
      returnType,
      fields,
      imports,
    }
  );
}

function buildQueryImports(returnType, packageName, moduleName, agg) {
  const imports = [];
  // [G12] BinaryStream → Resource — lives in spring-core, not in BC dtos.
  if (returnType === 'Resource') {
    imports.push('org.springframework.core.io.Resource');
    return imports;
  }
  // Extract the inner DTO class name (handles PagedResponse<X>, List<X>, and Optional<X>)
  const innerMatch = /(?:PagedResponse|List|Optional)<(.+?)>/.exec(returnType);
  const dtoClassName = innerMatch ? innerMatch[1] : returnType;

  if (returnType.startsWith('PagedResponse')) {
    imports.push(`${packageName}.shared.application.dtos.PagedResponse`);
  }
  if (returnType.startsWith('List<')) {
    imports.push('java.util.List');
  }
  if (returnType.startsWith('Optional<')) {
    imports.push('java.util.Optional');
  }
  // [BUG-1/BUG-2] Canonical scalar return types (UUID, BigDecimal, Instant, etc.) live in
  // stdlib — pushing a BC dtos import for them produces a non-existent class reference.
  const QUERY_CANONICAL_IMPORTS = {
    UUID: 'java.util.UUID',
    BigDecimal: 'java.math.BigDecimal',
    Instant: 'java.time.Instant',
    LocalDate: 'java.time.LocalDate',
    Duration: 'java.time.Duration',
    URI: 'java.net.URI',
  };
  const QUERY_JAVA_LANG = new Set(['Boolean', 'Integer', 'Long', 'String']);
  if (QUERY_CANONICAL_IMPORTS[dtoClassName]) {
    imports.push(QUERY_CANONICAL_IMPORTS[dtoClassName]);
  } else if (!QUERY_JAVA_LANG.has(dtoClassName)) {
    imports.push(`${packageName}.${moduleName}.application.dtos.${dtoClassName}`);
  }
  return imports;
}

// ─── Internal API schema helpers ────────────────────────────────────────────────────────────────────────────

function resolveInternalSchemaRef(ref) {
  if (!ref) return null;
  const parts = ref.split('/');
  return parts[parts.length - 1];
}

function openApiPropToJavaType(propSchema, imports, ctx = null) {
  if (!propSchema) return 'String';
  if (propSchema.$ref) {
    const name = resolveInternalSchemaRef(propSchema.$ref);
    if (ctx) {
      // Reuse domain types when the OpenAPI schema name matches a BC catalog entry
      if (ctx.voNames && ctx.voNames.has(name)) {
        imports.add(`${ctx.packageName}.${ctx.moduleName}.domain.valueobject.${name}`);
        return name;
      }
      if (ctx.enumNames && ctx.enumNames.has(name)) {
        imports.add(`${ctx.packageName}.${ctx.moduleName}.domain.enums.${name}`);
        return name;
      }
      if (ctx.projectionNames && ctx.projectionNames.has(name)) {
        imports.add(`${ctx.packageName}.${ctx.moduleName}.application.dtos.${name}`);
        return name;
      }
    }
    return `${name}Dto`;
  }
  if (propSchema.type === 'array' && propSchema.items) {
    imports.add('java.util.List');
    const itemType = openApiPropToJavaType(propSchema.items, imports, ctx);
    return `List<${itemType}>`;
  }
  if (propSchema.type === 'string') {
    if (propSchema.format === 'uuid') {
      imports.add('java.util.UUID');
      return 'UUID';
    }
    if (propSchema.format === 'date-time') {
      imports.add('java.time.Instant');
      return 'Instant';
    }
    if (propSchema.format === 'date') {
      imports.add('java.time.LocalDate');
      return 'LocalDate';
    }
    if (propSchema.format === 'decimal') {
      imports.add('java.math.BigDecimal');
      return 'BigDecimal';
    }
    return 'String';
  }
  if (propSchema.type === 'integer') {
    if (propSchema.format === 'int64') return 'long';
    return 'int';
  }
  if (propSchema.type === 'number') {
    imports.add('java.math.BigDecimal');
    return 'BigDecimal';
  }
  if (propSchema.type === 'boolean') return 'boolean';
  return 'String';
}

function buildInternalSchemaFields(schemaName, components, forCommand = false, ctx = null) {
  const schema = (components?.schemas || {})[schemaName];
  if (!schema) return { fields: [], imports: [] };
  const imports = new Set();
  const fields = [];
  const requiredSet = new Set(schema.required || []);
  for (const [propName, propSchema] of Object.entries(schema.properties || {})) {
    const javaType = openApiPropToJavaType(propSchema, imports, ctx);
    const annotations = [];
    if (forCommand) {
      const isObj = propSchema.$ref || propSchema.type === 'array' || propSchema.type === 'object';
      if (isObj) {
        imports.add('jakarta.validation.Valid');
        annotations.push('@Valid');
      }
      if (requiredSet.has(propName) && propSchema.type !== 'integer' && propSchema.type !== 'boolean') {
        imports.add('jakarta.validation.constraints.NotNull');
        annotations.push('@NotNull');
      }
      if (propSchema.type === 'array') {
        annotations.push(...getCollectionSizeAnnotations(propSchema, imports));
      }
    }
    fields.push({ type: javaType, name: propName, annotations });
  }
  return { fields, imports: [...imports].sort() };
}

function collectInternalSchemas(rootSchemaName, components, visited = new Set()) {
  if (visited.has(rootSchemaName)) return visited;
  const schema = (components?.schemas || {})[rootSchemaName];
  if (!schema) return visited;
  visited.add(rootSchemaName);
  for (const propSchema of Object.values(schema.properties || {})) {
    visitInternalPropSchema(propSchema, components, visited);
  }
  return visited;
}

function visitInternalPropSchema(propSchema, components, visited) {
  if (propSchema.$ref) {
    const refName = resolveInternalSchemaRef(propSchema.$ref);
    collectInternalSchemas(refName, components, visited);
  } else if (propSchema.type === 'array' && propSchema.items) {
    visitInternalPropSchema(propSchema.items, components, visited);
  }
}

async function generateInternalApiDtos(schemasToGenerate, packageName, moduleName, components, bcDir, ctx = null) {
  const dtosDir = path.join(bcDir, 'application', 'dtos');
  for (const schemaName of schemasToGenerate) {
    const { fields, imports } = buildInternalSchemaFields(schemaName, components, false, ctx);
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'application', 'InternalApiDto.java.ejs'),
      path.join(dtosDir, `${schemaName}Dto.java`),
      { packageName, moduleName, dtoName: `${schemaName}Dto`, imports, fields }
    );
  }
}

// ─── Public OpenAPI response DTO generation ──────────────────────────────────

/**
 * Maps an OpenAPI property schema to a Java type for public API response DTOs.
 * Recognises domain enums, VOs, UUID/Instant formats — avoids the all-String trap.
 */
function publicApiPropToJavaType(propSchema, imports, bcYaml, packageName, moduleName) {
  if (!propSchema) return 'String';

  if (propSchema.$ref) {
    const name = resolveInternalSchemaRef(propSchema.$ref);
    const enumNames = new Set((bcYaml?.enums || []).map((e) => e.name));
    if (enumNames.has(name)) {
      imports.add(`${packageName}.${moduleName}.domain.enums.${name}`);
      return name;
    }
    const voNameSet = new Set((bcYaml?.valueObjects || []).map((v) => v.name));
    if (voNameSet.has(name)) {
      imports.add(`${packageName}.${moduleName}.domain.valueobject.${name}`);
      return name;
    }
    // Other schema reference — nested response DTO generated alongside the root schema
    imports.add(`${packageName}.${moduleName}.application.dtos.${name}`);
    return name;
  }

  if (propSchema.type === 'array' && propSchema.items) {
    imports.add('java.util.List');
    const itemType = publicApiPropToJavaType(propSchema.items, imports, bcYaml, packageName, moduleName);
    return `List<${itemType}>`;
  }

  if (propSchema.type === 'string') {
    if (propSchema.format === 'uuid') { imports.add('java.util.UUID'); return 'UUID'; }
    if (propSchema.format === 'date-time') { imports.add('java.time.Instant'); return 'Instant'; }
    return 'String';
  }

  if (propSchema.type === 'integer') return 'int';
  if (propSchema.type === 'number') { imports.add('java.math.BigDecimal'); return 'BigDecimal'; }
  if (propSchema.type === 'boolean') return 'boolean';
  return 'String';
}

/**
 * Generates public API response DTOs (e.g. ProductSummaryResponse) that are not
 * aggregate-level ResponseDtos but are referenced by query use cases via uc.returns.
 */
async function generatePublicApiResponseDtos(schemasToGenerate, components, packageName, moduleName, bcDir, bcYaml) {
  const dtosDir = path.join(bcDir, 'application', 'dtos');
  for (const schemaName of schemasToGenerate) {
    const schema = (components?.schemas || {})[schemaName];
    if (!schema) continue;
    const imports = new Set();
    const fields = [];
    for (const [propName, propSchema] of Object.entries(schema.properties || {})) {
      const javaType = publicApiPropToJavaType(propSchema, imports, bcYaml, packageName, moduleName);
      fields.push({ type: javaType, name: propName, annotations: [] });
    }
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'application', 'InternalApiDto.java.ejs'),
      path.join(dtosDir, `${schemaName}.java`),
      { packageName, moduleName, dtoName: schemaName, imports: [...imports].sort(), fields }
    );
  }
}

async function generateQueryHandler(uc, agg, moduleName, packageName, bcDir, errorMap, repoMethods, customReturnType = null, bcYaml = null, storeIndex = null) {
  const ucClassName = toPascalCase(uc.name);
  const aggVarName = toCamelCase(agg.name);
  const repoName = `${agg.name}Repository`;
  const repoFieldName = `${aggVarName}Repository`;
  const mapperName = `${agg.name}ApplicationMapper`;
  const mapperFieldName = `${aggVarName}ApplicationMapper`;
  const returnType = customReturnType || buildQueryReturnType(uc, agg, repoMethods);

  // Detect projection-based custom return: <Projection>, List<Projection>, PagedResponse<Projection>
  const returnTypeForCheck = customReturnType || buildQueryReturnType(uc, agg, repoMethods);
  const innerDtoForCheck = (/(?:PagedResponse|List|Optional)<(.+?)>/.exec(returnTypeForCheck) || [null, returnTypeForCheck])[1];
  const isAggResponseDto = innerDtoForCheck === `${agg.name}ResponseDto`;
  const projection = !isAggResponseDto && bcYaml ? findProjection(innerDtoForCheck, bcYaml) : null;
  const isDerivableProjection = projection ? isProjectionDerivable(projection, agg) : false;
  // Scaffold if: sub-entity query, OR custom DTO that is NOT a derivable projection.
  const isCustomNonProjection = !isAggResponseDto && !isDerivableProjection;
  const effectiveImpl = (isSubEntityQuery(uc, agg) || isCustomNonProjection) ? 'scaffold' : (uc.implementation || 'scaffold');
  const injectDependencies = effectiveImpl !== 'scaffold';
  // [Phase 3 #1C] A query handler should always receive its primary repository —
  // but only when that aggregate actually has a generated repository. Cross-source
  // / read-model queries whose data comes from an HTTP adapter (no local
  // domain.repository package) must NOT inject a non-existent repo, or the
  // generated handler fails to compile. The full path keeps its prior behavior.
  const hasOwnRepository = (bcYaml?.repositories || []).some((r) => r.aggregate === agg.name);
  const injectRepository = injectDependencies || hasOwnRepository;

  let body = '';
  let extraImports = [];

  if (customReturnType) {
    // For internal ops: import the actual DTO/Projection class (strip generic wrapper if present)
    const innerMatch = /(?:PagedResponse|List|Optional)<(.+?)>/.exec(customReturnType);
    const dtoClassName = innerMatch ? innerMatch[1] : customReturnType;
    extraImports.push(`${packageName}.${moduleName}.application.dtos.${dtoClassName}`);
    if (customReturnType.startsWith('PagedResponse')) {
      extraImports.push(`${packageName}.shared.application.dtos.PagedResponse`);
    }
    if (customReturnType.startsWith('List<')) {
      extraImports.push('java.util.List');
    }
    if (customReturnType.startsWith('Optional<')) {
      extraImports.push('java.util.Optional');
    }
  } else {
    // Standard path: import the actual DTO class (derived from returnType, not always aggregate ResponseDto)
    // [G12] BinaryStream → Resource lives in spring-core, skip BC dtos import.
    if (returnType === 'Resource') {
      extraImports.push('org.springframework.core.io.Resource');
    } else {
    const innerDtoMatch = /(?:PagedResponse|List|Optional)<(.+?)>/.exec(returnType);
    const dtoClassName = innerDtoMatch ? innerDtoMatch[1] : returnType;
    // [BUG-3] Canonical scalar return types (UUID, BigDecimal, Instant, etc.) live in
    // stdlib — pushing a BC dtos import for them produces a non-existent class reference.
    const QH_CANONICAL_IMPORTS = {
      UUID: 'java.util.UUID',
      BigDecimal: 'java.math.BigDecimal',
      Instant: 'java.time.Instant',
      LocalDate: 'java.time.LocalDate',
      Duration: 'java.time.Duration',
      URI: 'java.net.URI',
    };
    const QH_JAVA_LANG = new Set(['Boolean', 'Integer', 'Long', 'String']);
    if (QH_CANONICAL_IMPORTS[dtoClassName]) {
      extraImports.push(QH_CANONICAL_IMPORTS[dtoClassName]);
    } else if (!QH_JAVA_LANG.has(dtoClassName)) {
      extraImports.push(`${packageName}.${moduleName}.application.dtos.${dtoClassName}`);
    }
    if (returnType.startsWith('PagedResponse')) {
      extraImports.push(`${packageName}.shared.application.dtos.PagedResponse`);
    }
    if (returnType.startsWith('List<')) {
      extraImports.push('java.util.List');
    }
    if (returnType.startsWith('Optional<')) {
      extraImports.push('java.util.Optional');
    }
    if (effectiveImpl === 'full') {
      const result = buildQueryHandlerBody(uc, agg, repoMethods, errorMap, packageName, moduleName, projection, bcYaml);
      body = result.body;
      extraImports = [...extraImports, ...result.extraImports];
      extraImports = [...new Set(extraImports)].sort();
    }
    }
  }

  // [object storage] `get` storage call → inject the port and stream the Resource.
  // The port interface file itself is emitted by generateStorageArtifacts, so we
  // only wire injection here (no generateServicePort call).
  const { storagePorts: queryStoragePorts, getBody: storageGetBody } =
    buildQueryStorageWiring(uc, storeIndex, packageName, moduleName, returnType);

  // [G21] declarative query caching — translate technology-agnostic keyFields/cacheWhen to Spring SpEL
  let cacheableAnnotation = null;
  if (uc.cacheable) {
    const keyExpr = (uc.cacheable.keyFields || []).length > 0
      ? uc.cacheable.keyFields.map((f) => `#query.${f}`).join(" + ':' + ")
      : null;
    const conditionExpr = (uc.cacheable.cacheWhen || []).length > 0
      ? uc.cacheable.cacheWhen.map((f) => `#query.${f} != null`).join(' and ')
      : null;
    cacheableAnnotation = { cacheName: toCamelCase(uc.name), key: keyExpr, condition: conditionExpr };
    extraImports.push('org.springframework.cache.annotation.Cacheable');
  }

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'UcQueryHandler.java.ejs'),
    path.join(bcDir, 'application', 'usecases', `${ucClassName}QueryHandler.java`),
    {
      packageName,
      moduleName,
      useCaseName: ucClassName,
      useCaseId: uc.id,
      description: uc.description || '',
      aggregateName: agg.name,
      repoName,
      repoFieldName,
      mapperName,
      mapperFieldName,
      // [Phase 3 #1C] Inject the primary repository (derivable from uc.aggregate)
      // whenever the aggregate has one — including scaffold queries — while the
      // mapper stays gated on a non-scaffold implementation.
      injectRepository,
      injectDependencies,
      returnType,
      implementation: effectiveImpl,
      body,
      imports: extraImports,
      // [object storage] `get` operation wiring
      storagePorts: queryStoragePorts,
      storageGetBody,
      // [G21] declarative query caching
      cacheableAnnotation,
      // [G20] declarative cross-field validations — enriched with errorClass/throwable (Phase 3, Gap E9)
      validations: (function() {
        const enriched = enrichValidations(uc.validations, errorMap);
        for (const imp of validationErrorImports(enriched, packageName, moduleName)) {
          if (!extraImports.includes(imp)) extraImports.push(imp);
        }
        return enriched;
      })(),
    }
  );
}

// ─── Projections ─────────────────────────────────────────────────────────────

/**
 * Generates a plain Java record per projection declared in bcYaml.projections[].
 * Output: {bcDir}/application/dtos/{ProjectionName}.java
 */
async function generateProjections(bcYaml, config, outputDir) {
  const projections = bcYaml.projections || [];
  if (projections.length === 0) return;

  const { packageName } = config;
  const moduleName = bcYaml.bc;
  const packagePath = toPackagePath(packageName);
  const bcDir = path.join(outputDir, 'src', 'main', 'java', packagePath, moduleName);
  const voNames = new Set((bcYaml.valueObjects || []).map((vo) => vo.name));
  const openApiAnnotations = config.openApiAnnotations === true;

  // Build usage map: projectionName → [useCaseIds]
  const usageMap = new Map();
  for (const uc of (bcYaml.useCases || [])) {
    if (typeof uc.returns !== 'string') continue;
    const inner = (/^(?:Page|List)\[(.+)\]$/.exec(uc.returns) || [null, uc.returns])[1];
    if (!inner) continue;
    if (!usageMap.has(inner)) usageMap.set(inner, []);
    usageMap.get(inner).push(uc.id || uc.name);
  }

  for (const proj of projections) {
    const imports = new Set();
    const fields = [];
    let anyOptional = false;

    for (const prop of proj.properties || []) {
      const javaType = javaTypeForDto(prop.type, packageName, moduleName, imports, voNames, bcYaml);
      const annotations = [];

      if (prop.serializedName && prop.serializedName !== prop.name) {
        imports.add('com.fasterxml.jackson.annotation.JsonProperty');
        annotations.push(`@JsonProperty("${prop.serializedName}")`);
      }
      if (openApiAnnotations && (prop.description || prop.example !== undefined)) {
        imports.add('io.swagger.v3.oas.annotations.media.Schema');
        const parts = [];
        if (prop.description) parts.push(`description = "${String(prop.description).replace(/"/g, '\\"')}"`);
        if (prop.example !== undefined) parts.push(`example = "${String(prop.example).replace(/"/g, '\\"')}"`);
        annotations.push(`@Schema(${parts.join(', ')})`);
      }
      if (prop.required === false) anyOptional = true;

      fields.push({
        type: javaType,
        name: prop.name,
        annotations,
        derivedFrom: prop.derivedFrom || prop.derived_from || null,
        description: prop.description || null,
      });
    }

    // Class-level @JsonInclude(NON_NULL) when any field is optional.
    const classAnnotations = [];
    if (anyOptional) {
      imports.add('com.fasterxml.jackson.annotation.JsonInclude');
      classAnnotations.push('@JsonInclude(JsonInclude.Include.NON_NULL)');
    }

    const usedBy = usageMap.get(proj.name) || [];
    const description = proj.description ? String(proj.description).trim() : null;

    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'application', 'Projection.java.ejs'),
      path.join(bcDir, 'application', 'dtos', `${proj.name}.java`),
      {
        packageName,
        moduleName,
        projectionName: proj.name,
        fields,
        imports: [...imports].sort(),
        description,
        derivedFrom: `projection:${proj.name}`,
        usedBy,
        classAnnotations,
      }
    );
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

// [G6] Multi-aggregate same-BC saga handler.
// When a UC declares `aggregates: [A, B, ...]` + `steps: [...]`, the handler:
//   • Injects the repository for every declared aggregate (primary + others as fkRepos).
//   • Wraps step execution with @Transactional (Spring rolls back DB writes on any
//     uncaught RuntimeException — the default).
//   • Emits each step.method invocation as a `// TODO useCase(<id>, step:<n>): ...`
//     placeholder because mapping command fields → method args is not derivable
//     from the YAML alone (aligns with the existing scaffold philosophy).
//   • For steps that declare `onFailure.compensate`, emits a try/catch that
//     iterates compensation steps in reverse insertion order before re-throwing.
// Cross-BC orchestration is NOT supported here — those go through system.yaml#/sagas.
async function generateMultiAggregateCommandHandler(uc, moduleName, packageName, bcDir, bcYaml, errorMap = {}) {
  const ucClassName = toPascalCase(uc.name);
  const primaryAggName = uc.aggregates[0];
  const repoName = `${primaryAggName}Repository`;
  const repoFieldName = `${toCamelCase(primaryAggName)}Repository`;

  // Additional repositories for the remaining aggregates (in declared order).
  const fkRepos = uc.aggregates.slice(1).map((aggName) => ({
    repoName: `${aggName}Repository`,
    repoFieldName: `${toCamelCase(aggName)}Repository`,
  }));

  // authContext properties are inherited from the primary aggregate (matching
  // the convention used by the standard command handler).
  const primaryAgg = (bcYaml.aggregates || []).find((a) => a.name === primaryAggName);
  const authContextFields = (primaryAgg.properties || [])
    .filter((p) => p.source === 'authContext')
    .map((p) => ({ name: p.name, javaType: p.type === 'Uuid' ? 'UUID' : p.type }));

  // Build step body: declare a slot for the loaded aggregate root per step,
  // emit a TODO for arg mapping, and invoke the domain method. Compensation is
  // wired in a try/catch around the entire step sequence.
  const lines = [];
  lines.push(`        // [G6] Multi-aggregate orchestration — same BC, single transaction.`);
  lines.push(`        // Spring rolls back the JPA transaction on uncaught RuntimeException;`);
  lines.push(`        // application-level compensation runs in the catch block before re-throw.`);
  if (authContextFields.length > 0) {
    for (const f of authContextFields) {
      lines.push(`        // TODO (authContext): inject ${f.javaType} ${f.name} from SecurityContextHolder.getContext().getAuthentication()`);
    }
  }
  lines.push(`        try {`);
  uc.steps.forEach((step, idx) => {
    const aggVar = toCamelCase(step.aggregate);
    const aggRepoField = `${aggVar}Repository`;
    lines.push(`            // step ${idx + 1}/${uc.steps.length} — ${step.aggregate}.${step.method}`);
    lines.push(`            // TODO useCase(${uc.id}, step:${idx + 1}): load the ${step.aggregate} aggregate root from ${aggRepoField}, map command fields to method args, invoke ${aggVar}.${step.method}(...) and persist.`);
  });
  lines.push(`        } catch (RuntimeException ex) {`);
  // Compensation: walk steps in reverse, emit only those with onFailure.compensate.
  const compensableSteps = uc.steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.onFailure && s.onFailure.compensate)
    .reverse();
  if (compensableSteps.length === 0) {
    lines.push(`            // No step declares onFailure.compensate — rely on @Transactional rollback.`);
  } else {
    lines.push(`            // Compensation order (reverse of execution):`);
    for (const { s, i } of compensableSteps) {
      const comp = s.onFailure.compensate;
      const compAggVar = toCamelCase(comp.aggregate);
      lines.push(`            // TODO useCase(${uc.id}, compensate step:${i + 1}): load the ${comp.aggregate} aggregate root and invoke ${compAggVar}.${comp.method}(...) to undo step ${i + 1}.`);
    }
  }
  lines.push(`            throw ex;`);
  lines.push(`        }`);
  const body = lines.join('\n');

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'UcCommandHandler.java.ejs'),
    path.join(bcDir, 'application', 'usecases', `${ucClassName}CommandHandler.java`),
    {
      packageName,
      moduleName,
      useCaseName: ucClassName,
      useCaseId: uc.id,
      description: uc.description || '',
      aggregateName: primaryAggName,
      repoName,
      repoFieldName,
      fkRepos,
      fkPorts: [],
      needsMapper: false,
      mapperName: '',
      mapperFieldName: '',
      authContextFields: [],
      storagePreamble: '',
      // The saga handler injects its dependencies via fkRepos and builds its own
      // body; it does not use the template's "primary" repository field.
      injectRepository: false,
      // 'full' so the template emits our body instead of the scaffold throw.
      implementation: 'full',
      body,
      imports: (function() {
        const enriched = enrichValidations(uc.validations, errorMap);
        return validationErrorImports(enriched, packageName, moduleName);
      })(),
      returnType: null,
      // [G20] cross-field validations — enriched with errorClass/throwable (Phase 3, Gap E9)
      validations: enrichValidations(uc.validations, errorMap),
    }
  );
}

// [G9] Bulk command wrapper (record + handler).
// Renders a one-field command record `BulkXxxCommand(@Valid @Size(max=N) List<ItemTypeCommand> items)`
// and a handler that iterates the list, dispatching one item-command per entry through
// the UseCaseMediator and accumulating successes / per-item DomainException failures
// into a shared BulkResult record. Pure wrapper — not tied to any aggregate.
async function generateBulkCommand(uc, moduleName, packageName, bcDir) {
  const ucClassName = toPascalCase(uc.name);
  const itemTypeName = toPascalCase(uc.bulk.itemType);
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'UcBulkCommand.java.ejs'),
    path.join(bcDir, 'application', 'commands', `${ucClassName}Command.java`),
    {
      packageName,
      moduleName,
      useCaseName: ucClassName,
      useCaseId: uc.id,
      description: uc.description || '',
      itemTypeName,
      maxItems: uc.bulk.maxItems || null,
    }
  );
}

async function generateBulkCommandHandler(uc, moduleName, packageName, bcDir) {
  const ucClassName = toPascalCase(uc.name);
  const itemTypeName = toPascalCase(uc.bulk.itemType);
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'UcBulkCommandHandler.java.ejs'),
    path.join(bcDir, 'application', 'usecases', `${ucClassName}CommandHandler.java`),
    {
      packageName,
      moduleName,
      useCaseName: ucClassName,
      useCaseId: uc.id,
      description: uc.description || '',
      itemTypeName,
      onItemError: uc.bulk.onItemError || 'continue',
    }
  );
}

async function generateApplicationLayer(bcYaml, config, outputDir, internalApiDoc = null, publicApiDoc = null, objectStores = []) {
  const { packageName, systemName } = config;
  const moduleName = bcYaml.bc;
  const packagePath = toPackagePath(packageName);
  const bcDir = path.join(outputDir, 'src', 'main', 'java', packagePath, moduleName);

  // [object storage] storeName → objectStorage entry, for handler/query wiring.
  const storeIndex = new Map((objectStores || []).map((s) => [s.name, s]));

  const errorMap = buildErrorMap(bcYaml.errors || []);
  const repoMethods = normalizeRepoMethods(bcYaml.repositories || []);
  const allUseCases = bcYaml.useCases || [];
  const voNames = new Set((bcYaml.valueObjects || []).map((vo) => vo.name));
  const eventDtoNames = new Set((bcYaml.eventDtos || []).map((d) => d.name));

  // Build map of internal API operations: operationId → { opSpec, components }
  const internalOpsMap = new Map();
  if (internalApiDoc) {
    const paths = internalApiDoc.paths || {};
    for (const [, pathItem] of Object.entries(paths)) {
      for (const [httpMethod, operation] of Object.entries(pathItem)) {
        if (httpMethod === 'parameters' || typeof operation !== 'object' || !operation.operationId) continue;
        internalOpsMap.set(operation.operationId, {
          opSpec: operation,
          components: internalApiDoc.components || {},
        });
      }
    }
  }

  // 1. Domain errors
  await generateDomainErrors(bcYaml.errors || [], errorMap, moduleName, packageName, bcDir);

  // 2. Spring Modulith package-info for this BC module
  await generatePackageInfo(moduleName, packageName, bcDir, systemName);

  // 3. Group use cases by aggregate
  const aggNames = [...new Set(allUseCases.map((uc) => uc.aggregate))];
  const generatedVoRequests = new Set(); // tracks {VoName}Request records already written for this BC

  for (const aggName of aggNames) {
    const agg = (bcYaml.aggregates || []).find((a) => a.name === aggName);
    if (!agg) continue;

    const aggUseCases = allUseCases.filter((uc) => uc.aggregate === aggName);

    // ResponseDto + Mapper per aggregate
    await generateResponseDto(agg, moduleName, packageName, bcDir, voNames, bcYaml, publicApiDoc);
    await generateApplicationMapper(agg, moduleName, packageName, bcDir, voNames, bcYaml);

    // Use cases
    for (const uc of aggUseCases) {
      const opId = uc.trigger?.operationId;
      // Only query-type UCs get special internal-API handling.
      // Command-type UCs (e.g. 204 responses) fall through to normal command generation.
      const isInternalOp = opId && internalOpsMap.has(opId) && uc.type === 'query';

      if (isInternalOp) {
        const { opSpec, components } = internalOpsMap.get(opId);

        // Extract request / response schema names.
        // Support both direct $ref and array (type: array, items: $ref) responses.
        const requestRef = opSpec.requestBody?.content?.['application/json']?.schema?.$ref;
        const requestSchemaName = requestRef ? resolveInternalSchemaRef(requestRef) : null;
        const responseSchema200 = opSpec.responses?.['200']?.content?.['application/json']?.schema;
        const responseRef = responseSchema200?.$ref || null;
        const responseArrayItemRef = (responseSchema200?.type === 'array') ? (responseSchema200?.items?.$ref || null) : null;
        const responseSchemaName = responseRef
          ? resolveInternalSchemaRef(responseRef)
          : (responseArrayItemRef ? resolveInternalSchemaRef(responseArrayItemRef) : null);
        const isListResponse = !responseRef && !!responseArrayItemRef;

        // Collect schemas to generate as DTOs
        const schemasToGenerate = new Set();
        if (requestSchemaName) {
          // Nested schemas from request body (root schema becomes the Query record)
          const allReqSchemas = collectInternalSchemas(requestSchemaName, components, new Set());
          allReqSchemas.delete(requestSchemaName);
          for (const s of allReqSchemas) schemasToGenerate.add(s);
        }
        if (responseSchemaName) {
          collectInternalSchemas(responseSchemaName, components, schemasToGenerate);
        }
        // Aggregate ResponseDtos are already generated with proper Java types (UUID, Instant, enums).
        // Exclude any schema whose DTO name matches an existing aggregate ResponseDto to prevent
        // openApiPropToJavaType from overwriting it with all-String fields.
        // Also exclude projection schemas — they are generated as dedicated records by generateProjections().
        const aggDtoNames = new Set((bcYaml.aggregates || []).map((a) => `${a.name}ResponseDto`));
        const bcProjectionNames = new Set((bcYaml.projections || []).map((p) => p.name));
        const bcEnumNames = new Set((bcYaml.enums || []).map((e) => e.name));
        const openApiCtx = {
          packageName,
          moduleName,
          voNames,
          enumNames: bcEnumNames,
          projectionNames: bcProjectionNames,
        };
        const dtoSchemas = [...schemasToGenerate].filter((s) => {
          if (/error/i.test(s)) return false;
          if (aggDtoNames.has(`${s}Dto`)) return false;
          if (bcProjectionNames.has(s)) return false;
          if (voNames.has(s)) return false;
          if (bcEnumNames.has(s)) return false;
          return true;
        });
        await generateInternalApiDtos(dtoSchemas, packageName, moduleName, components, bcDir, openApiCtx);

        // Build Query record fields from request body schema (or fall back to YAML method signature
        // for GET-style internal ops that have path params but no request body).
        const ucClassName = toPascalCase(uc.name);
        const queryImports = new Set();
        let queryFields = [];
        if (requestSchemaName) {
          const { fields, imports } = buildInternalSchemaFields(requestSchemaName, components, true, openApiCtx);
          queryFields = fields;
          for (const imp of imports) queryImports.add(imp);
        } else {
          // No request body (e.g. GET /{id}): derive fields from the repositoryMethod signature
          const { fields: qf, imports: qfImports } = buildQueryFields(uc, agg, repoMethods, bcYaml, packageName, moduleName);
          queryFields = qf;
          for (const imp of qfImports) queryImports.add(imp);
        }
        // When the response schema is a projection, use the bare name (no Dto suffix).
        const isProjectionResponse = responseSchemaName && bcProjectionNames.has(responseSchemaName);
        // [G-INTERNAL-RETURN] When uc.returns is set (including synthesized projections from
        // inline arrays), it is the canonical Java return type declared in the YAML.
        // The internal API response schema only describes the wire format — the YAML wins.
        // Using the YAML-declared type keeps Query<R>, QueryHandler<Q,R>, and the controller
        // return type consistent (all three generators read uc.returns, not the OpenAPI schema).
        const responseReturnTypeFromSchema = responseSchemaName
          ? (isListResponse
            ? `List<${isProjectionResponse ? responseSchemaName : `${responseSchemaName}Dto`}>`
            : (isProjectionResponse ? responseSchemaName : `${responseSchemaName}Dto`))
          : 'void';
        const responseReturnType = uc.returns
          ? buildQueryReturnType(uc, agg, repoMethods)
          : responseReturnTypeFromSchema;
        if (responseReturnType !== 'void') {
          const innerMatch = /(?:PagedResponse|List|Optional)<(.+?)>/.exec(responseReturnType);
          const innerClassName = innerMatch ? innerMatch[1] : responseReturnType;
          queryImports.add(`${packageName}.${moduleName}.application.dtos.${innerClassName}`);
          if (responseReturnType.startsWith('PagedResponse')) {
            queryImports.add(`${packageName}.shared.application.dtos.PagedResponse`);
          }
          if (responseReturnType.startsWith('List<') || isListResponse) queryImports.add('java.util.List');
          if (responseReturnType.startsWith('Optional<')) queryImports.add('java.util.Optional');
        }

        // Add imports for any DTO types used in query fields (different package: queries vs dtos).
        // Skip primitive/canonical types and types already resolved to VO/enum/projection
        // (their imports were already added by openApiPropToJavaType via the ctx).
        const skipTypes = new Set(['String', 'UUID', 'int', 'long', 'boolean', 'BigDecimal', 'Instant', 'LocalDate']);
        for (const field of queryFields) {
          const innerFieldMatch = /^(?:List<)?([A-Za-z0-9_]+)>?$/.exec(field.type);
          if (!innerFieldMatch) continue;
          const inner = innerFieldMatch[1];
          if (skipTypes.has(inner)) continue;
          if (voNames.has(inner)) continue;
          if (bcEnumNames.has(inner)) continue;
          if (bcProjectionNames.has(inner)) continue;
          queryImports.add(`${packageName}.${moduleName}.application.dtos.${inner}`);
        }

        // Generate Query record
        await renderAndWrite(
          path.join(TEMPLATES_DIR, 'application', 'UcQuery.java.ejs'),
          path.join(bcDir, 'application', 'queries', `${ucClassName}Query.java`),
          {
            packageName,
            moduleName,
            useCaseName: ucClassName,
            useCaseId: uc.id,
            description: uc.description || '',
            returnType: responseReturnType,
            fields: queryFields,
            imports: [...queryImports].sort(),
          }
        );

        // Generate QueryHandler — always scaffold for internal ops
        await generateQueryHandler(
          { ...uc, implementation: 'scaffold' },
          agg,
          moduleName,
          packageName,
          bcDir,
          errorMap,
          repoMethods,
          responseReturnType,
          bcYaml
        );
      } else if (uc.type === 'command') {
        if (uc.bulk) {
          // [G9] Bulk command wrapper — render dedicated record + handler that
          // delegate to the item-level command via the UseCaseMediator.
          await generateBulkCommand(uc, moduleName, packageName, bcDir);
          await generateBulkCommandHandler(uc, moduleName, packageName, bcDir);
        } else if (Array.isArray(uc.aggregates) && uc.aggregates.length >= 2) {
          // [G6] Multi-aggregate same-BC saga — standard Command record (fields
          // come from uc.input[]), but a dedicated handler that injects every
          // aggregate's repository and emits the steps[] orchestration with
          // application-level compensation.
          const voRequestsNeeded = await generateCommand(uc, agg, moduleName, packageName, bcDir, errorMap, voNames, bcYaml, eventDtoNames);
          await generateMultiAggregateCommandHandler(uc, moduleName, packageName, bcDir, bcYaml, errorMap);
          for (const voName of voRequestsNeeded) {
            if (!generatedVoRequests.has(voName)) {
              generatedVoRequests.add(voName);
              await generateVoRequestRecord(voName, bcYaml, packageName, moduleName, bcDir);
            }
          }
        } else {
          const voRequestsNeeded = await generateCommand(uc, agg, moduleName, packageName, bcDir, errorMap, voNames, bcYaml, eventDtoNames);
          await generateCommandHandler(uc, agg, moduleName, packageName, bcDir, errorMap, bcYaml, repoMethods, storeIndex);
          for (const voName of voRequestsNeeded) {
            if (!generatedVoRequests.has(voName)) {
              generatedVoRequests.add(voName);
              await generateVoRequestRecord(voName, bcYaml, packageName, moduleName, bcDir);
            }
          }
        }
      } else if (uc.type === 'query') {
        // If uc.returns references a non-aggregate response DTO (e.g. ProductSummaryResponse),
        // generate that DTO from the public OpenAPI spec before generating the query record.
        if (uc.returns && publicApiDoc) {
          const publicComponents = publicApiDoc.components || {};
          const aggResponseName = `${agg.name}Response`;
          const aggNames = new Set((bcYaml.aggregates || []).map((a) => a.name));
          // Extract bare schema name(s) from returns (strip Page[...] / List[...] wrappers)
          const rawReturns = uc.returns;
          const innerMatch = /^(?:Page|List)\[(.+)\]$/.exec(rawReturns);
          const innerTypeName = innerMatch ? innerMatch[1] : rawReturns;
          // Only generate if: not the aggregate ResponseDto and not already a known aggregate name
          const isAggResponse = innerTypeName === aggResponseName || aggNames.has(innerTypeName);
          if (!isAggResponse && (publicComponents.schemas || {})[innerTypeName]) {
            // Recursively collect all schemas reachable from the root (e.g. ProductStorefrontResponse
            // references ProductImageResponse via array items $ref).
            const enumNameSet = new Set((bcYaml.enums || []).map((e) => e.name));
            const voNameSet = new Set((bcYaml.valueObjects || []).map((v) => v.name));
            const projectionNameSet = new Set((bcYaml.projections || []).map((p) => p.name));
            const allSchemas = collectInternalSchemas(innerTypeName, publicComponents, new Set());
            const schemasToGenerate = [...allSchemas].filter((s) => {
              if (/error/i.test(s)) return false;
              if (enumNameSet.has(s)) return false;
              if (voNameSet.has(s)) return false;
              if (projectionNameSet.has(s)) return false;
              return true;
            });
            await generatePublicApiResponseDtos(schemasToGenerate, publicComponents, packageName, moduleName, bcDir, bcYaml);
          }
        }
        await generateQuery(uc, agg, moduleName, packageName, bcDir, repoMethods, bcYaml);
        await generateQueryHandler(uc, agg, moduleName, packageName, bcDir, errorMap, repoMethods, null, bcYaml, storeIndex);
      }
    }
  }
}

module.exports = { generateApplicationLayer, generateProjections, buildErrorMap };
