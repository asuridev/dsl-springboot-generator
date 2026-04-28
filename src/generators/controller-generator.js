'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPascalCase, toCamelCase, toPackagePath } = require('../utils/naming');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

// ─── OpenAPI parsing ──────────────────────────────────────────────────────────

/**
 * Flattens all OpenAPI paths into a map: operationId → operation info.
 * Merges path-level parameters with operation-level parameters.
 */
function buildOpsMap(openApiDoc) {
  const map = new Map();
  const paths = openApiDoc.paths || {};
  const componentParams = openApiDoc.components?.parameters || {};

  // Resolve a parameter that might be a $ref to components/parameters
  function resolveParam(p) {
    if (p.$ref) {
      const refName = p.$ref.split('/').pop();
      return componentParams[refName] || null;
    }
    return p;
  }

  for (const [fullPath, pathItem] of Object.entries(paths)) {
    const pathLevelParams = (pathItem.parameters || []).map(resolveParam).filter(Boolean);

    for (const [httpMethod, operation] of Object.entries(pathItem)) {
      if (httpMethod === 'parameters') continue;
      if (typeof operation !== 'object' || !operation.operationId) continue;

      const opParams = [...pathLevelParams, ...(operation.parameters || []).map(resolveParam).filter(Boolean)];
      const pathParams = opParams.filter((p) => !p.$ref && p.in === 'path').map((p) => p.name);
      const queryParams = opParams
        .filter((p) => !p.$ref && p.in === 'query')
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

      map.set(operation.operationId, {
        httpMethod: httpMethod.toUpperCase(),
        fullPath,
        pathParams,
        queryParams,
        hasRequestBody: !!operation.requestBody,
        primaryResponseCode: parseInt(primaryCode, 10),
        summary: operation.summary || operation.operationId,
        responseSchemaRef,
        isResponseArray,
      });
    }
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
  if (code === 204) return 'HttpStatus.NO_CONTENT';
  return 'HttpStatus.OK';
}

// ─── Command field extraction ─────────────────────────────────────────────────
// Minimal re-implementation (mirrors application-generator logic) to determine
// command fields without re-running the full SP-5 generator.

function getCommandFields(uc, agg) {
  const { methodName, params } = parseMethodSignature(uc.method || '');
  const propMap = buildPropertyMap(agg);
  const isCreate = methodName.startsWith('create');
  const notFoundErrors = normalizeNotFoundErrors(uc.notFoundError);
  const hasNotFoundError = notFoundErrors.length > 0;
  const fields = [];

  if (!isCreate && hasNotFoundError && !params.some((p) => p.name === 'id')) {
    fields.push('id');
  }

  for (const param of params) {
    const prop = propMap.get(param.name);
    // Only skip auto-generated fields for create operations (they're set server-side)
    if (isCreate && prop && prop.readOnly && prop.defaultValue === 'generated') continue;
    if (prop && prop.source === 'authContext') continue;
    const rawType = resolveParamType(param.name, propMap);
    if (rawType === 'Money') {
      fields.push(`${param.name}Amount`);
      fields.push(`${param.name}Currency`);
    } else {
      fields.push(param.name);
    }
  }

  return fields;
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

function getQueryFields(uc, agg, repoMethods) {
  const repoMethodName = parseRepoMethodNameStr(uc.repositoryMethod);
  const methodEntry = (repoMethods[agg.name] || {})[repoMethodName] || {};
  const methodParams = methodEntry.params || [];
  const fields = [];

  if (methodParams.length > 0) {
    for (const param of methodParams) {
      if (param.type === 'PageRequest' || param.type === 'Pageable') {
        fields.push({ name: 'page', type: 'int' });
        fields.push({ name: 'size', type: 'int' });
      } else if ((param.name === 'page' || param.name === 'size') && param.type === 'Integer') {
        fields.push({ name: param.name, type: 'int' });
      } else {
        fields.push({ name: param.name, type: 'String' });
      }
    }
    return fields;
  }

  // Fallback: parse repositoryMethod string
  if (uc.repositoryMethod) {
    const match = uc.repositoryMethod.match(/\(([^)]*)\)/);
    if (match && match[1].trim()) {
      for (const p of match[1].split(',')) {
        const t = p.trim().replace('?', '');
        if (t === 'PageRequest' || t === 'Pageable') {
          fields.push({ name: 'page', type: 'int' });
          fields.push({ name: 'size', type: 'int' });
        } else if (t === 'Uuid') {
          fields.push({ name: 'id', type: 'String' });
        } else {
          fields.push({ name: toCamelCase(t), type: 'String' });
        }
      }
    }
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
    for (const method of repo.methods || []) {
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
  const repoMethodName = parseRepoMethodNameStr(uc.repositoryMethod);
  const methodEntry = (repoMethods[agg.name] || {})[repoMethodName] || {};
  const methodParams = methodEntry.params || [];
  return methodParams.some((p) => p.type === 'PageRequest' || p.type === 'Pageable')
    || (methodParams.some((p) => p.name === 'page' && p.type === 'Integer')
       && methodParams.some((p) => p.name === 'size' && p.type === 'Integer'));
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

// ─── Build controller operation ───────────────────────────────────────────────

function buildOperation(uc, agg, openApiOp, commonPrefix, repoMethods) {
  const { httpMethod, fullPath, pathParams, queryParams, hasRequestBody, primaryResponseCode, summary } = openApiOp;

  // Relative path within this controller (strip common prefix)
  const mappingPath = fullPath.startsWith(commonPrefix)
    ? fullPath.slice(commonPrefix.length) || ''
    : fullPath;

  const pathVarNames = (fullPath.match(/\{(\w+)\}/g) || []).map((m) => m.slice(1, -1));

  const isQuery = uc.type === 'query';
  const isScaffold = uc.implementation === 'scaffold';

  // Paged / list query detection
  const paged = isQuery && isPagedQuery(uc, agg, repoMethods);
  const repoMethodNameQ = isQuery ? parseRepoMethodNameStr(uc.repositoryMethod) : '';
  const repoMethodEntryQ = isQuery ? ((repoMethods[agg.name] || {})[repoMethodNameQ] || {}) : {};
  const repoReturns = repoMethodEntryQ.returns || '';
  const isList = !paged && isQuery && (repoReturns.startsWith('List[') || repoReturns.startsWith('List<'));
  const returnType = isQuery
    ? paged
      ? `PagedResponse<${agg.name}ResponseDto>`
      : isList
        ? `List<${agg.name}ResponseDto>`
        : `${agg.name}ResponseDto`
    : 'void';

  // Command fields (in declaration order from the record)
  const allCmdFields = isQuery ? [] : getCommandFields(uc, agg);
  // Fields that come from path variables (by name)
  const pathFieldNames = new Set(pathVarNames);
  // getCommandFields auto-injects 'id' for non-create commands with notFoundError,
  // but OpenAPI paths name it '{aggName}Id' (e.g. customerId, addressId).
  // aggIdPathVar bridges this mismatch so dispatches resolve to the real path variable.
  const aggNameCamel = toCamelCase(agg.name);
  const aggIdPathVar = pathVarNames.find((v) => v === `${aggNameCamel}Id`) || null;
  // Returns the path variable name a field resolves to, or null if it's a body/param field.
  const resolveToPathVar = (fieldName) => {
    if (pathFieldNames.has(fieldName)) return fieldName;
    if (fieldName === 'id' && aggIdPathVar) return aggIdPathVar;
    return null;
  };
  const bodyFieldNames = allCmdFields.filter((f) => resolveToPathVar(f) === null);
  const commandHasId = allCmdFields.includes('id');
  const hasOnlyPathFields =
    allCmdFields.length > 0 && bodyFieldNames.length === 0 && !hasRequestBody;

  // Query fields (for @RequestParam generation)
  const queryFieldsList = isQuery ? getQueryFields(uc, agg, repoMethods) : [];

  // Build dispatch call string
  const ucClassName = toPascalCase(uc.name);
  let dispatchCall;
  if (isQuery) {
    // All query fields come from path vars or @RequestParam
    const args = queryFieldsList.map((f) => resolveToPathVar(f.name) || f.name).join(', ');
    dispatchCall = `new ${ucClassName}Query(${args})`;
  } else if (allCmdFields.length === 0) {
    // No command fields (all injected server-side e.g. authContext) — instantiate empty record
    dispatchCall = `new ${ucClassName}Command()`;
  } else if (hasOnlyPathFields || (!hasRequestBody && allCmdFields.length > 0)) {
    // All fields from path (e.g., DeactivateCategory, DeleteCategory)
    const args = allCmdFields.map((f) => resolveToPathVar(f) || f).join(', ');
    dispatchCall = `new ${ucClassName}Command(${args})`;
  } else if (hasRequestBody && commandHasId) {
    // Mix of path id + body fields
    const args = allCmdFields
      .map((f) => {
        const pv = resolveToPathVar(f);
        return pv ? pv : `command.${f}()`;
      })
      .join(', ');
    dispatchCall = `new ${ucClassName}Command(${args})`;
  } else {
    // Create (no path id) — dispatch body command directly
    dispatchCall = 'command';
  }

  // Build OpenAPI query params that are NOT path vars and NOT paging
  const controllerQueryParams = isQuery
    ? buildQueryParamAnnotations(queryFieldsList, queryParams).filter(qp => !resolveToPathVar(qp.name))
    : [];

  return {
    httpAnnotation: METHOD_ANNOTATION[httpMethod] || 'PostMapping',
    mappingPath,
    httpStatus: httpStatus(primaryResponseCode),
    methodName: toCamelCase(uc.trigger.operationId),
    summary,
    isCommand: !isQuery,
    isScaffold,
    returnType,
    pathVarNames,
    queryParamsList: controllerQueryParams,
    hasRequestBody: hasRequestBody && !hasOnlyPathFields,
    bodyFieldNames,
    commandHasId,
    dispatchCall,
    ucName: ucClassName,
    aggName: agg.name,
  };
}

/**
 * Builds the @RequestParam annotations for each query field.
 * Matches query fields (from the Query record) to OpenAPI query params by name.
 * Fields not present in the OpenAPI spec are marked authContext: true (sourced from JWT).
 */
function buildQueryParamAnnotations(queryFields, openApiQueryParams) {
  const result = [];
  const oaByName = new Map((openApiQueryParams || []).map((p) => [p.name, p]));

  for (const field of queryFields) {
    if (field.type === 'int') {
      // page or size — look up by name
      const oaParam = oaByName.get(field.name);
      const defaultVal = oaParam?.defaultValue ?? (field.name === 'page' ? 0 : 20);
      result.push({
        name: field.name,
        javaType: 'int',
        required: false,
        defaultValue: String(defaultVal),
        requestParamName: field.name,
        authContext: false,
      });
    } else {
      // String field — match by name; if absent from OpenAPI, comes from auth context
      const oaParam = oaByName.get(field.name);
      if (!oaParam) {
        result.push({
          name: field.name,
          javaType: 'String',
          required: false,
          defaultValue: null,
          requestParamName: null,
          authContext: true,
        });
      } else {
        result.push({
          name: field.name,
          javaType: 'String',
          required: oaParam.required || false,
          defaultValue: null,
          requestParamName: oaParam.name !== field.name ? oaParam.name : null,
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
function buildInternalOperation(uc, internalApiOp, commonPrefix, agg, repoMethods) {
  const { httpMethod, fullPath, primaryResponseCode, summary, hasRequestBody, responseSchemaRef, isResponseArray, pathParams, queryParams } = internalApiOp;
  const mappingPath = fullPath.startsWith(commonPrefix)
    ? fullPath.slice(commonPrefix.length) || ''
    : fullPath;

  const ucClassName = toPascalCase(uc.name);
  const isCommand = uc.type === 'command';
  const responseSchemaName = responseSchemaRef ? responseSchemaRef.split('/').pop() : null;
  const returnType = isCommand
    ? 'void'
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
        const args = queryFields.map((f) => f.name).join(', ');
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
    pathVarNames: pathParams,
    queryParamsList: internalQueryParamsList,
    hasRequestBody: isCommand ? (hasRequestBody && bodyFieldNames.length > 0) : hasRequestBody,
    bodyFieldNames,
    commandHasId,
    dispatchCall,
    ucName: ucClassName,
    aggName: uc.aggregate,
    isInternal: true,
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

  // Query params (for GET queries) — skip authContext fields
  if (!op.isCommand && op.queryParamsList.length > 0) {
    for (const qp of op.queryParamsList) {
      if (qp.authContext) continue;
      const ann = buildRequestParamAnnotation(qp);
      params.push(`${ann} ${qp.javaType} ${qp.name}`);
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

  // Dispatch statement
  const returnKeyword = !op.isCommand ? 'return ' : '';
  const dispatchLine = `${returnKeyword}useCaseMediator.dispatch(${op.dispatchCall});`;
  const dispatchStatement = authContextLocals
    ? `${authContextLocals}\n        ${dispatchLine}`
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

function buildControllerImports(operations, packageName, moduleName) {
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
      } else {
        baseDtoType = op.returnType;
      }
      imports.add(`${packageName}.${moduleName}.application.dtos.${baseDtoType}`);
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
        ? buildInternalOperation(uc, openApiOp, commonPrefix, agg, repoMethods)
        : buildOperation(uc, agg, openApiOp, commonPrefix, repoMethods);
      const strings = buildMethodStrings(op);
      return { ...op, ...strings };
    });

    const controllerName = `${aggName}V1Controller`;
    const imports = buildControllerImports(operations, packageName, moduleName);

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
