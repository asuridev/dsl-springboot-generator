'use strict';

const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Reads and parses arch/{bcName}/{bcName}-open-api.yaml relative to CWD.
 *
 * Returns a map: operationId → { method, path, summary, requestBody, responses }
 *
 * @param {string} bcName - BC name in kebab-case (e.g. "catalog")
 * @returns {Promise<Map<string, object>>}
 */
async function readOpenApiYaml(bcName) {
  const filePath = path.join(process.cwd(), 'arch', bcName, `${bcName}-open-api.yaml`);

  if (!(await fs.pathExists(filePath))) {
    // OpenAPI is optional — return empty map
    return new Map();
  }

  const raw = await fs.readFile(filePath, 'utf-8');
  const doc = yaml.load(raw);

  const operationMap = new Map();

  const paths = doc.paths || {};
  for (const [urlPath, pathItem] of Object.entries(paths)) {
    const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
    for (const method of httpMethods) {
      const operation = pathItem[method];
      if (!operation) continue;

      const operationId = operation.operationId;
      if (!operationId) continue;

      operationMap.set(operationId, {
        method: method.toUpperCase(),
        path: urlPath,
        summary: operation.summary || '',
        description: operation.description || '',
        tags: operation.tags || [],
        parameters: operation.parameters || [],
        requestBody: operation.requestBody || null,
        responses: operation.responses || {},
        security: operation.security || [],
      });
    }
  }

  return operationMap;
}

module.exports = { readOpenApiYaml };
