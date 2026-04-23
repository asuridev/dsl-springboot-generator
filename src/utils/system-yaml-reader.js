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
    infrastructure: doc.infrastructure || {},
    integrations: doc.integrations || [],
    externalSystems: doc.externalSystems || [],
  };
}

/**
 * Validates that the given directory is a valid DSL project root.
 * Checks for the presence of arch/, arch/system/, and arch/system/system.yaml.
 * Throws a descriptive Error if any check fails.
 * @param {string} cwd
 */
async function validateArchDirectory(cwd) {
  const archDir = path.join(cwd, 'arch');
  if (!(await fs.pathExists(archDir)) || !(await fs.stat(archDir)).isDirectory()) {
    throw new Error(
      `No se encontró el directorio 'arch/' en:\n  ${cwd}\nEjecuta el comando desde la raíz de tu proyecto DSL.`
    );
  }

  const systemDir = path.join(archDir, 'system');
  if (!(await fs.pathExists(systemDir)) || !(await fs.stat(systemDir)).isDirectory()) {
    throw new Error(
      `El directorio 'arch/system/' no existe dentro de:\n  ${archDir}\nEste directorio es requerido para la generación.`
    );
  }

  const systemYaml = path.join(systemDir, 'system.yaml');
  if (!(await fs.pathExists(systemYaml))) {
    throw new Error(
      `No se encontró 'arch/system/system.yaml' en:\n  ${systemDir}\nEste archivo es requerido para la generación.`
    );
  }
}

module.exports = { readSystemYaml, validateArchDirectory };
