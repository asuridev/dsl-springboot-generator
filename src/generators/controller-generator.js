'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPascalCase, toCamelCase, toPackagePath } = require('../utils/naming');
const { mapType, resolveCanonicalReturnType } = require('../utils/type-mapper');
const { buildOpenApiOperationMap } = require('../utils/openapi-contract');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

// [G8] Range[T] declarative input — controller binds via two @RequestParam (min/max).
const CTRL_RANGE_T_RE = /^Range\[(.+)\]$/;

// ─── OpenAPI parsing ──────────────────────────────────────────────────────────

/**
 * Flattens all OpenAPI paths into a map: operationId → operation info.
 * Merges path-level parameters with operation-level parameters.
 */
function buildOpsMap(openApiDoc) {
  const map = new Map();
  const operations = buildOpenApiOperationMap(openApiDoc);

  for (const [operationId, entry] of operations.entries()) {
    const operation = entry.operation;
    const opParams = entry.parameters || [];
    const pathParams = opParams.filter((p) => p.in === 'path').map((p) => p.name);
    const queryParams = opParams
      .filter((p) => p.in === 'query')
      .map((p) => ({
        name: p.name,
        required: p.required === true,
        defaultValue: p.schema?.default ?? null,
        type: resolveOApiParamType(p.schema),
      }));

    const responses = operation.responses || {};
    const primaryCode = Object.keys(responses).find((c) => c !== 'default') || '200';
    const responseBody = responses[primaryCode];
    const responseSchema = responseBody?.content?.['application/json']?.schema;
    const responseSchemaRef = responseSchema?.$ref || responseSchema?.items?.$ref || null;
    const isResponseArray = !responseSchema?.$ref && responseSchema?.type === 'array' && !!responseSchema?.items?.$ref;

    map.set(operationId, {
      httpMethod: entry.httpMethod,
      fullPath: entry.fullPath,
      pathParams,
      queryParams,
      hasRequestBody: !!operation.requestBody,
      primaryResponseCode: parseInt(primaryCode, 10),
      summary: operation.summary || operationId,
      responseSchemaRef,
      isResponseArray,
    });
  }

  return map;
}

function resolveOApiParamType(schema) {
  if (!schema) return 'String';
  if (schema.type === 'integer') return 'int';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.format === 'uuid') return 'String';
  return 'String';
}

// ─── HTTP annotation & status helpers ─────────────────────────────────────────

const METHOD_ANNOTATION = {
  GET: 'GetMapping',
  POST: 'PostMapping',
  PUT: 'PutMapping',
  PATCH: 'PatchMapping',
  DELETE: 'DeleteMapping',
};

function httpStatus(code) {
  if (code === 201) return 'HttpStatus.CREATED';
  if (code === 202) return 'HttpStatus.ACCEPTED';
  if (code === 204) return 'HttpStatus.NO_CONTENT';
  return 'HttpStatus.OK';
}

// ─── Command field extraction ─────────────────────────────────────────────────
// Minimal re-implementation (mirrors application-generator logic) to determine
// command fields without re-running the full SP-5 generator.

function getCommandFields(uc, agg) {
  const fields = [];

  // Event-triggered commands have no external inputs
  if (uc.trigger && uc.trigger.kind === 'event') return fields;

  for (const input of (uc.input || [])) {
    // Fields sourced from authContext are injected in the handler
    if (input.source === 'authContext') continue;
    fields.push(input.name);
  }

  return fields;
}

/**
 * [G11/G5] Returns a Map<inputName, input> for fast lookup of source/headerName/default/max
 * during controller method-signature generation. Excludes authContext inputs (handler-side).
 */
function getUcInputMap(uc) {
  const map = new Map();
  if (uc.trigger && uc.trigger.kind === 'event') return map;
  for (const input of (uc.input || [])) {
    if (input.source === 'authContext') continue;
    map.set(input.name, input);
  }
  return map;
}

function parseMethodSignature(methodStr) {
  if (!methodStr) return { methodName: '', params: [] };
  const firstParen = methodStr.indexOf('(');
  if (firstParen === -1) return { methodName: methodStr.trim(), params: [] };
  let depth = 0, closeParen = -1;
  for (let i = firstParen; i < methodStr.length; i++) {
    if (methodStr[i] === '(') depth++;
    else if (methodStr[i] === ')') { depth--; if (depth === 0) { closeParen = i; break; } }
  }
  if (closeParen === -1) return { methodName: methodStr, params: [] };
  const methodName = methodStr.substring(0, firstParen).trim();
  const paramsStr = methodStr.substring(firstParen + 1, closeParen).trim();
  const params = [];
  if (paramsStr) {
    let current = '', d = 0;
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
      const colonIdx = clean.indexOf(':');
      const name = colonIdx !== -1 ? clean.substring(0, colonIdx).trim() : clean;
      return { name, optional };
    }),
  };
}

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
  if (/^new[A-Z]/.test(paramName)) {
    const s = paramName.charAt(3).toLowerCase() + paramName.slice(4);
    if (propMap.has(s)) return propMap.get(s).type;
  }
  if (paramName.endsWith('Id')) return 'Uuid';
  return 'String';
}

function normalizeNotFoundErrors(nfe) {
  if (!nfe || nfe === 'null') return [];
  return Array.isArray(nfe) ? nfe : [nfe];
}

// ─── Query field extraction ───────────────────────────────────────────────────

function getQueryFields(uc, agg, repoMethods, bcYaml = null) {
  const fields = [];
  const enumNames = new Set((bcYaml?.enums || []).map((e) => e.name));

  for (const input of (uc.input || [])) {
    // Handler-side values from SecurityContext/JWT are not request params and
    // are not part of the Query record constructor.
    if (input.source === 'authContext') continue;

    const type = input.type;
    // [G8] Range[T] — controller will split into two @RequestParam (min/max). The Query
    // record receives the assembled Range<T>; carry inner Java type + import hint here.
    const rangeMatch = CTRL_RANGE_T_RE.exec(type);
    if (rangeMatch) {
      const inner = mapType(rangeMatch[1]);
      fields.push({
        name: input.name,
        type: `Range<${inner.javaType}>`,
        isRange: true,
        innerJavaType: inner.javaType,
        innerImportHint: inner.importHint || null,
      });
      continue;
    }
    // [G8] SearchText — wire-level String; aggregate fields[] consumed by Specs builder.
    if (type === 'SearchText') {
      fields.push({ name: input.name, type: 'String', isSearchText: true });
      continue;
    }
    if (type === 'Integer' && (input.name === 'page' || input.name === 'size')) {
      fields.push({ name: input.name, type: 'int' });
    } else if (type === 'PageRequest' || type === 'Pageable') {
      // PageRequest/Pageable input — expand to int page + int size pagination fields
      const existing = new Set(fields.map((f) => f.name));
      if (!existing.has('page')) fields.push({ name: 'page', type: 'int' });
      if (!existing.has('size')) fields.push({ name: 'size', type: 'int' });
    } else if (enumNames.has(type)) {
      // [G5] Strong-typed enum query params: emit the enum class directly so Spring
      // performs automatic conversion (no manual Enum.valueOf in handler).
      fields.push({ name: input.name, type });
    } else {
      fields.push({ name: input.name, type: 'String' });
    }
  }

  // [G7] Declarative pagination — synthesise page/size/sortBy/sortDirection if absent.
  if (uc.pagination) {
    const existing = new Set(fields.map((f) => f.name));
    if (!existing.has('page')) fields.push({ name: 'page', type: 'int' });
    if (!existing.has('size')) fields.push({ name: 'size', type: 'int' });
    if (!existing.has('sortBy')) fields.push({ name: 'sortBy', type: 'String' });
    if (!existing.has('sortDirection')) fields.push({ name: 'sortDirection', type: 'String' });
  }

  return fields;
}

function parseRepoMethodNameStr(repoMethodStr) {
  if (!repoMethodStr) return '';
  const m = repoMethodStr.match(/^(\w+)/);
  return m ? m[1] : '';
}

function normalizeRepoMethods(repositories) {
  const result = {};
  for (const repo of repositories || []) {
    result[repo.aggregate] = {};
    // Merge both standard methods and query-only methods into a single lookup map
    const allMethods = [...(repo.methods || []), ...(repo.queryMethods || [])];
    for (const method of allMethods) {
      result[repo.aggregate][method.name] = {
        params: normalizeMethodParams(method),
        returns: method.returns || null,
      };
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

function parseSignatureParams(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match || !match[1].trim()) return [];
  return match[1].split(',').map((p) => {
    p = p.trim();
    if (p.includes(':')) {
      const colonIdx = p.indexOf(':');
      const nameWithOpt = p.substring(0, colonIdx).trim();
      const type = p.substring(colonIdx + 1).trim();
      const optional = nameWithOpt.endsWith('?');
      const name = nameWithOpt.replace('?', '').trim();
      return { name, type, required: !optional };
    } else {
      const optional = p.endsWith('?');
      const typeName = p.replace('?', '').trim();
      return { name: toCamelCase(typeName), type: typeName, required: !optional };
    }
  });
}

function isPagedQuery(uc, agg, repoMethods) {
  // Paged when uc.returns declares Page[X]
  return (uc.returns || '').startsWith('Page[');
}

// ─── Common path prefix ───────────────────────────────────────────────────────

function findCommonPathPrefix(paths) {
  if (paths.length === 0) return '';
  const split = paths.map((p) => p.split('/').filter(Boolean));
  const common = [];
  const minLen = Math.min(...split.map((s) => s.length));
  for (let i = 0; i < minLen; i++) {
    const seg = split[0][i];
    if (seg.startsWith('{')) break;
    if (split.every((s) => s[i] === seg)) {
      common.push(seg);
    } else {
      break;
    }
  }
  return common.length ? '/' + common.join('/') : '';
}

// [G3] Builds the @PreAuthorize SpEL expression from uc.authorization.
// Supports three independent clauses that are AND-combined when multiple are declared:
//   scopesAnyOf     → hasAnyAuthority('SCOPE_x', 'SCOPE_y')   (generator adds SCOPE_ prefix)
//   rolesAnyOf      → hasAnyRole('ADMIN', 'CATALOG_MANAGER')   (generator strips ROLE_ prefix)
//   permissionsAnyOf → hasAnyAuthority('products:create', ...) (no prefix manipulation)
// Returns null when none of the three fields is declared.
// Returns null immediately when uc.public === true — public endpoints never get @PreAuthorize.
function buildPreAuthorizeExpr(uc) {
  if (uc && uc.public === true) return null;
  const authz = uc && uc.authorization;
  if (!authz) return null;

  const clauses = [];

  const scopes = authz.scopesAnyOf;
  if (scopes && scopes.length > 0) {
    const args = scopes.map((s) => `'SCOPE_${s}'`).join(', ');
    clauses.push(`hasAnyAuthority(${args})`);
  }

  const roles = authz.rolesAnyOf;
  if (roles && roles.length > 0) {
    const stripped = roles.map((r) => r.replace(/^ROLE_/, ''));
    const args = stripped.map((r) => `'${r}'`).join(', ');
    clauses.push(`hasAnyRole(${args})`);
  }

  const permissions = authz.permissionsAnyOf;
  if (permissions && permissions.length > 0) {
    const args = permissions.map((p) => `'${p}'`).join(', ');
    clauses.push(`hasAnyAuthority(${args})`);
  }

  return clauses.length > 0 ? clauses.join(' and ') : null;
}

// ─── Build controller operation ───────────────────────────────────────────────

function buildOperation(uc, agg, openApiOp, commonPrefix, repoMethods, bcYaml = null, publicOpsMap = null) {
  const { httpMethod, fullPath, pathParams, queryParams, hasRequestBody, primaryResponseCode, summary } = openApiOp;

  // Relative path within this controller (strip common prefix)
  const mappingPath = fullPath.startsWith(commonPrefix)
    ? fullPath.slice(commonPrefix.length) || ''
    : fullPath;

  const pathVarNames = (fullPath.match(/\{(\w+)\}/g) || []).map((m) => m.slice(1, -1));

  const isQuery = uc.type === 'query';
  const isScaffold = uc.implementation === 'scaffold';

  // Paged / list query detection — use uc.returns directly
  const paged = isQuery && isPagedQuery(uc, agg, repoMethods);
  const isList = !paged && isQuery && /^List\[/.test(uc.returns || '');
  // [G24] Optional[X] → controller emits ResponseEntity<X> with 200/404 mapping.
  const isOptional = !paged && !isList && isQuery && /^Optional\[/.test(uc.returns || '');
  // [G12] Binary download — handler returns Resource; controller wraps in
  // ResponseEntity<Resource> and serves application/octet-stream.
  const isBinary = isQuery && (uc.returns || '') === 'BinaryStream';
  // [G10] Async use cases respond with 202 Accepted.
  // - jobTracking: handler returns JobReference, controller emits ResponseEntity<JobReference>
  //   with Location pointing at the status endpoint.
  // - fireAndForget: handler returns void, controller responds 202 with empty body.
  const isAsyncJobTracking = !isQuery && uc.async && uc.async.mode === 'jobTracking';
  const isAsyncFireForget = !isQuery && uc.async && uc.async.mode === 'fireAndForget';
  const normalizeInner = (inner) => {
    if (inner === agg.name) return `${agg.name}ResponseDto`;
    if (inner.endsWith('Response')) return `${inner}Dto`;
    return inner;
  };
  const returnType = isQuery
    ? paged
      ? (() => {
          const inner = /^Page\[(.+)\]$/.exec(uc.returns || '')?.[1] || `${agg.name}ResponseDto`;
          return `PagedResponse<${normalizeInner(inner)}>`;
        })()
      : isList
        ? (() => {
            const inner = /^List\[(.+)\]$/.exec(uc.returns || '')?.[1] || `${agg.name}ResponseDto`;
            return `List<${normalizeInner(inner)}>`;
          })()
        : isOptional
          ? (() => {
              const inner = /^Optional\[(.+)\]$/.exec(uc.returns || '')?.[1] || `${agg.name}ResponseDto`;
              return `ResponseEntity<${normalizeInner(inner)}>`;
            })()
          : isBinary
            ? 'ResponseEntity<Resource>'
            : (() => {
              const raw = uc.returns || `${agg.name}ResponseDto`;
              // [G4] canonical scalar return type (Uuid→UUID, Decimal→BigDecimal, etc.) — same
              // resolution as the command branch so scalar queries produce valid Java types.
              const canonical = resolveCanonicalReturnType(raw);
              if (canonical) return canonical.javaType;
              // Normalize OpenAPI schema name → Java class name (e.g. "CategoryResponse" → "CategoryResponseDto")
              return normalizeInner(raw);
            })()
    : uc.returns
      // [G4] command with declared returns: handler is a ReturningCommandHandler<C, R>
      // and the controller method returns R (mirror query return-type resolution).
      ? (() => {
          // [G10] jobTracking: wrap JobReference in ResponseEntity to attach Location.
          if (isAsyncJobTracking) return 'ResponseEntity<JobReference>';
          const paged2 = /^Page\[(.+)\]$/.exec(uc.returns);
          if (paged2) return `PagedResponse<${normalizeInner(paged2[1])}>`;
          const list2 = /^List\[(.+)\]$/.exec(uc.returns);
          if (list2) return `List<${normalizeInner(list2[1])}>`;
          // Optional[X] → Optional<XDto>; handler returns Optional<XDto> directly.
          const optional2 = /^Optional\[(.+)\]$/.exec(uc.returns);
          if (optional2) return `Optional<${normalizeInner(optional2[1])}>`;
          // [G4] canonical scalar return type (Uuid→UUID, Decimal→BigDecimal, etc.)
          const canonical = resolveCanonicalReturnType(uc.returns);
          if (canonical) return canonical.javaType;
          return normalizeInner(uc.returns);
        })()
      : 'void';

  // Command fields (in declaration order from the record)
  const allCmdFields = isQuery ? [] : getCommandFields(uc, agg);
  // [G11] Per-input metadata (source, headerName, default, max)
  const inputMap = getUcInputMap(uc);
  const headerFieldNames = new Set(
    [...inputMap.values()].filter((i) => i.source === 'header').map((i) => i.name)
  );
  // [G12] Multipart input field names — bound to @RequestPart locals, never to
  // command.field() expressions.
  const multipartFieldNames = new Set(
    [...inputMap.values()].filter((i) => i.source === 'multipart').map((i) => i.name)
  );
  const hasMultipart = multipartFieldNames.size > 0;
  // Fields that come from path variables (by name)
  const pathFieldNames = new Set(pathVarNames);
  // aggIdPathVar: handles the case where path var is '{aggName}Id' but field is 'id'
  const aggNameCamel = toCamelCase(agg.name);
  const aggIdPathVar = pathVarNames.find((v) => v === `${aggNameCamel}Id`) || null;
  // Returns the path variable name a field resolves to, or null if it's a body/param field.
  const resolveToPathVar = (fieldName) => {
    if (pathFieldNames.has(fieldName)) return fieldName;
    // field 'id' → path var '{aggName}Id' (old schema compat)
    if (fieldName === 'id' && aggIdPathVar) return aggIdPathVar;
    // field '{anything}Id' → path var 'id' (new schema: loadAggregate inputs named after aggregate)
    if (fieldName.endsWith('Id') && pathFieldNames.has('id')) return 'id';
    return null;
  };
  const bodyFieldNames = allCmdFields.filter(
    (f) => resolveToPathVar(f) === null && !headerFieldNames.has(f) && !multipartFieldNames.has(f)
  );
  // commandHasPathId: true when any command field resolves to a path variable (not just 'id')
  const commandHasPathId = allCmdFields.some((f) => resolveToPathVar(f) !== null);
  const commandHasId = commandHasPathId; // keep alias for dispatch branch logic
  const hasOnlyPathFields =
    allCmdFields.length > 0 && bodyFieldNames.length === 0 && !hasRequestBody;

  // Query fields (for @RequestParam generation)
  const queryFieldsList = isQuery ? getQueryFields(uc, agg, repoMethods, bcYaml) : [];

  // Build dispatch call string
  const ucClassName = toPascalCase(uc.name);
  // Helper: resolves a field to its source-bound expression (path var, header local, or command.f())
  const fieldExpr = (f, viaCommand = true) => {
    const pv = resolveToPathVar(f);
    if (pv) return pv;
    if (headerFieldNames.has(f)) return f;
    if (multipartFieldNames.has(f)) return f;
    return viaCommand ? `command.${f}()` : f;
  };
  let dispatchCall;
  if (isQuery) {
    // All query fields come from path vars, headers, or @RequestParam.
    // [G8] Range[T] fields are reassembled from {name}Min/{name}Max @RequestParam locals.
    const args = queryFieldsList
      .map((f) => {
        if (f.isRange) return `new Range<>(${f.name}Min, ${f.name}Max)`;
        return resolveToPathVar(f.name) || f.name;
      })
      .join(', ');
    dispatchCall = `new ${ucClassName}Query(${args})`;
  } else if (allCmdFields.length === 0) {
    // No command fields (all injected server-side e.g. authContext) — instantiate empty record
    dispatchCall = `new ${ucClassName}Command()`;
  } else if (hasMultipart) {
    // [G12] Multipart commands always construct explicitly; @RequestPart locals
    // and any path/header/query fields populate the record positionally.
    const args = allCmdFields.map((f) => fieldExpr(f, false)).join(', ');
    dispatchCall = `new ${ucClassName}Command(${args})`;
  } else if (hasOnlyPathFields || (!hasRequestBody && allCmdFields.length > 0)) {
    // All fields from path or header (e.g., DeactivateCategory, DeleteCategory)
    const args = allCmdFields.map((f) => fieldExpr(f, false)).join(', ');
    dispatchCall = `new ${ucClassName}Command(${args})`;
  } else if (hasRequestBody && (commandHasId || headerFieldNames.size > 0)) {
    // Mix of path id / header + body fields — always construct explicitly so headers override null body fields
    const args = allCmdFields.map((f) => fieldExpr(f, true)).join(', ');
    dispatchCall = `new ${ucClassName}Command(${args})`;
  } else {
    // Create (no path id, no headers) — dispatch body command directly
    dispatchCall = 'command';
  }

  // Build OpenAPI query params that are NOT path vars and NOT paging
  const controllerQueryParams = isQuery
    ? buildQueryParamAnnotations(queryFieldsList, queryParams, inputMap, uc).filter(
        (qp) => !resolveToPathVar(qp.name) && !headerFieldNames.has(qp.name)
      )
    : [];

  // [G11] Header params for both queries and commands. javaType resolved from input.type
  // (enum-aware via bcYaml.enums) — falls back to String for unknown types.
  const enumNamesSet = new Set((bcYaml?.enums || []).map((e) => e.name));
  const headerParamsList = [...inputMap.values()]
    .filter((inp) => inp.source === 'header')
    .map((inp) => ({
      name: inp.name,
      headerName: inp.headerName,
      javaType:
        inp.type === 'Integer' ? 'int'
        : inp.type === 'Long' ? 'long'
        : inp.type === 'Boolean' ? 'boolean'
        : inp.type === 'Uuid' ? 'String'
        : enumNamesSet.has(inp.type) ? inp.type
        : 'String',
      required: inp.required !== false,
      defaultValue: inp.default != null ? String(inp.default) : null,
    }));

  // [G12] Multipart inputs — emitted as @RequestPart MultipartFile parameters.
  // Each entry carries the optional partName (defaults to input.name), maxSize
  // (size string like "10MB" → byte count) and contentTypes whitelist.
  const SIZE_UNITS = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
  const parseMaxSize = (s) => {
    if (!s) return null;
    const m = /^(\d+)(B|KB|MB|GB)$/.exec(s);
    if (!m) return null;
    return Number(m[1]) * SIZE_UNITS[m[2]];
  };
  const multipartInputsList = [...inputMap.values()]
    .filter((inp) => inp.source === 'multipart')
    .map((inp) => ({
      name: inp.name,
      partName: inp.partName || inp.name,
      required: inp.required !== false,
      maxSizeLabel: inp.maxSize || null,
      maxSizeBytes: parseMaxSize(inp.maxSize),
      contentTypes: Array.isArray(inp.contentTypes) ? inp.contentTypes.slice() : null,
    }));

  // [G10] Resolve the async status endpoint path from OpenAPI when statusEndpoint is set.
  let asyncStatusPath = null;
  if (isAsyncJobTracking && uc.async.statusEndpoint && publicOpsMap) {
    const statusOp = publicOpsMap.get(uc.async.statusEndpoint);
    if (statusOp && statusOp.fullPath) asyncStatusPath = statusOp.fullPath;
  }

  return {
    httpAnnotation: METHOD_ANNOTATION[httpMethod] || 'PostMapping',
    mappingPath,
    httpStatus: httpStatus((isAsyncJobTracking || isAsyncFireForget) ? 202 : primaryResponseCode),
    methodName: toCamelCase(uc.trigger.operationId),
    summary,
    isCommand: !isQuery,
    isScaffold,
    returnType,
    rawReturns: uc.returns,
    pathVarNames,
    queryParamsList: controllerQueryParams,
    headerParamsList,
    // [G12] When the command receives a file via @RequestPart, no @RequestBody is emitted.
    hasRequestBody: hasRequestBody && !hasOnlyPathFields && !hasMultipart,
    bodyFieldNames,
    commandHasId,
    dispatchCall,
    isOptional,
    isBinary,
    // [G10] Async metadata consumed by buildMethodStrings for 202 + Location wrapping.
    isAsyncJobTracking,
    isAsyncFireForget,
    asyncStatusPath,
    multipartInputsList,
    ucName: ucClassName,
    aggName: agg.name,
    // [G12] consumes attribute for the HTTP annotation when the endpoint receives multipart form-data.
    consumes: hasMultipart ? 'MediaType.MULTIPART_FORM_DATA_VALUE' : null,
    // [G7] Pagination — sortable[] whitelist enforced by guard before dispatch.
    sortableFields: uc.pagination && Array.isArray(uc.pagination.sortable) ? uc.pagination.sortable : null,
    // [G3] @PreAuthorize expression from authorization.rolesAnyOf.
    preAuthorize: buildPreAuthorizeExpr(uc),
    // [G2] @Idempotent annotation metadata when uc.idempotency declared.
    idempotency: uc.idempotency || null,
  };
}

/**
 * Builds the @RequestParam annotations for each query field.
 * Matches query fields (from the Query record) to OpenAPI query params by name.
 * Fields not present in the OpenAPI spec are marked authContext: true (sourced from JWT).
 */
function buildQueryParamAnnotations(queryFields, openApiQueryParams, inputMap = new Map(), uc = null) {
  const result = [];
  const oaByName = new Map((openApiQueryParams || []).map((p) => [p.name, p]));
  // [G7] Pagination defaults — when uc.pagination is declared, page/size/sortBy/sortDirection
  // get authoritative defaults and (for size) a max constraint from the YAML.
  const pagination = uc && uc.pagination ? uc.pagination : null;
  const defaultSortField = pagination && pagination.defaultSort ? pagination.defaultSort.field : null;
  const defaultSortDir = pagination && pagination.defaultSort ? pagination.defaultSort.direction : null;

  for (const field of queryFields) {
    const ucInput = inputMap.get(field.name);
    // [G11] Header inputs are emitted as @RequestHeader (not @RequestParam) — skip here.
    if (ucInput && ucInput.source === 'header') continue;

    // [G8] Range[T] fields split into two @RequestParam (min/max) sharing the inner type.
    if (field.isRange) {
      const requiredR = ucInput ? ucInput.required === true : false;
      for (const suffix of ['Min', 'Max']) {
        result.push({
          name: `${field.name}${suffix}`,
          javaType: field.innerJavaType,
          required: requiredR,
          defaultValue: null,
          max: null,
          requestParamName: `${field.name}${suffix}`,
          authContext: false,
          isRangePart: true,
          rangeImportHint: field.innerImportHint || null,
        });
      }
      continue;
    }

    if (field.type === 'int') {
      // page or size — look up by name; uc.input.default overrides OpenAPI default.
      const oaParam = oaByName.get(field.name);
      const ucDefault = ucInput && ucInput.default != null ? ucInput.default : null;
      // [G7] Pagination defaults take precedence over OpenAPI/legacy fallbacks.
      let paginationDefault = null;
      if (pagination) {
        if (field.name === 'size' && pagination.defaultSize != null) paginationDefault = pagination.defaultSize;
        else if (field.name === 'page') paginationDefault = 0;
      }
      const defaultVal = ucDefault ?? paginationDefault ?? oaParam?.defaultValue ?? (field.name === 'page' ? 0 : 20);
      const ucMax = ucInput && Number.isInteger(ucInput.max) ? ucInput.max : null;
      const paginationMax = pagination && field.name === 'size' && Number.isInteger(pagination.maxSize) ? pagination.maxSize : null;
      result.push({
        name: field.name,
        javaType: 'int',
        required: false,
        defaultValue: String(defaultVal),
        max: ucMax ?? paginationMax,
        requestParamName: field.name,
        authContext: false,
      });
    } else if (pagination && (field.name === 'sortBy' || field.name === 'sortDirection')) {
      // [G7] Sort fields — defaultValue from pagination.defaultSort.
      const defaultVal = field.name === 'sortBy' ? defaultSortField : defaultSortDir;
      result.push({
        name: field.name,
        javaType: 'String',
        required: false,
        defaultValue: defaultVal != null ? String(defaultVal) : null,
        max: null,
        requestParamName: field.name,
        authContext: false,
      });
    } else {
      // Enum / String filter param — match by name; if absent from OpenAPI, comes from auth context
      const oaParam = oaByName.get(field.name);
      if (!oaParam && !(ucInput && ucInput.source === 'query')) {
        result.push({
          name: field.name,
          javaType: 'String',
          required: false,
          defaultValue: null,
          max: null,
          requestParamName: null,
          authContext: true,
        });
      } else {
        const required = oaParam ? (oaParam.required || false) : (ucInput.required !== false);
        const ucDefault = ucInput && ucInput.default != null ? String(ucInput.default) : null;
        result.push({
          name: field.name,
          javaType: field.type, // [G5] enum types preserved (e.g. ProductStatus); else 'String'
          required,
          defaultValue: ucDefault,
          max: null,
          requestParamName: oaParam && oaParam.name !== field.name ? oaParam.name : null,
          authContext: false,
        });
      }
    }
  }

  return result;
}

// ─── Internal operation builder ───────────────────────────────────────────────

/**
 * Builds a controller operation object for an internal API endpoint.
 * Internal ops use POST with a Query record as the request body and return a typed DTO.
 */
function buildInternalOperation(uc, internalApiOp, commonPrefix, agg, repoMethods, bcYaml = null) {
  const { httpMethod, fullPath, primaryResponseCode, summary, hasRequestBody, responseSchemaRef, isResponseArray, pathParams, queryParams } = internalApiOp;
  const mappingPath = fullPath.startsWith(commonPrefix)
    ? fullPath.slice(commonPrefix.length) || ''
    : fullPath;

  const ucClassName = toPascalCase(uc.name);
  const isCommand = uc.type === 'command';
  const responseSchemaName = responseSchemaRef ? responseSchemaRef.split('/').pop() : null;
  // Use uc.returns as source of truth (same normalisation as buildQueryReturnType) so that
  // projection / custom names like "ProductPriceSnapshot" are not incorrectly suffixed with Dto.
  const normalizeInner = (inner) => {
    if (inner === agg.name) return `${agg.name}ResponseDto`;
    if (inner.endsWith('Response')) return `${inner}Dto`;
    return inner;
  };
  const returnType = isCommand
    ? 'void'
    : uc.returns
      ? (() => {
          const paged = /^Page\[(.+)\]$/.exec(uc.returns);
          if (paged) return `PagedResponse<${normalizeInner(paged[1])}>`;
          const list = /^List\[(.+)\]$/.exec(uc.returns);
          if (list) return `List<${normalizeInner(list[1])}>`;
          // Optional[X] → Optional<XDto>; handler returns Optional<XDto> directly.
          const optional = /^Optional\[(.+)\]$/.exec(uc.returns);
          if (optional) return `Optional<${normalizeInner(optional[1])}>`;
          // [G4] canonical scalar return type (Uuid→UUID, Decimal→BigDecimal, etc.)
          const canonical = resolveCanonicalReturnType(uc.returns);
          if (canonical) return canonical.javaType;
          return normalizeInner(uc.returns);
        })()
      : responseSchemaName
        ? (isResponseArray ? `List<${responseSchemaName}Dto>` : `${responseSchemaName}Dto`)
        : 'void';

  // Build dispatchCall
  let dispatchCall;
  let bodyFieldNames = [];
  let commandHasId = false;

  if (isCommand) {
    const allCmdFields = getCommandFields(uc, agg);
    const pathFieldNames = new Set(pathParams);
    const aggNameCamel = toCamelCase(agg.name);
    const aggIdPathVar = pathParams.find((v) => v === `${aggNameCamel}Id`) || null;
    const resolveToPathVar = (fieldName) => {
      if (pathFieldNames.has(fieldName)) return fieldName;
      if (fieldName === 'id' && aggIdPathVar) return aggIdPathVar;
      return null;
    };
    bodyFieldNames = allCmdFields.filter((f) => resolveToPathVar(f) === null);
    commandHasId = allCmdFields.includes('id');
    const hasOnlyPathFields = allCmdFields.length > 0 && bodyFieldNames.length === 0 && !hasRequestBody;

    if (allCmdFields.length === 0) {
      dispatchCall = `new ${ucClassName}Command()`;
    } else if (hasOnlyPathFields || (!hasRequestBody && allCmdFields.length > 0)) {
      const args = allCmdFields.map((f) => resolveToPathVar(f) || f).join(', ');
      dispatchCall = `new ${ucClassName}Command(${args})`;
    } else if (hasRequestBody && commandHasId) {
      const args = allCmdFields
        .map((f) => { const pv = resolveToPathVar(f); return pv ? pv : `command.${f}()`; })
        .join(', ');
      dispatchCall = `new ${ucClassName}Command(${args})`;
    } else {
      dispatchCall = 'command';
    }
  }

  // For GET-style internal queries (no request body), derive @RequestParam fields and dispatch args
  // from the repository method signature — same logic as public queries in buildOperation.
  let internalQueryParamsList = [];
  if (!isCommand) {
    if (hasRequestBody) {
      dispatchCall = 'query';
    } else {
      const queryFields = getQueryFields(uc, agg, repoMethods);
      if (queryFields.length > 0) {
        const pathFieldSet = new Set(pathParams);
        // [G8] Range[T] fields are reassembled from split @RequestParam locals.
        const args = queryFields
          .map((f) => (f.isRange ? `new Range<>(${f.name}Min, ${f.name}Max)` : f.name))
          .join(', ');
        dispatchCall = `new ${ucClassName}Query(${args})`;
        internalQueryParamsList = buildQueryParamAnnotations(queryFields, queryParams || [])
          .filter((qp) => !pathFieldSet.has(qp.name));
      } else {
        dispatchCall = `new ${ucClassName}Query(${pathParams.join(', ')})`;
      }
    }
  }

  return {
    httpAnnotation: METHOD_ANNOTATION[httpMethod] || 'PostMapping',
    mappingPath,
    httpStatus: httpStatus(primaryResponseCode),
    methodName: toCamelCase(uc.trigger.operationId),
    summary,
    isCommand,
    isScaffold: true,
    returnType,
    rawReturns: uc.returns,
    pathVarNames: pathParams,
    queryParamsList: internalQueryParamsList,
    headerParamsList: [],
    hasRequestBody: isCommand ? (hasRequestBody && bodyFieldNames.length > 0) : hasRequestBody,
    bodyFieldNames,
    commandHasId,
    dispatchCall,
    ucName: ucClassName,
    aggName: uc.aggregate,
    isInternal: true,
    // [G3] @PreAuthorize also applies to internal endpoints when declared.
    preAuthorize: buildPreAuthorizeExpr(uc),
    // [G2] Idempotency may be declared on internal commands too.
    idempotency: uc.idempotency || null,
  };
}

// ─── Method signature builder ─────────────────────────────────────────────────

/**
 * Pre-computes everything a template method needs as plain strings.
 * Returns { methodParams, logMessage, logArgs, dispatchStatement }
 */
function buildMethodStrings(op) {
  const params = [];

  // Path variables
  for (const pv of op.pathVarNames) {
    params.push(`@PathVariable String ${pv}`);
  }

  // Request body (commands with body, or internal queries with body)
  if (op.isCommand && op.hasRequestBody) {
    params.push(`@Valid @RequestBody ${op.ucName}Command command`);
  } else if (op.isInternal && op.hasRequestBody) {
    params.push(`@Valid @RequestBody ${op.ucName}Query query`);
  }

  // [G12] Multipart parts — emitted as @RequestPart MultipartFile parameters.
  if (op.multipartInputsList && op.multipartInputsList.length > 0) {
    for (const mp of op.multipartInputsList) {
      const reqAttr = mp.required ? '' : ', required = false';
      params.push(`@RequestPart(value = "${mp.partName}"${reqAttr}) MultipartFile ${mp.name}`);
    }
  }

  // Query params (for GET queries) — skip authContext fields
  if (!op.isCommand && op.queryParamsList.length > 0) {
    for (const qp of op.queryParamsList) {
      if (qp.authContext) continue;
      const ann = buildRequestParamAnnotation(qp);
      const maxAnn = qp.max != null ? `@Max(${qp.max}) ` : '';
      params.push(`${ann} ${maxAnn}${qp.javaType} ${qp.name}`);
    }
  }

  // [G11] Header parameters (commands and queries)
  if (op.headerParamsList && op.headerParamsList.length > 0) {
    for (const hp of op.headerParamsList) {
      const parts = [`value = "${hp.headerName}"`];
      if (hp.required && hp.defaultValue == null) parts.push('required = true');
      else if (hp.defaultValue != null) parts.push(`defaultValue = "${hp.defaultValue}"`);
      else parts.push('required = false');
      params.push(`@RequestHeader(${parts.join(', ')}) ${hp.javaType} ${hp.name}`);
    }
  }

  const methodParams = params.join(', ');

  // Log message
  let logMessage = op.methodName;
  let logArgs = '';
  if (op.pathVarNames.length > 0) {
    const placeholders = op.pathVarNames.map(() => '{}').join(', ');
    logMessage += ` — ${op.pathVarNames.join(', ')}: ${placeholders}`;
    logArgs = ', ' + op.pathVarNames.join(', ');
  }

  // Auth-context local variable declarations
  const authContextLocals = (op.queryParamsList || [])
    .filter((qp) => qp.authContext)
    .map((qp) => `String ${qp.name} = SecurityContextHolder.getContext().getAuthentication().getName();`)
    .join('\n        ');

  // [G7] Sortable whitelist guard — runs before dispatch when pagination.sortable[] declared.
  let sortableGuard = '';
  if (op.sortableFields && op.sortableFields.length > 0) {
    const setLiteral = op.sortableFields.map((s) => `"${s}"`).join(', ');
    sortableGuard =
      `if (!java.util.Set.of(${setLiteral}).contains(sortBy)) {\n` +
      `            throw new BadRequestException("sortBy must be one of: ${op.sortableFields.join(', ')}");\n` +
      `        }`;
  }

  // [G12] Multipart guards — size and contentType validation per file.
  const multipartGuards = [];
  if (op.multipartInputsList && op.multipartInputsList.length > 0) {
    for (const mp of op.multipartInputsList) {
      if (mp.required) {
        multipartGuards.push(
          `if (${mp.name} == null || ${mp.name}.isEmpty()) {\n` +
          `            throw new BadRequestException("${mp.partName}: file part is required");\n` +
          `        }`
        );
      }
      if (mp.maxSizeBytes != null) {
        multipartGuards.push(
          `if (${mp.name} != null && ${mp.name}.getSize() > ${mp.maxSizeBytes}L) {\n` +
          `            throw new BadRequestException("${mp.partName}: file exceeds max size ${mp.maxSizeLabel}");\n` +
          `        }`
        );
      }
      if (mp.contentTypes && mp.contentTypes.length > 0) {
        const set = mp.contentTypes.map((c) => `"${c}"`).join(', ');
        multipartGuards.push(
          `if (${mp.name} != null && !${mp.name}.isEmpty() && !java.util.Set.of(${set}).contains(${mp.name}.getContentType())) {\n` +
          `            throw new BadRequestException("${mp.partName}: unsupported content type — allowed: ${mp.contentTypes.join(', ')}");\n` +
          `        }`
        );
      }
    }
  }

  // Dispatch statement
  const returnKeyword = (!op.isCommand || (op.returnType && op.returnType !== 'void')) ? 'return ' : '';
  // [G24] Optional[X] → ResponseEntity<X> with 200/404 mapping.
  // [G12] BinaryStream → ResponseEntity<Resource> with application/octet-stream.
  let dispatchLine;
  if (op.isOptional) {
    dispatchLine = `${returnKeyword}useCaseMediator.dispatch(${op.dispatchCall}).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());`;
  } else if (op.isBinary) {
    dispatchLine =
      `Resource resource = useCaseMediator.dispatch(${op.dispatchCall});\n` +
      `        return ResponseEntity.ok()\n` +
      `                .contentType(MediaType.APPLICATION_OCTET_STREAM)\n` +
      `                .body(resource);`;
  } else if (op.isAsyncJobTracking) {
    // [G10] Wrap JobReference in 202 Accepted with Location header pointing at
    // the status endpoint (if statusEndpoint resolved) or a generic /jobs path.
    const locationExpr = op.asyncStatusPath
      ? `URI.create("${op.asyncStatusPath}".replace("{jobId}", reference.jobId().toString()))`
      : `URI.create("/jobs/" + reference.jobId())`;
    dispatchLine =
      `JobReference reference = useCaseMediator.dispatch(${op.dispatchCall});\n` +
      `        URI location = ${locationExpr};\n` +
      `        return ResponseEntity.accepted().location(location).body(reference);`;
  } else if (op.isAsyncFireForget) {
    // [G10] Fire-and-forget — handler returns void, controller responds 202.
    dispatchLine = `useCaseMediator.dispatch(${op.dispatchCall});`;
  } else {
    dispatchLine = `${returnKeyword}useCaseMediator.dispatch(${op.dispatchCall});`;
  }
  const preamble = [authContextLocals, sortableGuard, ...multipartGuards].filter(Boolean).join('\n        ');
  const dispatchStatement = preamble
    ? `${preamble}\n        ${dispatchLine}`
    : dispatchLine;

  return { methodParams, logMessage, logArgs, dispatchStatement };
}

function buildRequestParamAnnotation(qp) {
  const parts = [];
  if (qp.requestParamName) parts.push(`name = "${qp.requestParamName}"`);
  if (qp.required) {
    parts.push('required = true');
  } else if (qp.defaultValue !== null && qp.defaultValue !== undefined) {
    parts.push(`defaultValue = "${qp.defaultValue}"`);
  } else {
    parts.push('required = false');
  }
  if (parts.length === 0) return '@RequestParam';
  return `@RequestParam(${parts.join(', ')})`;
}

// ─── Import builder ───────────────────────────────────────────────────────────

function buildControllerImports(operations, packageName, moduleName, bcYaml = null) {
  const imports = new Set();

  for (const op of operations) {
    if (op.isCommand) {
      imports.add(`${packageName}.${moduleName}.application.commands.${op.ucName}Command`);
    } else {
      imports.add(`${packageName}.${moduleName}.application.queries.${op.ucName}Query`);
    }
    if (!op.isCommand && op.returnType && op.returnType !== 'void') {
      let baseDtoType;
      if (op.returnType.startsWith('PagedResponse<')) {
        baseDtoType = op.returnType.replace('PagedResponse<', '').replace('>', '');
        imports.add(`${packageName}.shared.application.dtos.PagedResponse`);
      } else if (op.returnType.startsWith('List<')) {
        baseDtoType = op.returnType.replace('List<', '').replace('>', '');
        imports.add('java.util.List');
      } else if (op.returnType.startsWith('ResponseEntity<')) {
        // [G24] Optional[X] → ResponseEntity<X>
        // [G12] BinaryStream → ResponseEntity<Resource>
        baseDtoType = op.returnType.replace('ResponseEntity<', '').replace('>', '');
        imports.add('org.springframework.http.ResponseEntity');
      } else {
        baseDtoType = op.returnType;
      }
      // [G12] Resource lives in org.springframework.core.io, not in the BC dtos.
      if (baseDtoType === 'Resource') {
        imports.add('org.springframework.core.io.Resource');
        imports.add('org.springframework.http.MediaType');
      } else {
        // [G4] canonical scalar return type — import stdlib, not BC DTO.
        const canonicalReturn = resolveCanonicalReturnType(op.rawReturns);
        if (canonicalReturn) {
          if (canonicalReturn.importHint) imports.add(canonicalReturn.importHint);
        } else {
          imports.add(`${packageName}.${moduleName}.application.dtos.${baseDtoType}`);
        }
      }
    }
    // [G4] commands with returns: import the response DTO and any wrappers.
    if (op.isCommand && op.returnType && op.returnType !== 'void') {
      let baseDtoType;
      if (op.returnType.startsWith('PagedResponse<')) {
        baseDtoType = op.returnType.replace('PagedResponse<', '').replace('>', '');
        imports.add(`${packageName}.shared.application.dtos.PagedResponse`);
      } else if (op.returnType.startsWith('List<')) {
        baseDtoType = op.returnType.replace('List<', '').replace('>', '');
        imports.add('java.util.List');
      } else if (op.returnType.startsWith('ResponseEntity<')) {
        // [G10] jobTracking → ResponseEntity<JobReference>; the wrapper itself is
        // imported by the dedicated async block below; skip the BC dtos lookup.
        baseDtoType = null;
      } else if (op.returnType.startsWith('Optional<')) {
        // Command returns Optional<XDto>: import java.util.Optional + the inner DTO.
        baseDtoType = op.returnType.replace('Optional<', '').replace('>', '');
        imports.add('java.util.Optional');
      } else {
        baseDtoType = op.returnType;
      }
      if (baseDtoType) {
        // [G9] BulkResult and [G10] JobReference live in shared.application.dtos.
        if (baseDtoType === 'BulkResult' || baseDtoType === 'JobReference') {
          imports.add(`${packageName}.shared.application.dtos.${baseDtoType}`);
        } else {
          // [G4] canonical scalar return type — import stdlib, not BC DTO.
          const canonicalReturn = resolveCanonicalReturnType(op.rawReturns);
          if (canonicalReturn) {
            if (canonicalReturn.importHint) imports.add(canonicalReturn.importHint);
          } else {
            imports.add(`${packageName}.${moduleName}.application.dtos.${baseDtoType}`);
          }
        }
      }
    }
  }

  imports.add(`${packageName}.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator`);
  imports.add('io.swagger.v3.oas.annotations.Operation');
  imports.add('io.swagger.v3.oas.annotations.tags.Tag');
  imports.add('jakarta.validation.Valid');
  imports.add('lombok.extern.slf4j.Slf4j');
  imports.add('org.springframework.http.HttpStatus');
  imports.add('org.springframework.web.bind.annotation.*');

  // SecurityContextHolder if any operation uses authContext fields
  const needsSecurityContext = operations.some(
    (op) => (op.queryParamsList || []).some((qp) => qp.authContext)
  );
  if (needsSecurityContext) {
    imports.add('org.springframework.security.core.context.SecurityContextHolder');
  }

  // [G5] @Max annotation for numeric query params with declared "max"
  const needsMax = operations.some(
    (op) => (op.queryParamsList || []).some((qp) => qp.max != null)
  );
  if (needsMax) {
    imports.add('jakarta.validation.constraints.Max');
  }

  // [G7] BadRequestException for sortable[] whitelist guard.
  const needsBadRequest = operations.some((op) => op.sortableFields && op.sortableFields.length > 0);
  if (needsBadRequest) {
    imports.add(`${packageName}.shared.domain.customExceptions.BadRequestException`);
  }

  // [G12] Multipart imports — MultipartFile parameter type and BadRequestException
  // for size/contentType guards. Triggered by any op with multipart inputs.
  const needsMultipart = operations.some(
    (op) => op.multipartInputsList && op.multipartInputsList.length > 0
  );
  if (needsMultipart) {
    imports.add('org.springframework.web.multipart.MultipartFile');
    imports.add('org.springframework.http.MediaType');
    imports.add(`${packageName}.shared.domain.customExceptions.BadRequestException`);
  }

  // [G3] @PreAuthorize import when any operation declares authorization.rolesAnyOf.
  const needsPreAuthorize = operations.some((op) => op.preAuthorize);
  if (needsPreAuthorize) {
    imports.add('org.springframework.security.access.prepost.PreAuthorize');
  }

  // [G10] Async imports — JobReference + URI when any op is jobTracking, ResponseEntity always.
  const needsAsyncJobTracking = operations.some((op) => op.isAsyncJobTracking);
  if (needsAsyncJobTracking) {
    imports.add(`${packageName}.shared.application.dtos.JobReference`);
    imports.add('java.net.URI');
    imports.add('org.springframework.http.ResponseEntity');
  }

  // [G2] @Idempotent import when any operation declares idempotency.
  const needsIdempotent = operations.some((op) => op.idempotency);
  if (needsIdempotent) {
    imports.add(`${packageName}.shared.infrastructure.web.Idempotent`);
  }

  // [G8] Range[T] — when any query param is a split range part, import the shared
  // Range record and the inner type's hint (e.g. java.math.BigDecimal).
  for (const op of operations) {
    for (const qp of op.queryParamsList || []) {
      if (qp.isRangePart) {
        imports.add(`${packageName}.shared.application.dtos.Range`);
        if (qp.rangeImportHint) imports.add(qp.rangeImportHint);
      }
    }
  }

  // [G11] Enum imports for query/header params whose javaType is a BC enum
  if (bcYaml && bcYaml.enums) {
    const enumNames = new Set(bcYaml.enums.map((e) => e.name));
    for (const op of operations) {
      for (const qp of op.queryParamsList || []) {
        if (enumNames.has(qp.javaType)) {
          imports.add(`${packageName}.${moduleName}.domain.enums.${qp.javaType}`);
        }
      }
      for (const hp of op.headerParamsList || []) {
        if (enumNames.has(hp.javaType)) {
          imports.add(`${packageName}.${moduleName}.domain.enums.${hp.javaType}`);
        }
      }
    }
  }

  return [...imports].sort();
}

// ─── Main generator ───────────────────────────────────────────────────────────

async function generateControllerLayer(bcYaml, openApiDoc, internalApiDoc, config, outputDir) {
  const packageName = config.packageName;
  const moduleName = bcYaml.bc;

  const serverBaseUrl = openApiDoc.servers?.[0]?.url || '/api/v1';
  const publicOpsMap = buildOpsMap(openApiDoc);
  const internalOpsMap = internalApiDoc ? buildOpsMap(internalApiDoc) : new Map();
  const repoMethods = normalizeRepoMethods(bcYaml.repositories);

  // Index aggregates by name
  const aggregatesMap = {};
  for (const agg of bcYaml.aggregates || []) {
    aggregatesMap[agg.name] = agg;
  }

  // Group use cases by aggregate (only HTTP-triggered)
  const ucsByAggregate = {};
  for (const uc of bcYaml.useCases || []) {
    if (!uc.trigger || uc.trigger.kind !== 'http') continue;
    if (!uc.trigger.operationId) continue;
    const aggName = uc.aggregate;
    if (!ucsByAggregate[aggName]) ucsByAggregate[aggName] = [];
    ucsByAggregate[aggName].push(uc);
  }

  const bcDir = path.join(
    outputDir,
    'src',
    'main',
    'java',
    ...toPackagePath(packageName).split('/'),
    moduleName
  );

  let count = 0;

  for (const [aggName, ucs] of Object.entries(ucsByAggregate)) {
    const agg = aggregatesMap[aggName];
    if (!agg) continue;

    // Collect operations with their OpenAPI info
    const rawOperations = [];
    for (const uc of ucs) {
      const opId = uc.trigger.operationId;
      let openApiOp = publicOpsMap.get(opId);
      let isInternal = false;
      if (!openApiOp && internalOpsMap.has(opId)) {
        openApiOp = internalOpsMap.get(opId);
        isInternal = true;
      }
      if (!openApiOp) continue;
      rawOperations.push({ uc, openApiOp, isInternal });
    }

    if (rawOperations.length === 0) continue;

    // Find common path prefix for this aggregate's operations
    const allPaths = rawOperations.map(({ openApiOp }) => openApiOp.fullPath);
    const commonPrefix = findCommonPathPrefix(allPaths);
    const requestMapping = serverBaseUrl + commonPrefix;

    // Build operation objects for template (with pre-computed strings)
    const operations = rawOperations.map(({ uc, openApiOp, isInternal }) => {
      const op = isInternal
        ? buildInternalOperation(uc, openApiOp, commonPrefix, agg, repoMethods, bcYaml)
        : buildOperation(uc, agg, openApiOp, commonPrefix, repoMethods, bcYaml, publicOpsMap);
      const strings = buildMethodStrings(op);
      return { ...op, ...strings };
    });

    const controllerName = `${aggName}V1Controller`;
    const imports = buildControllerImports(operations, packageName, moduleName, bcYaml);

    const controllerDir = path.join(
      bcDir,
      'infrastructure',
      'rest',
      'controllers',
      toCamelCase(aggName),
      'v1'
    );

    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'controller', 'AggregateV1Controller.java.ejs'),
      path.join(controllerDir, `${controllerName}.java`),
      {
        packageName,
        moduleName,
        aggName,
        controllerName,
        requestMapping,
        operations,
        imports,
      }
    );

    count++;
  }

  return count;
}

module.exports = { generateControllerLayer };
