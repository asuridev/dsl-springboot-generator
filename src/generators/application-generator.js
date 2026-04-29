'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPascalCase, toCamelCase, toPackagePath } = require('../utils/naming');
const { mapType } = require('../utils/type-mapper');
const { mapDslValidations, mergeAnnotations } = require('../utils/validation-mapper');
const { getOutboundHttpBcNames } = require('./outbound-http-generator');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

// ─── Constants ────────────────────────────────────────────────────────────────

const HTTP_TO_EXCEPTION = {
  404: 'NotFoundException',
  409: 'ConflictException',
  400: 'BadRequestException',
  403: 'ForbiddenException',
  401: 'UnauthorizedException',
  422: 'BusinessException',
};

// ─── Error helpers ────────────────────────────────────────────────────────────

// CART_NOT_FOUND → CartNotFoundError
function deriveErrorType(code) {
  return (code || '')
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join('') + 'Error';
}

function buildErrorMap(errors) {
  const map = {};
  for (const err of (errors || [])) {
    const errorType = err.errorType || deriveErrorType(err.code);
    map[err.code] = {
      errorType,
      httpStatus: err.httpStatus,
      baseException: HTTP_TO_EXCEPTION[err.httpStatus] || 'BusinessException',
    };
  }
  return map;
}

function normalizeNotFoundErrors(notFoundError) {
  if (!notFoundError || notFoundError === 'null') return [];
  return Array.isArray(notFoundError) ? notFoundError : [notFoundError];
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
      return { name, optional };
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

function javaTypeForDto(type, packageName, moduleName, imports, voNames = new Set(), bcYaml = null) {
  // List[T] — recursive inner type resolution
  const listDtoMatch = /^List\[(.+)\]$/.exec(type);
  if (listDtoMatch) {
    imports.add('java.util.List');
    const innerJavaType = javaTypeForDto(listDtoMatch[1], packageName, moduleName, imports, voNames, bcYaml);
    return `List<${innerJavaType}>`;
  }
  if (type === 'Uuid') {
    imports.add('java.util.UUID');
    return 'UUID';
  }
  if (type === 'DateTime') {
    imports.add('java.time.Instant');
    return 'Instant';
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
  // Value object
  if (voNames.has(type)) {
    if (isSingleStringVo(type, bcYaml)) return 'String';
    imports.add(`${packageName}.${moduleName}.domain.valueobject.${type}`);
    return type;
  }
  // Bare enum
  imports.add(`${packageName}.${moduleName}.domain.enums.${type}`);
  return type;
}

// Commands receive UUIDs as String and convert with UUID.fromString in handler
function javaTypeForCommand(type, packageName, moduleName, imports, voNames = new Set(), bcYaml = null) {
  if (type === 'Uuid') return 'String';
  return javaTypeForDto(type, packageName, moduleName, imports, voNames, bcYaml);
}

function getterName(fieldName) {
  return 'get' + fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
}

// ─── ResponseDto fields ───────────────────────────────────────────────────────

function buildResponseDtoFields(agg, packageName, moduleName, voNames = new Set(), bcYaml = null) {
  const imports = new Set();
  const fields = [];

  for (const prop of agg.properties || []) {
    if (prop.hidden || prop.internal) continue;
    const javaType = javaTypeForDto(prop.type, packageName, moduleName, imports, voNames, bcYaml);
    fields.push({ type: javaType, name: prop.name, annotations: [] });
  }

  if (agg.auditable) {
    imports.add('java.time.Instant');
    fields.push({ type: 'Instant', name: 'createdAt', annotations: [] });
    fields.push({ type: 'Instant', name: 'updatedAt', annotations: [] });
  }

  return { fields, imports: [...imports].sort() };
}

// ─── Mapper fields ────────────────────────────────────────────────────────────

function buildMapperFields(agg, packageName, moduleName, voNames = new Set(), bcYaml = null) {
  const imports = new Set();
  const fields = [];

  for (const prop of agg.properties || []) {
    if (prop.hidden || prop.internal) continue;
    javaTypeForDto(prop.type, packageName, moduleName, imports, voNames, bcYaml); // side-effect: collect imports
    const baseGetter = getterName(prop.name);
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
    fields.push({ name: prop.name, getter });
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

// ─── Command fields ───────────────────────────────────────────────────────────

function buildCommandFields(uc, agg, packageName, moduleName, voNames = new Set(), bcYaml = null) {
  const imports = new Set();
  const fields = [];
  const voRequestsNeeded = new Set();
  const propMap = buildAggPropertyMap(agg);

  // Event-triggered commands carry no external inputs in the command record
  if (uc.trigger && uc.trigger.kind === 'event') {
    return { fields, imports: [...imports].sort(), voRequestsNeeded };
  }

  for (const input of (uc.input || [])) {
    // Fields sourced from authContext are injected in the handler, not in the command record
    if (input.source === 'authContext') continue;

    const rawType = input.type;
    const isOptional = input.required === false;

    // Detect List[MultiPropVO] — e.g. List[Topics] where Topics has >1 property
    const listInnerMatch = /^List\[(.+)\]$/.exec(rawType);
    const listInnerVoName = listInnerMatch ? listInnerMatch[1] : null;
    const listInnerVoDef = listInnerVoName
      ? (bcYaml && bcYaml.valueObjects || []).find((v) => v.name === listInnerVoName)
      : null;

    if (listInnerVoDef && (listInnerVoDef.properties || []).length > 1) {
      // ── List[MultiPropVO] (e.g. List[Topics]) — emit List<{VoName}Request> with @Valid ──
      imports.add('java.util.List');
      imports.add('jakarta.validation.Valid');
      const annotations = [];
      if (!isOptional) {
        imports.add(`${JAKARTA}.NotNull`);
        annotations.push('@NotNull');
      }
      annotations.push('@Valid');
      fields.push({ type: `List<${listInnerVoName}Request>`, name: input.name, annotations });
      voRequestsNeeded.add(listInnerVoName);
    } else {

    // Look up VO definition for any type that matches a declared valueObject
    const voDefinition = (bcYaml && bcYaml.valueObjects || []).find((v) => v.name === rawType);

    if (voDefinition && (voDefinition.properties || []).length > 1) {
      // ── Multi-property VO (e.g. Money) — emit one nested {VoName}Request field with @Valid ──
      const requestType = `${rawType}Request`;
      imports.add('jakarta.validation.Valid');
      const annotations = [];
      if (!isOptional) {
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
      const { annotations: dslAnnotations, imports: dslImports } =
        mapDslValidations(voProp.validations || [], voProp.type);
      for (const imp of dslImports) imports.add(imp);
      const mergedAnnotations = mergeAnnotations(typeAnnotations, dslAnnotations);

      const fieldRequired = !isOptional && voProp.required !== false;
      const requiredAnnotations = fieldRequired
        ? buildRequiredAnnotation(mapped.javaType, imports)
        : [];

      fields.push({ type: mapped.javaType, name: input.name, annotations: [...requiredAnnotations, ...mergedAnnotations] });
    } else {
      // ── Primitive, enum, Uuid, or unknown type ──
      const javaType = javaTypeForCommand(rawType, packageName, moduleName, imports, voNames, bcYaml);
      const propDef = propMap.get(input.name);

      // 1. Required annotation (@NotBlank / @NotNull)
      const requiredAnnotations = isOptional ? [] : buildRequiredAnnotation(javaType, imports);

      // 2. Type-based annotations (e.g. @Size(max=n) for String(n), @Email)
      const typeAnnotations = getTypeValidationAnnotations(rawType, imports);

      // 3. DSL validations[] from aggregate property definition
      const { annotations: dslAnnotations, imports: dslImports } =
        mapDslValidations(propDef ? propDef.validations : [], rawType);
      for (const imp of dslImports) imports.add(imp);

      // 4. Merge @Size(max=n) + @Size(min=N) → @Size(min=N, max=n)
      const mergedAnnotations = mergeAnnotations(typeAnnotations, dslAnnotations);

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

function buildQueryFields(uc, agg, repoMethods) {
  const fields = [];
  const imports = new Set();
  const propMap = buildAggPropertyMap(agg);

  for (const input of (uc.input || [])) {
    const type = input.type;
    const isOptional = input.required === false;

    if (type === 'Integer' && (input.name === 'page' || input.name === 'size')) {
      // Pagination primitives — no validation annotations
      fields.push({ type: 'int', name: input.name, annotations: [] });
    } else if (type === 'Uuid') {
      // Uuid path/query params come in as String
      const requiredAnnotations = isOptional ? [] : (() => {
        imports.add(`${JAKARTA}.NotBlank`);
        return ['@NotBlank'];
      })();
      fields.push({ type: 'String', name: input.name, annotations: requiredAnnotations });
    } else {
      // String / Enum / other filter params
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

  return { fields, imports: [...imports] };
}

// ─── Query return type ────────────────────────────────────────────────────────

function buildQueryReturnType(uc, agg, repoMethods) {
  const raw = uc.returns;
  if (!raw) return `${agg.name}ResponseDto`;

  // Normalize OpenAPI schema name → Java class name for aggregate ResponseDtos
  // e.g. "CategoryResponse" → "CategoryResponseDto", "ProductResponse" → "ProductResponseDto"
  const normalize = (name) =>
    name === `${agg.name}Response` ? `${agg.name}ResponseDto` : name;

  // Page[SomeDto] → PagedResponse<SomeDto>
  const pageMatch = /^Page\[(.+)\]$/.exec(raw);
  if (pageMatch) return `PagedResponse<${normalize(pageMatch[1])}>`;
  // List[SomeDto] → List<SomeDto>
  const listMatch = /^List\[(.+)\]$/.exec(raw);
  if (listMatch) return `List<${normalize(listMatch[1])}>`;
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

function buildCommandHandlerBody(uc, agg, errorMap, packageName, moduleName, bcYaml) {
  const lines = [];
  const extraImports = new Set();

  const isCreate = uc.method === 'create';
  const aggVarName = toCamelCase(agg.name);
  const repoFieldName = `${aggVarName}Repository`;

  extraImports.add('java.util.UUID');
  extraImports.add(`${packageName}.${moduleName}.domain.aggregate.${agg.name}`);

  // Load aggregate (for non-create operations) — find the input with loadAggregate: true
  const loadAggInput = (uc.input || []).find((i) => i.loadAggregate === true);
  const notFoundErrors = normalizeNotFoundErrors(uc.notFoundError);
  const hasNotFoundError = notFoundErrors.length > 0;

  if (!isCreate && loadAggInput && hasNotFoundError) {
    const errorEntry = errorMap[notFoundErrors[0]];
    const errorType = errorEntry ? errorEntry.errorType : 'NotFoundException';
    extraImports.add(`${packageName}.${moduleName}.domain.errors.${errorType}`);
    lines.push(
      `        ${agg.name} ${aggVarName} = ${repoFieldName}.findById(UUID.fromString(command.${loadAggInput.name}())).orElseThrow(${errorType}::new);`
    );
  }

  // FK validations — only for local repos; cross-BC ports are scaffold-only (// TODO)
  for (const fk of uc.fkValidations || []) {
    if (!hasLocalReadModel(fk, bcYaml || { bc: moduleName, aggregates: [] })) continue;
    const fkErrorCode = fk.error || fk.notFoundError; // support both schemas
    const fkErrorEntry = fkErrorCode ? errorMap[fkErrorCode] : null;
    const fkErrorType = fkErrorEntry ? fkErrorEntry.errorType : 'NotFoundException';
    const fkParam = fk.param || fk.field; // support both schemas
    const fkRepoFieldName = `${toCamelCase(fk.aggregate)}Repository`;
    extraImports.add(`${packageName}.${moduleName}.domain.errors.${fkErrorType}`);
    lines.push(
      `        if (${fkRepoFieldName}.findById(UUID.fromString(command.${fkParam}())).isEmpty()) throw new ${fkErrorType}();`
    );
  }

  // Resolve domainMethod params to build the call args
  const aggDef = (bcYaml?.aggregates || []).find((a) => a.name === agg.name);
  const dm = (aggDef?.domainMethods || []).find((m) => m.name === uc.method);
  const dmParams = dm?.params || [];

  const callArgs = [];

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
      const listInnerVoDefI = listInnerVoNameI
        ? (bcYaml?.valueObjects || []).find((v) => v.name === listInnerVoNameI && (v.properties || []).length > 1)
        : null;
      const inputVoDef = (bcYaml?.valueObjects || []).find((v) => v.name === input.type && (v.properties || []).length > 1);
      if (listInnerVoDefI) {
        extraImports.add(`${packageName}.${moduleName}.domain.valueobject.${listInnerVoNameI}`);
        const ctorArgs = listInnerVoDefI.properties.map((p) => `r.${p.name}()`).join(', ');
        callArgs.push(`command.${input.name}().stream().map(r -> new ${listInnerVoNameI}(${ctorArgs})).toList()`);
      } else if (inputVoDef) {
        extraImports.add(`${packageName}.${moduleName}.domain.valueobject.${input.type}`);
        const propGetters = inputVoDef.properties.map((p) => `command.${input.name}().${p.name}()`).join(', ');
        callArgs.push(`new ${input.type}(${propGetters})`);
      } else if (input.type === 'Uuid') {
        callArgs.push(`UUID.fromString(command.${input.name}())`);
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
      // Check for List[MultiPropVO] — convert List<VoRequest> → List<DomainVo>
      const listInnerMatchP = /^List\[(.+)\]$/.exec(p.type);
      const listInnerVoNameP = listInnerMatchP ? listInnerMatchP[1] : null;
      const listInnerVoDefP = listInnerVoNameP
        ? (bcYaml?.valueObjects || []).find((v) => v.name === listInnerVoNameP && (v.properties || []).length > 1)
        : null;
      const paramVoDef = (bcYaml?.valueObjects || []).find((v) => v.name === p.type && (v.properties || []).length > 1);
      if (listInnerVoDefP) {
        extraImports.add(`${packageName}.${moduleName}.domain.valueobject.${listInnerVoNameP}`);
        const ctorArgs = listInnerVoDefP.properties.map((prop) => `r.${prop.name}()`).join(', ');
        callArgs.push(`command.${p.name}().stream().map(r -> new ${listInnerVoNameP}(${ctorArgs})).toList()`);
      } else if (paramVoDef) {
        extraImports.add(`${packageName}.${moduleName}.domain.valueobject.${p.type}`);
        const propGetters = paramVoDef.properties.map((prop) => `command.${p.name}().${prop.name}()`).join(', ');
        callArgs.push(`new ${p.type}(${propGetters})`);
      } else if (p.type === 'Uuid') {
        callArgs.push(`UUID.fromString(command.${p.name}())`);
      } else if (p.type === 'Url') {
        extraImports.add('java.net.URI');
        callArgs.push(`URI.create(command.${p.name}())`);
      } else {
        callArgs.push(`command.${p.name}()`);
      }
    }
  }

  // Domain method invocation
  if (isCreate) {
    const hasStaticFactory = dm && dm.returns === agg.name;
    const factoryCall = hasStaticFactory
      ? `${agg.name}.create(${callArgs.join(', ')})`
      : `new ${agg.name}(${callArgs.join(', ')})`;
    lines.push(`        ${agg.name} ${aggVarName} = ${factoryCall};`);
  } else {
    // When the UC method is "delete" on a softDelete aggregate, invoke softDelete() in the domain
    const effectiveMethod =
      uc.method === 'delete' && agg.softDelete === true ? 'softDelete' : uc.method;
    lines.push(`        ${aggVarName}.${effectiveMethod}(${callArgs.join(', ')});`);
  }

  // Save
  lines.push(`        ${repoFieldName}.save(${aggVarName});`);

  return { body: lines.join('\n'), extraImports: [...extraImports].sort() };
}

// ─── Query handler body ───────────────────────────────────────────────────────

function buildQueryHandlerBody(uc, agg, repoMethods, errorMap, packageName, moduleName) {
  const lines = [];
  const extraImports = new Set();

  const aggVarName = toCamelCase(agg.name);
  const repoFieldName = `${aggVarName}Repository`;
  const mapperFieldName = `${aggVarName}ApplicationMapper`;

  const notFoundErrors = normalizeNotFoundErrors(uc.notFoundError);
  const hasNotFoundError = notFoundErrors.length > 0;

  extraImports.add('java.util.UUID');
  extraImports.add(`${packageName}.${moduleName}.domain.aggregate.${agg.name}`);

  // ── Path A: loadAggregate: true → findById ──────────────────────────────────
  const loadAggInput = (uc.input || []).find((i) => i.loadAggregate === true);
  const returnTypeStr = uc.returns || `${agg.name}ResponseDto`;
  const isPaged = isPagedReturnType(returnTypeStr);
  const isList = !isPaged && /^List\[/.test(returnTypeStr);

  if (loadAggInput) {
    // Path A: single entity by ID
    const errorEntry = hasNotFoundError ? errorMap[notFoundErrors[0]] : null;
    const errorType = errorEntry ? errorEntry.errorType : null;
    if (errorType) {
      extraImports.add(`${packageName}.${moduleName}.domain.errors.${errorType}`);
      lines.push(
        `        ${agg.name} entity = ${repoFieldName}.findById(UUID.fromString(query.${loadAggInput.name}())).orElseThrow(${errorType}::new);`
      );
    } else {
      lines.push(
        `        ${agg.name} entity = ${repoFieldName}.findById(UUID.fromString(query.${loadAggInput.name}())).orElseThrow();`
      );
    }
    lines.push(`        return ${mapperFieldName}.toResponseDto(entity);`);
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
    const callArgs = buildListCallArgs(methodParams, extraImports);
    lines.push(
      `        List<${agg.name}> entities = ${repoFieldName}.${repoMethodName}(${callArgs});`
    );
    lines.push(
      `        return entities.stream().map(${mapperFieldName}::toResponseDto).toList();`
    );
  } else if (isPaged) {
    extraImports.add('org.springframework.data.domain.Page');
    extraImports.add('org.springframework.data.domain.PageRequest');
    extraImports.add(`${packageName}.shared.application.dtos.PagedResponse`);

    const callArgs = buildPagedCallArgs(methodParams, agg, packageName, moduleName, extraImports);
    lines.push(
      `        Page<${agg.name}> page = ${repoFieldName}.${repoMethodName}(${callArgs});`
    );
    lines.push(
      `        return PagedResponse.of(page.getContent().stream().map(${mapperFieldName}::toResponseDto).toList(), query.page(), query.size(), page.getTotalElements());`
    );
  } else {
    // Single entity via non-loadAggregate path (findBy{Field})
    const errorEntry = hasNotFoundError ? errorMap[notFoundErrors[0]] : null;
    const errorType = errorEntry ? errorEntry.errorType : null;
    const callArgs = buildListCallArgs(methodParams, extraImports);
    if (errorType) {
      extraImports.add(`${packageName}.${moduleName}.domain.errors.${errorType}`);
      lines.push(
        `        ${agg.name} entity = ${repoFieldName}.${repoMethodName}(${callArgs}).orElseThrow(${errorType}::new);`
      );
    } else {
      lines.push(
        `        ${agg.name} entity = ${repoFieldName}.${repoMethodName}(${callArgs}).orElseThrow();`
      );
    }
    lines.push(`        return ${mapperFieldName}.toResponseDto(entity);`);
  }

  return { body: lines.join('\n'), extraImports: [...extraImports].sort() };
}

function buildListCallArgs(methodParams, imports) {
  const args = [];
  for (const param of methodParams) {
    if (param.type === 'Uuid') {
      imports.add('java.util.UUID');
      args.push(`UUID.fromString(query.${param.name}())`);
    } else {
      args.push(`query.${param.name}()`);
    }
  }
  return args.join(', ');
}

function buildPagedCallArgs(methodParams, agg, packageName, moduleName, imports) {
  const args = [];
  for (const param of methodParams) {
    if (param.type === 'PageRequest' || param.type === 'Pageable') {
      args.push('PageRequest.of(query.page(), query.size())');
    } else if (param.type === 'Integer' && (param.name === 'page' || param.name === 'size')) {
      args.push(`query.${param.name}()`);
    } else if (param.type === 'Uuid') {
      args.push(
        `query.${param.name}() != null ? UUID.fromString(query.${param.name}()) : null`
      );
    } else if (param.type === 'String' || /^String\(/.test(param.type)) {
      args.push(`query.${param.name}()`);
    } else {
      // Enum<X> or bare enum type
      const enumMatch = /^Enum<(.+)>$/.exec(param.type);
      const enumName = enumMatch ? enumMatch[1] : param.type;
      imports.add(`${packageName}.${moduleName}.domain.enums.${enumName}`);
      if (!param.required) {
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

  // BCs handled by outbound-http-generator already emit a unified ServicePort —
  // do NOT generate a separate ServicePort.java.ejs file for them.
  const outboundHttpBcNames = getOutboundHttpBcNames(bcYaml);

  for (const fk of (uc.fkValidations || [])) {
    // Support both 'aggregate' and 'references' as the aggregate name key
    const fkAggregate = fk.aggregate || fk.references;
    if (!fkAggregate) continue; // skip malformed fkValidation entries
    if (fkAggregate === mainAggregateName) continue;
    if (hasLocalReadModel(fk, bcYaml)) {
      fkRepos.push({
        repoName: `${fkAggregate}Repository`,
        repoFieldName: `${toCamelCase(fkAggregate)}Repository`,
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
  const voDefinition = (bcYaml.valueObjects || []).find((v) => v.name === voName);
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
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'domain', 'DomainError.java.ejs'),
      path.join(errorsDir, `${errorType}.java`),
      {
        packageName,
        moduleName,
        errorType,
        errorCode: err.code,
        baseException: entry.baseException,
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

async function generateResponseDto(agg, moduleName, packageName, bcDir, voNames = new Set(), bcYaml = null) {
  const { fields, imports } = buildResponseDtoFields(agg, packageName, moduleName, voNames, bcYaml);
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'ResponseDto.java.ejs'),
    path.join(bcDir, 'application', 'dtos', `${agg.name}ResponseDto.java`),
    { packageName, moduleName, aggregateName: agg.name, imports, fields }
  );
}

async function generateApplicationMapper(agg, moduleName, packageName, bcDir, voNames = new Set(), bcYaml = null) {
  const { fields, imports } = buildMapperFields(agg, packageName, moduleName, voNames, bcYaml);
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'ApplicationMapper.java.ejs'),
    path.join(bcDir, 'application', 'mappers', `${agg.name}ApplicationMapper.java`),
    { packageName, moduleName, aggregateName: agg.name, imports, fields }
  );
}

async function generateCommand(uc, agg, moduleName, packageName, bcDir, errorMap, voNames = new Set(), bcYaml = null) {
  const ucClassName = toPascalCase(uc.name);
  const { fields, imports, voRequestsNeeded } = buildCommandFields(uc, agg, packageName, moduleName, voNames, bcYaml);
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'UcCommand.java.ejs'),
    path.join(bcDir, 'application', 'commands', `${ucClassName}Command.java`),
    { packageName, moduleName, useCaseName: ucClassName, imports, fields }
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

async function generateCommandHandler(uc, agg, moduleName, packageName, bcDir, errorMap, bcYaml, repoMethods) {
  const ucClassName = toPascalCase(uc.name);
  const aggVarName = toCamelCase(agg.name);
  const repoName = `${agg.name}Repository`;
  const repoFieldName = `${aggVarName}Repository`;
  const { fkRepos, fkPorts } = buildFkDependencies(uc, packageName, moduleName, agg.name, bcYaml);

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

  if (uc.implementation === 'full') {
    const result = buildCommandHandlerBody(uc, agg, errorMap, packageName, moduleName, bcYaml);
    body = result.body;
    extraImports = result.extraImports;
  }

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'UcCommandHandler.java.ejs'),
    path.join(bcDir, 'application', 'usecases', `${ucClassName}CommandHandler.java`),
    {
      packageName,
      moduleName,
      useCaseName: ucClassName,
      aggregateName: agg.name,
      repoName,
      repoFieldName,
      fkRepos,
      fkPorts,
      needsMapper: false,
      mapperName: '',
      mapperFieldName: '',
      authContextFields,
      implementation: uc.implementation || 'scaffold',
      body,
      imports: extraImports,
    }
  );
}

async function generateQuery(uc, agg, moduleName, packageName, bcDir, repoMethods) {
  const ucClassName = toPascalCase(uc.name);
  const returnType = buildQueryReturnType(uc, agg, repoMethods);
  const { fields, imports: fieldImports } = buildQueryFields(uc, agg, repoMethods);
  const baseImports = buildQueryImports(returnType, packageName, moduleName, agg);
  const imports = [...new Set([...baseImports, ...fieldImports])].sort();

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'UcQuery.java.ejs'),
    path.join(bcDir, 'application', 'queries', `${ucClassName}Query.java`),
    { packageName, moduleName, useCaseName: ucClassName, returnType, fields, imports }
  );
}

function buildQueryImports(returnType, packageName, moduleName, agg) {
  const imports = [];
  // Extract the inner DTO class name (handles PagedResponse<X> and List<X>)
  const innerMatch = /(?:PagedResponse|List)<(.+?)>/.exec(returnType);
  const dtoClassName = innerMatch ? innerMatch[1] : returnType;

  if (returnType.startsWith('PagedResponse')) {
    imports.push(`${packageName}.shared.application.dtos.PagedResponse`);
  }
  if (returnType.startsWith('List<')) {
    imports.push('java.util.List');
  }
  imports.push(`${packageName}.${moduleName}.application.dtos.${dtoClassName}`);
  return imports;
}

// ─── Internal API schema helpers ────────────────────────────────────────────────────────────────────────────

function resolveInternalSchemaRef(ref) {
  if (!ref) return null;
  const parts = ref.split('/');
  return parts[parts.length - 1];
}

function openApiPropToJavaType(propSchema, imports) {
  if (!propSchema) return 'String';
  if (propSchema.$ref) {
    const name = resolveInternalSchemaRef(propSchema.$ref);
    return `${name}Dto`;
  }
  if (propSchema.type === 'array' && propSchema.items) {
    imports.add('java.util.List');
    const itemType = openApiPropToJavaType(propSchema.items, imports);
    return `List<${itemType}>`;
  }
  if (propSchema.type === 'integer') return 'int';
  if (propSchema.type === 'number') {
    imports.add('java.math.BigDecimal');
    return 'BigDecimal';
  }
  if (propSchema.type === 'boolean') return 'boolean';
  return 'String';
}

function buildInternalSchemaFields(schemaName, components, forCommand = false) {
  const schema = (components?.schemas || {})[schemaName];
  if (!schema) return { fields: [], imports: [] };
  const imports = new Set();
  const fields = [];
  const requiredSet = new Set(schema.required || []);
  for (const [propName, propSchema] of Object.entries(schema.properties || {})) {
    const javaType = openApiPropToJavaType(propSchema, imports);
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

async function generateInternalApiDtos(schemasToGenerate, packageName, moduleName, components, bcDir) {
  const dtosDir = path.join(bcDir, 'application', 'dtos');
  for (const schemaName of schemasToGenerate) {
    const { fields, imports } = buildInternalSchemaFields(schemaName, components);
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

async function generateQueryHandler(uc, agg, moduleName, packageName, bcDir, errorMap, repoMethods, customReturnType = null) {
  const ucClassName = toPascalCase(uc.name);
  const aggVarName = toCamelCase(agg.name);
  const repoName = `${agg.name}Repository`;
  const repoFieldName = `${aggVarName}Repository`;
  const mapperName = `${agg.name}ApplicationMapper`;
  const mapperFieldName = `${aggVarName}ApplicationMapper`;
  const returnType = customReturnType || buildQueryReturnType(uc, agg, repoMethods);

  // Use scaffold for sub-entity queries (cannot auto-generate correct body)
  // Also scaffold when return type is a custom DTO (not the aggregate's own ResponseDto)
  const returnTypeForCheck = customReturnType || buildQueryReturnType(uc, agg, repoMethods);
  const innerDtoForCheck = (/(?:PagedResponse|List)<(.+?)>/.exec(returnTypeForCheck) || [null, returnTypeForCheck])[1];
  const isCustomDto = innerDtoForCheck !== `${agg.name}ResponseDto`;
  const effectiveImpl = (isSubEntityQuery(uc, agg) || isCustomDto) ? 'scaffold' : (uc.implementation || 'scaffold');

  let body = '';
  let extraImports = [];

  if (customReturnType) {
    // For internal ops: import the actual DTO/Projection class (strip List<> wrapper if present)
    const innerMatch = /^(?:List<)?([A-Za-z0-9_]+)>?$/.exec(customReturnType);
    const dtoClassName = innerMatch ? innerMatch[1] : customReturnType;
    extraImports.push(`${packageName}.${moduleName}.application.dtos.${dtoClassName}`);
    if (customReturnType.startsWith('List<')) {
      extraImports.push('java.util.List');
    }
  } else {
    // Standard path: import the actual DTO class (derived from returnType, not always aggregate ResponseDto)
    const innerDtoMatch = /(?:PagedResponse|List)<(.+?)>/.exec(returnType);
    const dtoClassName = innerDtoMatch ? innerDtoMatch[1] : returnType;
    extraImports.push(`${packageName}.${moduleName}.application.dtos.${dtoClassName}`);
    if (returnType.startsWith('PagedResponse')) {
      extraImports.push(`${packageName}.shared.application.dtos.PagedResponse`);
    }
    if (returnType.startsWith('List<')) {
      extraImports.push('java.util.List');
    }
    if (effectiveImpl === 'full') {
      const result = buildQueryHandlerBody(uc, agg, repoMethods, errorMap, packageName, moduleName);
      body = result.body;
      extraImports = [...extraImports, ...result.extraImports];
      extraImports = [...new Set(extraImports)].sort();
    }
  }

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'UcQueryHandler.java.ejs'),
    path.join(bcDir, 'application', 'usecases', `${ucClassName}QueryHandler.java`),
    {
      packageName,
      moduleName,
      useCaseName: ucClassName,
      aggregateName: agg.name,
      repoName,
      repoFieldName,
      mapperName,
      mapperFieldName,
      returnType,
      implementation: effectiveImpl,
      body,
      imports: extraImports,
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

  for (const proj of projections) {
    const imports = new Set();
    const fields = [];

    for (const prop of proj.properties || []) {
      const javaType = javaTypeForDto(prop.type, packageName, moduleName, imports, voNames, bcYaml);
      fields.push({ type: javaType, name: prop.name, annotations: [] });
    }

    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'application', 'Projection.java.ejs'),
      path.join(bcDir, 'application', 'dtos', `${proj.name}.java`),
      { packageName, moduleName, projectionName: proj.name, fields, imports: [...imports].sort() }
    );
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

async function generateApplicationLayer(bcYaml, config, outputDir, internalApiDoc = null, publicApiDoc = null) {
  const { packageName, systemName } = config;
  const moduleName = bcYaml.bc;
  const packagePath = toPackagePath(packageName);
  const bcDir = path.join(outputDir, 'src', 'main', 'java', packagePath, moduleName);

  const errorMap = buildErrorMap(bcYaml.errors || []);
  const repoMethods = normalizeRepoMethods(bcYaml.repositories || []);
  const allUseCases = bcYaml.useCases || [];
  const voNames = new Set((bcYaml.valueObjects || []).map((vo) => vo.name));

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
    await generateResponseDto(agg, moduleName, packageName, bcDir, voNames, bcYaml);
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
        const dtoSchemas = [...schemasToGenerate].filter((s) => {
          if (/error/i.test(s)) return false;
          if (aggDtoNames.has(`${s}Dto`)) return false;
          if (bcProjectionNames.has(s)) return false;
          return true;
        });
        await generateInternalApiDtos(dtoSchemas, packageName, moduleName, components, bcDir);

        // Build Query record fields from request body schema (or fall back to YAML method signature
        // for GET-style internal ops that have path params but no request body).
        const ucClassName = toPascalCase(uc.name);
        const queryImports = new Set();
        let queryFields = [];
        if (requestSchemaName) {
          const { fields, imports } = buildInternalSchemaFields(requestSchemaName, components, true);
          queryFields = fields;
          for (const imp of imports) queryImports.add(imp);
        } else {
          // No request body (e.g. GET /{id}): derive fields from the repositoryMethod signature
          const { fields: qf, imports: qfImports } = buildQueryFields(uc, agg, repoMethods);
          queryFields = qf;
          for (const imp of qfImports) queryImports.add(imp);
        }
        // When the response schema is a projection, use the bare name (no Dto suffix).
        const isProjectionResponse = responseSchemaName && bcProjectionNames.has(responseSchemaName);
        const responseReturnType = responseSchemaName
          ? (isListResponse
            ? `List<${isProjectionResponse ? responseSchemaName : `${responseSchemaName}Dto`}>`
            : (isProjectionResponse ? responseSchemaName : `${responseSchemaName}Dto`))
          : 'void';
        if (responseReturnType !== 'void') {
          const innerMatch = /^(?:List<)?([A-Za-z0-9_]+)>?$/.exec(responseReturnType);
          const innerClassName = innerMatch ? innerMatch[1] : responseReturnType;
          queryImports.add(`${packageName}.${moduleName}.application.dtos.${innerClassName}`);
          if (isListResponse) queryImports.add('java.util.List');
        }

        // Add imports for any DTO types used in query fields (different package: queries vs dtos)
        for (const field of queryFields) {
          const innerFieldMatch = /^(?:List<)?([A-Za-z0-9_]+)>?$/.exec(field.type);
          if (innerFieldMatch && !['String', 'UUID', 'int', 'boolean', 'BigDecimal', 'Instant'].includes(innerFieldMatch[1])) {
            queryImports.add(`${packageName}.${moduleName}.application.dtos.${innerFieldMatch[1]}`);
          }
        }

        // Generate Query record
        await renderAndWrite(
          path.join(TEMPLATES_DIR, 'application', 'UcQuery.java.ejs'),
          path.join(bcDir, 'application', 'queries', `${ucClassName}Query.java`),
          {
            packageName,
            moduleName,
            useCaseName: ucClassName,
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
          responseReturnType
        );
      } else if (uc.type === 'command') {
        const voRequestsNeeded = await generateCommand(uc, agg, moduleName, packageName, bcDir, errorMap, voNames, bcYaml);
        await generateCommandHandler(uc, agg, moduleName, packageName, bcDir, errorMap, bcYaml, repoMethods);
        for (const voName of voRequestsNeeded) {
          if (!generatedVoRequests.has(voName)) {
            generatedVoRequests.add(voName);
            await generateVoRequestRecord(voName, bcYaml, packageName, moduleName, bcDir);
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
            const allSchemas = collectInternalSchemas(innerTypeName, publicComponents, new Set());
            const schemasToGenerate = [...allSchemas].filter((s) => {
              if (/error/i.test(s)) return false;
              if (enumNameSet.has(s)) return false;
              if (voNameSet.has(s)) return false;
              return true;
            });
            await generatePublicApiResponseDtos(schemasToGenerate, publicComponents, packageName, moduleName, bcDir, bcYaml);
          }
        }
        await generateQuery(uc, agg, moduleName, packageName, bcDir, repoMethods);
        await generateQueryHandler(uc, agg, moduleName, packageName, bcDir, errorMap, repoMethods);
      }
    }
  }
}

module.exports = { generateApplicationLayer, generateProjections };
