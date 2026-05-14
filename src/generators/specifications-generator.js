'use strict';

/**
 * [G8] Specifications generator.
 *
 * For each aggregate referenced by query use-cases declaring `Range[T]` or
 * `SearchText` inputs, emits an `<Aggregate>Specs.java` utility class under
 * `infrastructure/persistence/specs/` exposing static `Specification<JpaX>`
 * builders. The class is consumed by repositories that extend
 * `JpaSpecificationExecutor` and by handlers that compose dynamic filters.
 *
 * Builder bodies are scaffolded:
 *   - SearchText: full implementation (fields are validated to exist on the
 *     aggregate and assumed to be simple string-like properties).
 *   - Range[T]:   TODO body — the JPA attribute path depends on the field
 *     type (primitive vs Money VO embedded with `${field}Amount`).
 */

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { mapType } = require('../utils/type-mapper');
const { toPascalCase, toPackagePath } = require('../utils/naming');
const { warn } = require('../utils/logger');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

const RANGE_T_RE = /^Range\[(.+)\]$/;

/**
 * Collect the Range[T] / SearchText inputs declared across all query UCs that
 * target a given aggregate. De-duplicates by input name so the same filter
 * declared on multiple UCs results in a single builder method.
 */
function collectFilterInputs(aggregateName, useCases) {
  const rangeByName = new Map();
  const searchByName = new Map();
  const ucIds = new Set();

  for (const uc of useCases || []) {
    if (uc.type !== 'query') continue;
    if (uc.aggregate !== aggregateName) continue;

    let touched = false;
    for (const inp of uc.input || []) {
      const rangeMatch = RANGE_T_RE.exec(inp.type);
      if (rangeMatch) {
        if (!rangeByName.has(inp.name)) {
          const inner = mapType(rangeMatch[1]);
          rangeByName.set(inp.name, {
            inputName: inp.name,
            methodName: `by${toPascalCase(inp.name)}`,
            innerJavaType: inner.javaType,
            innerImportHint: inner.importHint || null,
          });
        }
        touched = true;
        continue;
      }
      if (inp.type === 'SearchText') {
        if (!Array.isArray(inp.fields) || inp.fields.length === 0) {
          warn(`[G8] SearchText input "${inp.name}" on use case "${uc.id}" has no fields[] declared — skipping Specification builder. Add fields: [fieldName, ...] to enable text search.`);
          touched = true;
          continue;
        }
        if (!searchByName.has(inp.name)) {
          searchByName.set(inp.name, {
            inputName: inp.name,
            methodName: `by${toPascalCase(inp.name)}`,
            fields: inp.fields.slice(),
          });
        }
        touched = true;
      }
    }
    if (touched) ucIds.add(uc.id);
  }

  return {
    rangeMethods: [...rangeByName.values()],
    searchMethods: [...searchByName.values()],
    ucIds: [...ucIds],
  };
}

async function generateSpecifications(bcYaml, config, outputDir) {
  const bc = bcYaml.bc;
  const packagePath = toPackagePath(config.packageName);

  for (const agg of bcYaml.aggregates || []) {
    const { rangeMethods, searchMethods, ucIds } = collectFilterInputs(
      agg.name,
      bcYaml.useCases || []
    );
    if (rangeMethods.length === 0 && searchMethods.length === 0) continue;

    const jpaEntityName = `${agg.name}Jpa`;
    const imports = new Set();
    imports.add('org.springframework.data.jpa.domain.Specification');
    imports.add(`${config.packageName}.${bc}.infrastructure.persistence.entities.${jpaEntityName}`);
    if (rangeMethods.length > 0) {
      imports.add(`${config.packageName}.shared.application.dtos.Range`);
      for (const m of rangeMethods) {
        if (m.innerImportHint) imports.add(m.innerImportHint);
      }
    }

    const outputPath = path.join(
      outputDir, 'src', 'main', 'java',
      packagePath, bc,
      'infrastructure', 'persistence', 'specs',
      `${agg.name}Specs.java`
    );

    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'infrastructure', 'AggregateSpecs.java.ejs'),
      outputPath,
      {
        packageName: config.packageName,
        bc,
        aggregateName: agg.name,
        jpaEntityName,
        imports: [...imports].sort(),
        rangeMethods,
        searchMethods,
        ucIds,
      }
    );
  }
}

module.exports = { generateSpecifications };
