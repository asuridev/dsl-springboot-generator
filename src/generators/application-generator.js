'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPascalCase, toCamelCase, toPackagePath } = require('../utils/naming');
const { mapType } = require('../utils/type-mapper');
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
    for (const method of (repo.methods || [])) {
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
    const isSingleStrVo = voNames.has(prop.type) && isSingleStringVo(prop.type, bcYaml);
    const getter = isSingleStrVo
      ? `${baseGetter}().getValue`
      : baseGetter;
    fields.push({ name: prop.name, getter });
  }

  if (agg.auditable) {
    fields.push({ name: 'createdAt', getter: 'getCreatedAt' });
    fields.push({ name: 'updatedAt', getter: 'getUpdatedAt' });
  }

  return { fields, imports: [...imports].sort() };
}

// ─── Command fields ───────────────────────────────────────────────────────────

function buildCommandFields(uc, agg, packageName, moduleName, voNames = new Set(), bcYaml = null) {
  const imports = new Set();
  const fields = [];
  const { methodName, params } = parseMethodSignature(uc.method || '');
  const propMap = buildPropertyMap(agg);

  const isCreate = methodName.startsWith('create');
  const notFoundErrors = normalizeNotFoundErrors(uc.notFoundError);
  const hasNotFoundError = notFoundErrors.length > 0;

  // Non-create commands need an id field if not already in method params
  if (!isCreate && hasNotFoundError && !params.some((p) => p.name === 'id')) {
    imports.add('jakarta.validation.constraints.NotBlank');
    fields.push({ type: 'String', name: 'id', annotations: ['@NotBlank'] });
  }

  for (const param of params) {
    const prop = propMap.get(param.name);
    // Never skip explicitly-declared method params — if the designer put it in the method
    // signature (e.g. create(id, ...) for an LRM), it must appear in the command.
    if (prop && prop.source === 'authContext') continue;

    const rawType = resolveParamType(param.name, propMap);

    if (rawType === 'Money') {
      // Expand Money → amount (BigDecimal) + currency (String)
      imports.add('java.math.BigDecimal');
      if (!param.optional) {
        imports.add('jakarta.validation.constraints.NotNull');
        imports.add('jakarta.validation.constraints.NotBlank');
      }
      fields.push({
        type: 'BigDecimal',
        name: `${param.name}Amount`,
        annotations: param.optional ? [] : ['@NotNull'],
      });
      fields.push({
        type: 'String',
        name: `${param.name}Currency`,
        annotations: param.optional ? [] : ['@NotBlank'],
      });
    } else {
      const javaType = javaTypeForCommand(rawType, packageName, moduleName, imports, voNames, bcYaml);
      const annotations = buildValidationAnnotations(javaType, param.optional, imports);
      fields.push({ type: javaType, name: param.name, annotations });
    }
  }

  return { fields, imports: [...imports].sort() };
}

function buildValidationAnnotations(javaType, optional, imports) {
  if (optional) return [];
  if (javaType === 'String') {
    imports.add('jakarta.validation.constraints.NotBlank');
    return ['@NotBlank'];
  }
  imports.add('jakarta.validation.constraints.NotNull');
  return ['@NotNull'];
}

// ─── Paged query detection ────────────────────────────────────────────────────
// Detects paged queries when params include PageRequest/Pageable (explicit)
// OR when params include Integer page+size (YAML Integer convention).
function isPagedRepoMethod(repoMethodName, methodParams) {
  if (methodParams.some((p) => p.type === 'PageRequest' || p.type === 'Pageable')) return true;
  const hasIntPage = methodParams.some((p) => p.name === 'page' && p.type === 'Integer');
  const hasIntSize = methodParams.some((p) => p.name === 'size' && p.type === 'Integer');
  return hasIntPage && hasIntSize;
}

// ─── Query fields ─────────────────────────────────────────────────────────────

function buildQueryFields(uc, agg, repoMethods) {
  const fields = [];

  const repoMethodName = parseRepoMethodName(uc.repositoryMethod);
  const methodParams = (repoMethods[agg.name] || {})[repoMethodName] || [];

  if (methodParams.length > 0) {
    for (const param of methodParams) {
      if (param.type === 'PageRequest' || param.type === 'Pageable') {
        fields.push({ type: 'int', name: 'page', annotations: [] });
        fields.push({ type: 'int', name: 'size', annotations: [] });
      } else if (param.type === 'Integer' && (param.name === 'page' || param.name === 'size')) {
        fields.push({ type: 'int', name: param.name, annotations: [] });
      } else {
        // All non-paging params are passed as String in the query record
        fields.push({ type: 'String', name: param.name, annotations: [] });
      }
    }
    return fields;
  }

  // Fallback: parse repositoryMethod string directly
  if (uc.repositoryMethod) {
    const match = uc.repositoryMethod.match(/\(([^)]*)\)/);
    if (match && match[1].trim()) {
      for (const p of match[1].split(',')) {
        const t = p.trim().replace('?', '');
        if (t === 'PageRequest' || t === 'Pageable') {
          fields.push({ type: 'int', name: 'page', annotations: [] });
          fields.push({ type: 'int', name: 'size', annotations: [] });
        } else if (t === 'Uuid') {
          fields.push({ type: 'String', name: 'id', annotations: [] });
        } else if (t === 'String') {
          fields.push({ type: 'String', name: 'query', annotations: [] });
        } else {
          fields.push({ type: 'String', name: toCamelCase(t), annotations: [] });
        }
      }
    }
  }

  return fields;
}

// ─── Query return type ────────────────────────────────────────────────────────

function buildQueryReturnType(uc, agg, repoMethods) {
  const repoMethodName = parseRepoMethodName(uc.repositoryMethod);
  const methodParams = (repoMethods[agg.name] || {})[repoMethodName] || [];
  if (isPagedRepoMethod(repoMethodName, methodParams)) return `PagedResponse<${agg.name}ResponseDto>`;
  // List query: method name starts with 'list' or 'findAll' and has no paging
  if (repoMethodName.startsWith('list') || repoMethodName.startsWith('findAll')) {
    return `List<${agg.name}ResponseDto>`;
  }
  return `${agg.name}ResponseDto`;
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
  const { methodName, params, returnType } = parseMethodSignature(uc.method || '');
  const propMap = buildPropertyMap(agg);

  const isCreate = methodName.startsWith('create');
  const notFoundErrors = normalizeNotFoundErrors(uc.notFoundError);
  const hasNotFoundError = notFoundErrors.length > 0;

  const aggVarName = toCamelCase(agg.name);
  const repoFieldName = `${aggVarName}Repository`;

  extraImports.add('java.util.UUID');
  extraImports.add(`${packageName}.${moduleName}.domain.aggregate.${agg.name}`);

  // Load aggregate (for non-create operations)
  if (!isCreate && hasNotFoundError) {
    const errorEntry = errorMap[notFoundErrors[0]];
    const errorType = errorEntry ? errorEntry.errorType : 'NotFoundException';
    extraImports.add(`${packageName}.${moduleName}.domain.errors.${errorType}`);
    lines.push(
      `        ${agg.name} ${aggVarName} = ${repoFieldName}.findById(UUID.fromString(command.id())).orElseThrow(${errorType}::new);`
    );
  }

  // FK validations — only for local repos; cross-BC ports are scaffold-only (// TODO)
  for (const fk of uc.fkValidations || []) {
    if (!hasLocalReadModel(fk, bcYaml || { bc: moduleName, aggregates: [] })) continue;
    const fkErrorEntry = errorMap[fk.notFoundError];
    const fkErrorType = fkErrorEntry ? fkErrorEntry.errorType : 'NotFoundException';
    const fkRepoFieldName = `${toCamelCase(fk.aggregate)}Repository`;
    extraImports.add(`${packageName}.${moduleName}.domain.errors.${fkErrorType}`);
    lines.push(
      `        if (${fkRepoFieldName}.findById(UUID.fromString(command.${fk.field}())).isEmpty()) throw new ${fkErrorType}();`
    );
  }

  // Build method call arguments
  const callArgs = [];

  // For bare 'create' with no explicit params, derive args from aggregate properties
  // using the same creationParams filter as aggregate-generator (excludes id, audit, readOnly+defaultValue)
  const CREATION_EXCLUDE = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt']);
  const derivedParams = (isCreate && params.length === 0)
    ? (agg.properties || []).filter((p) => {
        if (CREATION_EXCLUDE.has(p.name)) return false;
        if (p.readOnly && p.defaultValue != null) return false;
        return true;
      }).map((p) => ({ name: p.name, _prop: p }))
    : params.map((p) => ({ name: p.name, _prop: propMap.get(p.name) }));

  for (const { name: paramName, _prop: prop } of derivedParams) {
    // authContext fields are injected from SecurityContext, not from the command
    if (prop && prop.source === 'authContext') {
      extraImports.add('org.springframework.security.core.context.SecurityContextHolder');
      callArgs.push(`UUID.fromString(SecurityContextHolder.getContext().getAuthentication().getName())`);
      continue;
    }

    const rawType = resolveParamType(paramName, propMap);

    if (rawType === 'Money') {
      extraImports.add(`${packageName}.${moduleName}.domain.valueobject.Money`);
      callArgs.push(`new Money(command.${paramName}Amount(), command.${paramName}Currency())`);
    } else if (rawType === 'Uuid') {
      callArgs.push(`UUID.fromString(command.${paramName}())`);
    } else if (rawType === 'Url') {
      extraImports.add('java.net.URI');
      callArgs.push(`URI.create(command.${paramName}())`);
    } else {
      callArgs.push(`command.${paramName}()`);
    }
  }

  // Domain method invocation
  if (isCreate) {
    lines.push(
      `        ${agg.name} ${aggVarName} = new ${agg.name}(${callArgs.join(', ')});`
    );
  } else {
    lines.push(`        ${aggVarName}.${methodName}(${callArgs.join(', ')});`);
  }

  // Save
  lines.push(`        ${repoFieldName}.save(${aggVarName});`);

  return { body: lines.join('\n'), extraImports: [...extraImports].sort() };
}

// ─── Query handler body ───────────────────────────────────────────────────────

function buildQueryHandlerBody(uc, agg, repoMethods, errorMap, packageName, moduleName) {
  const lines = [];
  const extraImports = new Set();

  const repoMethodName = parseRepoMethodName(uc.repositoryMethod);
  const aggVarName = toCamelCase(agg.name);
  const repoFieldName = `${aggVarName}Repository`;
  const mapperFieldName = `${aggVarName}ApplicationMapper`;

  const methodParams = (repoMethods[agg.name] || {})[repoMethodName] || [];
  const hasPageable = isPagedRepoMethod(repoMethodName, methodParams);

  const notFoundErrors = normalizeNotFoundErrors(uc.notFoundError);
  const hasNotFoundError = notFoundErrors.length > 0;

  extraImports.add('java.util.UUID');
  extraImports.add(`${packageName}.${moduleName}.domain.aggregate.${agg.name}`);

  const isListQuery = repoMethodName.startsWith('list') || repoMethodName.startsWith('findAll');

  if (isListQuery && !hasPageable) {
    // Unpaged list query: e.g. listByCustomerId(Uuid)
    extraImports.add('java.util.List');
    const callArgs = buildListCallArgs(methodParams, extraImports);
    lines.push(
      `        List<${agg.name}> entities = ${repoFieldName}.${repoMethodName}(${callArgs});`
    );
    lines.push(
      `        return entities.stream().map(${mapperFieldName}::toResponseDto).toList();`
    );
  } else if (!hasPageable) {
    // Single entity query
    const errorEntry = hasNotFoundError ? errorMap[notFoundErrors[0]] : null;
    const errorType = errorEntry ? errorEntry.errorType : null;
    if (errorType) {
      extraImports.add(`${packageName}.${moduleName}.domain.errors.${errorType}`);
      lines.push(
        `        ${agg.name} entity = ${repoFieldName}.findById(UUID.fromString(query.id())).orElseThrow(${errorType}::new);`
      );
    } else {
      lines.push(
        `        ${agg.name} entity = ${repoFieldName}.findById(UUID.fromString(query.id())).orElseThrow();`
      );
    }
    lines.push(`        return ${mapperFieldName}.toResponseDto(entity);`);
  } else {
    // Paged query
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
        field: fk.field,
        notFoundError: fk.notFoundError,
        methodName: `exists${fkAggregate}`,
        importPath: `${packageName}.${moduleName}.application.ports.${portName}`,
        isNew: !seenPorts.has(portName) && !managedByOutboundGenerator,
      });
      seenPorts.add(portName);
    }
  }

  return { fkRepos, fkPorts };
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
  const { fields, imports } = buildCommandFields(uc, agg, packageName, moduleName, voNames, bcYaml);
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'UcCommand.java.ejs'),
    path.join(bcDir, 'application', 'commands', `${ucClassName}Command.java`),
    { packageName, moduleName, useCaseName: ucClassName, imports, fields }
  );
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
  const fields = buildQueryFields(uc, agg, repoMethods);
  const imports = buildQueryImports(returnType, packageName, moduleName, agg);

  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'application', 'UcQuery.java.ejs'),
    path.join(bcDir, 'application', 'queries', `${ucClassName}Query.java`),
    { packageName, moduleName, useCaseName: ucClassName, returnType, fields, imports }
  );
}

function buildQueryImports(returnType, packageName, moduleName, agg) {
  const imports = [];
  if (returnType.startsWith('PagedResponse')) {
    imports.push(`${packageName}.shared.application.dtos.PagedResponse`);
  }
  if (returnType.startsWith('List<')) {
    imports.push('java.util.List');
  }
  imports.push(`${packageName}.${moduleName}.application.dtos.${agg.name}ResponseDto`);
  return imports;
}

async function generateQueryHandler(uc, agg, moduleName, packageName, bcDir, errorMap, repoMethods) {
  const ucClassName = toPascalCase(uc.name);
  const aggVarName = toCamelCase(agg.name);
  const repoName = `${agg.name}Repository`;
  const repoFieldName = `${aggVarName}Repository`;
  const mapperName = `${agg.name}ApplicationMapper`;
  const mapperFieldName = `${aggVarName}ApplicationMapper`;
  const returnType = buildQueryReturnType(uc, agg, repoMethods);

  // Use scaffold for sub-entity queries (cannot auto-generate correct body)
  const effectiveImpl = isSubEntityQuery(uc, agg) ? 'scaffold' : (uc.implementation || 'scaffold');

  let body = '';
  let extraImports = [];

  // Always import ResponseDto (needed for return type in all implementations)
  extraImports.push(`${packageName}.${moduleName}.application.dtos.${agg.name}ResponseDto`);
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

// ─── Main entry point ─────────────────────────────────────────────────────────

async function generateApplicationLayer(bcYaml, config, outputDir) {
  const { packageName, systemName } = config;
  const moduleName = bcYaml.bc;
  const packagePath = toPackagePath(packageName);
  const bcDir = path.join(outputDir, 'src', 'main', 'java', packagePath, moduleName);

  const errorMap = buildErrorMap(bcYaml.errors || []);
  const repoMethods = normalizeRepoMethods(bcYaml.repositories || []);
  const allUseCases = bcYaml.useCases || [];
  const voNames = new Set((bcYaml.valueObjects || []).map((vo) => vo.name));

  // 1. Domain errors
  await generateDomainErrors(bcYaml.errors || [], errorMap, moduleName, packageName, bcDir);

  // 2. Spring Modulith package-info for this BC module
  await generatePackageInfo(moduleName, packageName, bcDir, systemName);

  // 3. Group use cases by aggregate
  const aggNames = [...new Set(allUseCases.map((uc) => uc.aggregate))];

  for (const aggName of aggNames) {
    const agg = (bcYaml.aggregates || []).find((a) => a.name === aggName);
    if (!agg) continue;

    const aggUseCases = allUseCases.filter((uc) => uc.aggregate === aggName);

    // ResponseDto + Mapper per aggregate
    await generateResponseDto(agg, moduleName, packageName, bcDir, voNames, bcYaml);
    await generateApplicationMapper(agg, moduleName, packageName, bcDir, voNames, bcYaml);

    // Use cases
    for (const uc of aggUseCases) {
      if (uc.type === 'command') {
        await generateCommand(uc, agg, moduleName, packageName, bcDir, errorMap, voNames, bcYaml);
        await generateCommandHandler(uc, agg, moduleName, packageName, bcDir, errorMap, bcYaml, repoMethods);
      } else if (uc.type === 'query') {
        await generateQuery(uc, agg, moduleName, packageName, bcDir, repoMethods);
        await generateQueryHandler(uc, agg, moduleName, packageName, bcDir, errorMap, repoMethods);
      }
    }
  }
}

module.exports = { generateApplicationLayer };
