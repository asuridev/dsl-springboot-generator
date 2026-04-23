'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPackagePath } = require('../utils/naming');
const { mapType } = require('../utils/type-mapper');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

/**
 * Generates Java value object classes for all valueObjects declared in a BC YAML.
 *
 * @param {object} bcYaml   — parsed BC YAML document
 * @param {object} config   — {packageName, ...}
 * @param {string} outputDir — root output directory
 */
async function generateValueObjects(bcYaml, config, outputDir) {
  const valueObjects = bcYaml.valueObjects || [];
  if (valueObjects.length === 0) return;

  const bc = bcYaml.bc;
  const packagePath = toPackagePath(config.packageName);
  const voDir = path.join(outputDir, 'src', 'main', 'java', packagePath, bc, 'domain', 'valueobject');

  for (const vo of valueObjects) {
    const imports = new Set();
    const fields = [];

    for (const prop of vo.properties || []) {
      const mapped = mapType(prop.type, prop);
      if (mapped.importHint) {
        imports.add(`import ${mapped.importHint};`);
      }
      fields.push({ name: prop.name, javaType: mapped.javaType });
    }

    const context = {
      packageName: config.packageName,
      bc,
      name: vo.name,
      description: vo.description || '',
      imports: [...imports].sort(),
      fields,
    };

    const destPath = path.join(voDir, `${vo.name}.java`);
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'domain', 'ValueObject.java.ejs'),
      destPath,
      context
    );
  }
}

module.exports = { generateValueObjects };
