'use strict';

const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Reads and parses arch/{bcName}/{bcName}-open-api.yaml relative to CWD.
 * @param {string} bcName - e.g. "catalog"
 * @returns {Promise<object>} Parsed OpenAPI document
 */
async function readOpenApiYaml(bcName) {
  const filePath = path.join(process.cwd(), 'arch', bcName, `${bcName}-open-api.yaml`);
  if (!(await fs.pathExists(filePath))) {
    throw new Error(`OpenAPI YAML not found: ${filePath}`);
  }
  const content = await fs.readFile(filePath, 'utf8');
  return yaml.load(content);
}

/**
 * Reads and parses arch/{bcName}/{bcName}-async-api.yaml relative to CWD.
 * @param {string} bcName - e.g. "catalog"
 * @returns {Promise<object>} Parsed AsyncAPI document
 */
async function readAsyncApiYaml(bcName) {
  const filePath = path.join(process.cwd(), 'arch', bcName, `${bcName}-async-api.yaml`);
  if (!(await fs.pathExists(filePath))) {
    return null; // AsyncAPI is optional
  }
  const content = await fs.readFile(filePath, 'utf8');
  return yaml.load(content);
}

/**
 * Reads and parses arch/{bcName}/{bcName}-internal-api.yaml relative to CWD.
 * Used by the outbound HTTP adapter generator to resolve the contract of a target BC.
 * @param {string} bcName - e.g. "catalog"
 * @returns {Promise<object|null>} Parsed OpenAPI document, or null if not found
 */
async function readInternalApiYaml(bcName) {
  const filePath = path.join(process.cwd(), 'arch', bcName, `${bcName}-internal-api.yaml`);
  if (!(await fs.pathExists(filePath))) {
    return null; // Internal API is optional
  }
  const content = await fs.readFile(filePath, 'utf8');
  return yaml.load(content);
}

module.exports = { readOpenApiYaml, readAsyncApiYaml, readInternalApiYaml };
