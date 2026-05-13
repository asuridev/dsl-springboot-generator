'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPackagePath } = require('../utils/naming');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

/**
 * Generates Java enum classes for all enums declared in a BC YAML.
 *
 * @param {object} bcYaml   — parsed BC YAML document
 * @param {object} config   — {packageName, ...}
 * @param {string} outputDir — root output directory (e.g. /cwd/canasta-shop)
 */
async function generateEnums(bcYaml, config, outputDir) {
  const enums = bcYaml.enums || [];
  if (enums.length === 0) return;

  const bc = bcYaml.bc;
  const packagePath = toPackagePath(config.packageName);
  const enumsDir = path.join(outputDir, 'src', 'main', 'java', packagePath, bc, 'domain', 'enums');

  for (const enumDef of enums) {
    if (!enumDef.values || enumDef.values.length === 0) continue;

    // Build flat transitions list [{from, to}] from values[].transitions[].to
    const transitions = [];
    const hasTransitionsInValues = enumDef.values.some(
      (v) => v.transitions && v.transitions.length > 0
    );

    if (hasTransitionsInValues) {
      for (const valueObj of enumDef.values) {
        for (const t of valueObj.transitions || []) {
          if (t) {
            const fromValue = valueObj.value || valueObj.name;
            const toValue = typeof t === 'string' ? t : t.to;
            transitions.push({ from: fromValue, to: toValue });
          }
        }
      }
    }

    const context = {
      packageName: config.packageName,
      bc,
      name: enumDef.name,
      description: enumDef.description || '',
      values: enumDef.values.map((v) => v.value || v.name),
      hasTransitions: transitions.length > 0,
      transitions,
    };

    const destPath = path.join(enumsDir, `${enumDef.name}.java`);
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'domain', 'Enum.java.ejs'),
      destPath,
      context
    );
  }
}

module.exports = { generateEnums };
