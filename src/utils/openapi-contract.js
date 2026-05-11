'use strict';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

function buildOpenApiOperationMap(doc, options = {}) {
  const operations = new Map();
  const diagnostics = options.diagnostics || null;
  const bcName = options.bcName || '<unknown-bc>';
  const docKind = options.docKind || 'open-api';
  if (!doc) return operations;

  for (const [urlPath, pathItem] of Object.entries(doc.paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    const pathParameters = resolveParameters(pathItem.parameters || [], doc);

    for (const [method, operation] of Object.entries(pathItem)) {
      const normalizedMethod = String(method).toLowerCase();
      if (!HTTP_METHODS.has(normalizedMethod)) continue;
      if (!operation || typeof operation !== 'object') continue;
      const operationId = operation.operationId;
      if (!operationId) continue;

      if (operations.has(operationId)) {
        if (diagnostics) {
          diagnostics.push({
            code: 'HTTP-002',
            level: 'error',
            message: `Duplicate operationId "${operationId}" in ${docKind} for BC "${bcName}".`,
            location: `arch/${bcName}/${bcName}-${docKind}.yaml paths.${urlPath}.${method}.operationId`,
          });
        }
        continue;
      }

      const operationParameters = resolveParameters(operation.parameters || [], doc);
      const parameters = [...pathParameters, ...operationParameters];
      operations.set(operationId, {
        operationId,
        method: normalizedMethod.toUpperCase(),
        httpMethod: normalizedMethod.toUpperCase(),
        path: urlPath,
        fullPath: urlPath,
        operation,
        doc,
        docKind,
        parameters,
        summary: operation.summary || operationId,
        description: operation.description || '',
        tags: operation.tags || [],
        requestBody: operation.requestBody || null,
        responses: operation.responses || {},
      });
    }
  }

  return operations;
}

function resolveParameters(parameters, doc) {
  return (parameters || [])
    .map((parameter) => resolveParameter(parameter, doc))
    .filter(Boolean);
}

function resolveParameter(parameter, doc) {
  if (!parameter || !parameter.$ref) return parameter;
  const refPrefix = '#/components/parameters/';
  if (!parameter.$ref.startsWith(refPrefix)) return null;
  const paramName = parameter.$ref.slice(refPrefix.length);
  return doc && doc.components && doc.components.parameters
    ? doc.components.parameters[paramName] || null
    : null;
}

function hasParameter(parameters, name, source) {
  return (parameters || []).some((parameter) => parameter && parameter.name === name && parameter.in === source);
}

function resolveRequestBodySchema(requestBody, doc) {
  const content = requestBody && requestBody.content ? requestBody.content : {};
  const media = content['application/json'] || Object.values(content)[0];
  if (!media || !media.schema) return null;
  return resolveSchema(media.schema, doc);
}

function resolveSchema(schema, doc) {
  if (!schema || !schema.$ref) return schema;
  const refPrefix = '#/components/schemas/';
  if (!schema.$ref.startsWith(refPrefix)) return schema;
  const schemaName = schema.$ref.slice(refPrefix.length);
  return doc && doc.components && doc.components.schemas
    ? doc.components.schemas[schemaName] || schema
    : schema;
}

function findSuccessResponseSchema(responses) {
  for (const [status, response] of Object.entries(responses || {})) {
    const statusCode = String(status);
    if (!statusCode.startsWith('2')) continue;
    const content = response && response.content ? response.content : {};
    const media = content['application/json'] || Object.values(content)[0];
    return media && media.schema ? media.schema : null;
  }
  return null;
}

function isPrimitiveReturnType(returnType) {
  const normalized = String(returnType).toLowerCase();
  return normalized === 'uuid'
    || normalized === 'string'
    || normalized.startsWith('string(')
    || normalized === 'integer'
    || normalized === 'int'
    || normalized === 'long'
    || normalized === 'decimal'
    || normalized === 'double'
    || normalized === 'float'
    || normalized === 'boolean'
    || normalized === 'bool';
}

function isPrimitiveSchemaCompatible(returnType, schema) {
  const normalized = String(returnType).toLowerCase();
  if (normalized === 'uuid') return schema.type === 'string' && schema.format === 'uuid';
  if (normalized === 'string' || normalized.startsWith('string(')) return schema.type === 'string';
  if (normalized === 'integer' || normalized === 'int' || normalized === 'long') return schema.type === 'integer';
  if (normalized === 'decimal' || normalized === 'double' || normalized === 'float') return schema.type === 'number' || schema.type === 'integer';
  if (normalized === 'boolean' || normalized === 'bool') return schema.type === 'boolean';
  return false;
}

module.exports = {
  HTTP_METHODS,
  buildOpenApiOperationMap,
  findSuccessResponseSchema,
  hasParameter,
  isPrimitiveReturnType,
  isPrimitiveSchemaCompatible,
  resolveRequestBodySchema,
  resolveSchema,
};
