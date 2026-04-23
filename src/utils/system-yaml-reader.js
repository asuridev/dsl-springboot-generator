'use strict';

const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Reads and parses arch/system/system.yaml relative to CWD.
 *
 * Returns:
 * {
 *   name: string,                  — system name (kebab-case, e.g. "canasta-shop")
 *   description: string,
 *   domainType: string,
 *   boundedContexts: Array<{
 *     name: string,                — BC name (kebab-case, e.g. "catalog")
 *     type: string,
 *     purpose: string,
 *     aggregates: Array<{ name, root, entities }>
 *   }>
 * }
 */
async function readSystemYaml() {
  const filePath = path.join(process.cwd(), 'arch', 'system', 'system.yaml');

  if (!(await fs.pathExists(filePath))) {
    throw new Error(`system.yaml not found at: ${filePath}`);
  }

  const raw = await fs.readFile(filePath, 'utf-8');
  const doc = yaml.load(raw);

  if (!doc.system || !doc.system.name) {
    throw new Error('system.yaml must contain a top-level "system.name" field.');
  }

  if (!Array.isArray(doc.boundedContexts) || doc.boundedContexts.length === 0) {
    throw new Error('system.yaml must contain a non-empty "boundedContexts" array.');
  }

  return {
    name: doc.system.name,
    description: doc.system.description || '',
    domainType: doc.system.domainType || 'core',
    boundedContexts: doc.boundedContexts.map((bc) => ({
      name: bc.name,
      type: bc.type || 'core',
      purpose: bc.purpose || '',
      aggregates: (bc.aggregates || []).map((agg) => ({
        name: agg.name,
        root: agg.root,
        entities: agg.entities || [],
      })),
    })),
  };
}

module.exports = { readSystemYaml };
