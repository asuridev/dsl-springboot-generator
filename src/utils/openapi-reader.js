'use strict';

const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const { buildOpenApiOperationMap } = require('@dsl/contract');

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

  return buildOpenApiOperationMap(doc, { bcName, docKind: 'open-api' });
}

module.exports = { readOpenApiYaml };
