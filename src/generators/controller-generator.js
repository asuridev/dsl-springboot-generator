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

  for (const [fullPath, pathItem] of Object.entries(paths)) {
    const pathLevelParams = pathItem.parameters || [];

    for (const [httpMethod, operation] of Object.entries(pathItem)) {
      if (httpMethod === 'parameters') continue;
      if (typeof operation !== 'object' || !operation.operationId) continue;

      const opParams = [...pathLevelParams, ...(operation.parameters || [])];
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

      map.set(operation.operationId, {
        httpMethod: httpMethod.toUpperCase(),
        fullPath,
        pathParams,
        queryParams,
        hasRequestBody: !!operation.requestBody,
        primaryResponseCode: parseInt(primaryCode, 10),
        summary: operation.summary || operation.operationId,
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
    if (prop && prop.source === 'auth-context') continue;
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
  const m = methodStr.match(/^(\w+)\(([^)]*)\)/);
  if (!m) return { methodName: methodStr, params: [] };
  const params = m[2].trim()
    ? m[2].split(',').map((p) => {
        const t = p.trim();
        return { name: t.replace('?', '').trim(), optional: t.endsWith('?') };
      })
    : [];
  return { methodName: m[1], params };
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
  const methodParams = (repoMethods[agg.name] || {})[repoMethodName] || [];
  const fields = [];

  if (methodParams.length > 0) {
    for (const param of methodParams) {
      if (param.type === 'PageRequest' || param.type === 'Pageable') {
        fields.push({ name: 'page', type: 'int' });
        fields.push({ name: 'size', type: 'int' });
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
      result[repo.aggregate][method.name] = normalizeMethodParams(method);
    }
  }
  return result;
}

function normalizeMethodParams(method) {
  if (method.params && Array.isArray(method.params)) {
    return method.params.map((p) => ({
      name: p.name,
      type: p.type,
      required: p.required !== false,
    }));
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
  const methodParams = (repoMethods[agg.name] || {})[repoMethodName] || [];
  return methodParams.some((p) => p.type === 'PageRequest' || p.type === 'Pageable');
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

  // Paged query detection
  const paged = isQuery && isPagedQuery(uc, agg, repoMethods);
  const returnType = isQuery
    ? paged
      ? `PagedResponse<${agg.name}ResponseDto>`
      : `${agg.name}ResponseDto`
    : 'void';

  // Command fields (in declaration order from the record)
  const allCmdFields = isQuery ? [] : getCommandFields(uc, agg);
  // Fields that come from path variables (by name)
  const pathFieldNames = new Set(pathVarNames);
  const bodyFieldNames = allCmdFields.filter((f) => !pathFieldNames.has(f));
  const commandHasId = allCmdFields.includes('id');
  const hasOnlyPathFields =
    allCmdFields.length > 0 && bodyFieldNames.length === 0 && !hasRequestBody;

  // Query fields (for @RequestParam generation)
  const queryFieldsList = isQuery ? getQueryFields(uc, agg, repoMethods) : [];

  // Build dispatch call string
  let dispatchCall;
  if (isQuery) {
    // All query fields come from path vars or @RequestParam
    const args = queryFieldsList.map((f) => f.name).join(', ');
    dispatchCall = `new ${uc.name}Query(${args})`;
  } else if (hasOnlyPathFields || (!hasRequestBody && allCmdFields.length > 0)) {
    // All fields from path (e.g., DeactivateCategory, DeleteCategory)
    const args = allCmdFields.map((f) => (pathFieldNames.has(f) ? f : f)).join(', ');
    dispatchCall = `new ${uc.name}Command(${args})`;
  } else if (hasRequestBody && commandHasId) {
    // Mix of path id + body fields
    const args = allCmdFields
      .map((f) => (pathFieldNames.has(f) ? f : `command.${f}()`))
      .join(', ');
    dispatchCall = `new ${uc.name}Command(${args})`;
  } else {
    // Create (no path id) — dispatch body command directly
    dispatchCall = 'command';
  }

  // Build OpenAPI query params that are NOT path vars and NOT paging
  const pathVarSet = new Set(pathVarNames);
  const controllerQueryParams = isQuery
    ? buildQueryParamAnnotations(queryFieldsList, queryParams).filter(qp => !pathVarSet.has(qp.name))
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
    ucName: uc.name,
    aggName: agg.name,
  };
}

/**
 * Builds the @RequestParam annotations for each query field.
 * Matches query fields (from the Query record) to OpenAPI query params by type/position.
 */
function buildQueryParamAnnotations(queryFields, openApiQueryParams) {
  const result = [];
  let oaIdx = 0;

  for (const field of queryFields) {
    if (field.type === 'int') {
      // page or size — find matching OpenAPI param by name
      const oaParam = openApiQueryParams.find((p) => p.name === field.name);
      const defaultVal = oaParam?.defaultValue ?? (field.name === 'page' ? 0 : 20);
      result.push({
        name: field.name,
        javaType: 'int',
        required: false,
        defaultValue: String(defaultVal),
        requestParamName: field.name,
      });
    } else {
      // String filter field — find next non-paging OpenAPI param
      while (oaIdx < openApiQueryParams.length && (openApiQueryParams[oaIdx].name === 'page' || openApiQueryParams[oaIdx].name === 'size')) {
        oaIdx++;
      }
      const oaParam = openApiQueryParams[oaIdx];
      const oaParamName = oaParam ? oaParam.name : field.name;
      const required = oaParam ? oaParam.required : false;
      result.push({
        name: field.name,
        javaType: 'String',
        required,
        defaultValue: null,
        requestParamName: oaParamName !== field.name ? oaParamName : null,
      });
      oaIdx++;
    }
  }

  return result;
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

  // Request body (commands with body)
  if (op.isCommand && op.hasRequestBody) {
    params.push(`@Valid @RequestBody ${op.ucName}Command command`);
  }

  // Query params (for GET queries)
  if (!op.isCommand && op.queryParamsList.length > 0) {
    for (const qp of op.queryParamsList) {
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

  // Dispatch statement
  const returnKeyword = !op.isCommand ? 'return ' : '';
  const dispatchStatement = `${returnKeyword}useCaseMediator.dispatch(${op.dispatchCall});`;

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
      const baseDtoType = op.returnType.replace('PagedResponse<', '').replace('>', '');
      imports.add(`${packageName}.${moduleName}.application.dtos.${baseDtoType}`);
      if (op.returnType.startsWith('PagedResponse')) {
        imports.add(`${packageName}.shared.application.dtos.PagedResponse`);
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

  return [...imports].sort();
}

// ─── Main generator ───────────────────────────────────────────────────────────

async function generateControllerLayer(bcYaml, openApiDoc, config, outputDir) {
  const packageName = config.packageName;
  const moduleName = bcYaml.bc;

  const serverBaseUrl = openApiDoc.servers?.[0]?.url || '/api/v1';
  const opsMap = buildOpsMap(openApiDoc);
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
      const openApiOp = opsMap.get(opId);
      if (!openApiOp) continue;
      rawOperations.push({ uc, openApiOp });
    }

    if (rawOperations.length === 0) continue;

    // Find common path prefix for this aggregate's operations
    const allPaths = rawOperations.map(({ openApiOp }) => openApiOp.fullPath);
    const commonPrefix = findCommonPathPrefix(allPaths);
    const requestMapping = serverBaseUrl + commonPrefix;

    // Build operation objects for template (with pre-computed strings)
    const operations = rawOperations.map(({ uc, openApiOp }) => {
      const op = buildOperation(uc, agg, openApiOp, commonPrefix, repoMethods);
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
