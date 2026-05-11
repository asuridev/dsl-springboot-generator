'use strict';

/**
 * Cross-validates HTTP-triggered use cases against public/internal OpenAPI docs.
 * This validator is intentionally small and fail-fast: it catches operationId
 * drift before controller/application templates silently skip declared work.
 */

const {
  buildOpenApiOperationMap,
  findSuccessResponseSchema,
  hasParameter,
  isPrimitiveReturnType,
  isPrimitiveSchemaCompatible,
  resolveRequestBodySchema,
} = require('./openapi-contract');

const PARAMETER_SOURCES = new Set(['path', 'query', 'header']);

function validateOpenApiUseCases(bcYaml, openApiDoc = null, internalApiDoc = null) {
  const diagnostics = [];
  const bcName = bcYaml && bcYaml.bc ? bcYaml.bc : '<unknown-bc>';
  diagnostics.push(...validateOpenApiDocumentSchemas(bcName, openApiDoc, 'open-api'));
  diagnostics.push(...validateOpenApiDocumentSchemas(bcName, internalApiDoc, 'internal-api'));
  const publicOps = buildOpenApiOperationMap(openApiDoc, { bcName, docKind: 'open-api', diagnostics });
  const internalOps = buildOpenApiOperationMap(internalApiDoc, { bcName, docKind: 'internal-api', diagnostics });
  const allOps = new Map([...publicOps, ...internalOps]);

  for (const duplicate of duplicateAcross(publicOps, internalOps)) {
    diagnostics.push({
      code: 'HTTP-002',
      level: 'error',
      message: `operationId "${duplicate}" is declared in both public OpenAPI and Internal API for BC "${bcName}".`,
      location: `arch/${bcName}/{${bcName}-open-api.yaml,${bcName}-internal-api.yaml}`,
    });
  }

  for (const uc of bcYaml.useCases || []) {
    if (!uc || !uc.trigger || uc.trigger.kind !== 'http') continue;
    const operationId = uc.trigger.operationId;
    if (!operationId) continue;
    const operation = allOps.get(operationId);
    if (!operation) {
      diagnostics.push({
        code: 'HTTP-001',
        level: 'error',
        message: `Use case "${uc.id || uc.name}" references operationId "${operationId}" but it is not declared in ${bcName}-open-api.yaml or ${bcName}-internal-api.yaml.`,
        location: `arch/${bcName}/${bcName}.yaml useCases[${uc.id || uc.name}].trigger.operationId`,
      });
      continue;
    }

    diagnostics.push(...validateUseCaseInputs(bcName, uc, operation));
    diagnostics.push(...validateUseCaseReturn(bcName, uc, operation));
  }

  return diagnostics;
}

function validateOpenApiDocumentSchemas(bcName, doc, docKind) {
  const diagnostics = [];
  if (!doc) return diagnostics;
  const schemaNames = new Set(Object.keys((doc.components && doc.components.schemas) || {}));
  const visitedRefs = new Set();

  const visitSchema = (schema, location) => {
    if (!schema || typeof schema !== 'object') return;
    if (schema.$ref) {
      const refPrefix = '#/components/schemas/';
      if (schema.$ref.startsWith(refPrefix)) {
        const schemaName = schema.$ref.slice(refPrefix.length);
        if (!schemaNames.has(schemaName)) {
          diagnostics.push({
            code: 'HTTP-008',
            level: 'error',
            message: `${docKind} for BC "${bcName}" references missing component schema "${schemaName}".`,
            location,
          });
          return;
        }
        if (!visitedRefs.has(schemaName)) {
          visitedRefs.add(schemaName);
          visitSchema(doc.components.schemas[schemaName], `arch/${bcName}/${bcName}-${docKind}.yaml components.schemas.${schemaName}`);
        }
      }
      return;
    }

    for (const key of ['allOf', 'oneOf', 'anyOf']) {
      if (Array.isArray(schema[key])) {
        schema[key].forEach((entry, index) => visitSchema(entry, `${location}.${key}[${index}]`));
      }
    }

    if (schema.type === 'array') {
      if (!schema.items) {
        diagnostics.push({
          code: 'HTTP-009',
          level: 'error',
          message: `${docKind} for BC "${bcName}" declares an array schema without items.`,
          location,
        });
      } else {
        visitSchema(schema.items, `${location}.items`);
      }
      return;
    }

    if (schema.properties && typeof schema.properties === 'object') {
      for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
        const propertyLocation = `${location}.properties.${propertyName}`;
        if (!propertySchema || typeof propertySchema !== 'object') continue;
        const hasTypeInfo = propertySchema.type || propertySchema.$ref || propertySchema.allOf || propertySchema.oneOf || propertySchema.anyOf;
        if (!hasTypeInfo) {
          diagnostics.push({
            code: 'HTTP-009',
            level: 'error',
            message: `${docKind} for BC "${bcName}" property "${propertyName}" has no type, $ref, or composition schema.`,
            location: propertyLocation,
          });
          continue;
        }
        visitSchema(propertySchema, propertyLocation);
      }
    }
  };

  for (const [schemaName, schema] of Object.entries((doc.components && doc.components.schemas) || {})) {
    visitSchema(schema, `arch/${bcName}/${bcName}-${docKind}.yaml components.schemas.${schemaName}`);
  }

  for (const [urlPath, pathItem] of Object.entries(doc.paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operation || typeof operation !== 'object') continue;
      const opLocation = `arch/${bcName}/${bcName}-${docKind}.yaml paths.${urlPath}.${method}`;
      const requestContent = operation.requestBody && operation.requestBody.content ? operation.requestBody.content : {};
      for (const [mediaType, media] of Object.entries(requestContent)) {
        if (media && media.schema) visitSchema(media.schema, `${opLocation}.requestBody.content.${mediaType}.schema`);
      }
      for (const [status, response] of Object.entries(operation.responses || {})) {
        const responseContent = response && response.content ? response.content : {};
        for (const [mediaType, media] of Object.entries(responseContent)) {
          if (media && media.schema) visitSchema(media.schema, `${opLocation}.responses.${status}.content.${mediaType}.schema`);
        }
      }
    }
  }

  return diagnostics;
}

function duplicateAcross(publicOps, internalOps) {
  const duplicates = [];
  for (const operationId of publicOps.keys()) {
    if (internalOps.has(operationId)) duplicates.push(operationId);
  }
  return duplicates;
}

function validateUseCaseInputs(bcName, uc, operationEntry) {
  const diagnostics = [];
  const operation = operationEntry.operation || {};
  const parameters = operationEntry.parameters || [];
  const bodyInputs = [];

  for (const input of uc.input || []) {
    if (!input || !input.source) continue;
    const source = String(input.source);
    if (PARAMETER_SOURCES.has(source)) {
      if (!hasParameter(parameters, input.name, source)) {
        diagnostics.push({
          code: 'HTTP-003',
          level: 'error',
          message: `Use case "${uc.id || uc.name}" declares ${source} input "${input.name}" but operationId "${uc.trigger.operationId}" does not declare that OpenAPI parameter.`,
          location: `arch/${bcName}/${bcName}.yaml useCases[${uc.id || uc.name}].input[${input.name}]`,
        });
      }
      continue;
    }
    if (source === 'body') bodyInputs.push(input);
  }

  if (bodyInputs.length === 0) return diagnostics;

  if (!operation.requestBody) {
    diagnostics.push({
      code: 'HTTP-004',
      level: 'error',
      message: `Use case "${uc.id || uc.name}" declares body inputs but operationId "${uc.trigger.operationId}" has no OpenAPI requestBody.`,
      location: `arch/${bcName}/${bcName}.yaml useCases[${uc.id || uc.name}].input`,
    });
    return diagnostics;
  }

  const schema = resolveRequestBodySchema(operation.requestBody, operationEntry.doc);
  if (!schema || !schema.properties) return diagnostics;

  for (const input of bodyInputs) {
    if (!Object.prototype.hasOwnProperty.call(schema.properties, input.name)) {
      diagnostics.push({
        code: 'HTTP-005',
        level: 'error',
        message: `Use case "${uc.id || uc.name}" declares body input "${input.name}" but operationId "${uc.trigger.operationId}" requestBody schema does not contain that property.`,
        location: `arch/${bcName}/${bcName}.yaml useCases[${uc.id || uc.name}].input[${input.name}]`,
      });
    }
  }

  return diagnostics;
}

function validateUseCaseReturn(bcName, uc, operationEntry) {
  const returnType = uc.returns;
  if (!returnType || String(returnType).toLowerCase() === 'void') return [];

  const responseSchema = findSuccessResponseSchema((operationEntry.operation || {}).responses || {});
  if (!responseSchema) {
    return [{
      code: 'HTTP-006',
      level: 'error',
      message: `Use case "${uc.id || uc.name}" declares returns: ${returnType} but operationId "${uc.trigger.operationId}" has no 2xx OpenAPI response schema.`,
      location: `arch/${bcName}/${bcName}.yaml useCases[${uc.id || uc.name}].returns`,
    }];
  }

  if (isPrimitiveReturnType(returnType) && !isPrimitiveSchemaCompatible(returnType, responseSchema)) {
    return [{
      code: 'HTTP-007',
      level: 'error',
      message: `Use case "${uc.id || uc.name}" declares returns: ${returnType} but operationId "${uc.trigger.operationId}" 2xx response schema is not compatible.`,
      location: `arch/${bcName}/${bcName}.yaml useCases[${uc.id || uc.name}].returns`,
    }];
  }

  return [];
}

module.exports = { validateOpenApiUseCases, validateOpenApiDocumentSchemas };
