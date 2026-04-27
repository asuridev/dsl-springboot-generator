'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toSnakeCase, toCamelCase, pluralizeWord, toPackagePath } = require('../utils/naming');
const { mapType } = require('../utils/type-mapper');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

// Fields managed by FullAuditableEntity base class — never declared in JPA entity
// Note: deletedAt is NOT excluded here — it must be generated explicitly for softDelete aggregates
const AUDIT_FIELD_NAMES = new Set(['createdAt', 'updatedAt']);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function isEnumType(type, bcYaml) {
  return (bcYaml.enums || []).some((e) => e.name === type);
}

function isMoneyType(type) {
  return type === 'Money';
}

function isValueObjectType(type, bcYaml) {
  return (bcYaml.valueObjects || []).some((vo) => vo.name === type);
}

function getVoDef(type, bcYaml) {
  return (bcYaml.valueObjects || []).find((vo) => vo.name === type) || null;
}

/**
 * Build the @Column annotation string for a YAML property in a JPA entity.
 * Does NOT handle Money (expanded separately) or enum fields (caller adds @Enumerated).
 */
function buildColumnAnnotation(prop, bcYaml, { forceNullable } = {}) {
  const type = prop.type;
  const attrs = [`name = "${toSnakeCase(prop.name)}"`];

  // Column type / length constraints
  if (type === 'String' || type === 'Text' || type === 'Url') {
    attrs.push('columnDefinition = "TEXT"');
  } else if (type === 'Email') {
    attrs.push('length = 254');
  } else if (/^String\(\d+\)$/.test(type)) {
    const n = parseInt(type.match(/\d+/)[0], 10);
    attrs.push(`length = ${n}`);
  } else if (type === 'Decimal') {
    const precision = prop.precision || 19;
    const scale = prop.scale || 4;
    attrs.push(`precision = ${precision}, scale = ${scale}`);
  }

  // Nullability — JPA default is nullable=true; only declare nullable=false for required fields
  const isRequired = prop.required === true;
  if (isRequired) attrs.push('nullable = false');

  // Uniqueness
  if (prop.unique === true) attrs.push('unique = true');

  const lines = [`@Column(${attrs.join(', ')})`];

  // Enum fields need @Enumerated
  const enumWrapperMatch = /^Enum<(.+)>$/.exec(type);
  if (enumWrapperMatch || isEnumType(type, bcYaml)) {
    lines.push('@Enumerated(EnumType.STRING)');
  }

  return lines.join('\n    ');
}

/**
 * Expand a multi-property VO into individual JPA columns with a prefixed name.
 * e.g. deliveryAddress: AddressSnapshot → deliveryAddressStreet, deliveryAddressCity, ...
 * This keeps infrastructure free of domain VO types.
 */
function expandMultiPropertyVoField(prop, voDef, bcYaml) {
  const prefix = prop.name;
  const fields = [];
  for (const voProp of (voDef.properties || [])) {
    const fieldName = `${prefix}${capitalize(voProp.name)}`;
    let javaType;
    try {
      javaType = mapType(voProp.type, voProp).javaType;
    } catch (_) {
      javaType = 'String';
    }
    fields.push({
      name: fieldName,
      javaType,
      columnAnnotation: buildColumnAnnotation(
        { ...voProp, name: fieldName, required: prop.required === true && voProp.required === true },
        bcYaml
      ),
    });
  }
  return fields;
}

/**
 * Expand a Money property into two separate JPA fields (amount + currency).
 * Returns an array of field descriptors: [{name, javaType, columnAnnotation}]
 */
function expandMoneyField(prop, bcYaml) {
  const nullable = prop.required !== true;

  // Try to get Money VO definition for property names
  const moneyVo = (bcYaml.valueObjects || []).find((v) => v.name === 'Money');
  const amountProp = moneyVo ? moneyVo.properties.find((p) => p.name === 'amount') : null;
  const currencyProp = moneyVo ? moneyVo.properties.find((p) => p.name === 'currency') : null;

  const precision = amountProp ? amountProp.precision || 19 : 19;
  const scale = amountProp ? amountProp.scale || 4 : 4;
  const currencyLength = currencyProp && /^String\((\d+)\)$/.test(currencyProp.type)
    ? parseInt(currencyProp.type.match(/\d+/)[0], 10)
    : 3;

  const amountName = `${prop.name}Amount`;
  const currencyName = `${prop.name}Currency`;
  const nullableClause = nullable ? '' : ', nullable = false';

  return [
    {
      name: amountName,
      javaType: 'BigDecimal',
      columnAnnotation: `@Column(name = "${toSnakeCase(amountName)}", precision = ${precision}, scale = ${scale}${nullableClause})`,
    },
    {
      name: currencyName,
      javaType: 'String',
      columnAnnotation: `@Column(name = "${toSnakeCase(currencyName)}", length = ${currencyLength}${nullableClause})`,
    },
  ];
}

/**
 * Build the fields array for a JPA entity from aggregate properties.
 * Excludes: id (handled as @Id), audit fields (in FullAuditableEntity).
 * Expands Money into two fields.
 */
function buildJpaFields(properties, aggregate, bcYaml) {
  const fields = [];

  for (const prop of properties || []) {
    // Skip id (handled as @Id separately)
    if (prop.name === 'id') continue;

    // Skip audit / soft-delete fields — managed by FullAuditableEntity
    if (AUDIT_FIELD_NAMES.has(prop.name)) continue;

    // Expand Money VO to two columns
    if (isMoneyType(prop.type)) {
      fields.push(...expandMoneyField(prop, bcYaml));
      continue;
    }

    // Map type — flatten single-property VOs; expand multi-property VOs to individual columns
    const voDef = getVoDef(prop.type, bcYaml);
    if (voDef && (voDef.properties || []).length === 1) {
      let javaType;
      try {
        javaType = mapType(voDef.properties[0].type, voDef.properties[0]).javaType;
      } catch (_) {
        javaType = 'String';
      }
      fields.push({
        name: prop.name,
        javaType,
        columnAnnotation: buildColumnAnnotation(prop, bcYaml),
      });
    } else if (voDef && (voDef.properties || []).length > 1) {
      fields.push(...expandMultiPropertyVoField(prop, voDef, bcYaml));
    } else {
      let javaType;
      try {
        javaType = mapType(prop.type, prop).javaType;
      } catch (_) {
        javaType = 'String'; // fallback
      }
      fields.push({
        name: prop.name,
        javaType,
        columnAnnotation: buildColumnAnnotation(prop, bcYaml),
      });
    }
  }

  return fields;
}

/**
 * Collect all imports needed by the JPA aggregate entity.
 */
function buildJpaEntityImports(aggregate, bcYaml, config) {
  const imports = new Set();
  const bc = bcYaml.bc;

  // @Id field always needs UUID
  imports.add('java.util.UUID');

  // Base class
  if (aggregate.auditable || aggregate.softDelete) {
    imports.add(`${config.packageName}.shared.domain.FullAuditableEntity`);
  }

  // softDelete requires Instant for deleted_at column
  if (aggregate.softDelete) {
    imports.add('java.time.Instant');
  }

  // Iterate properties
  for (const prop of aggregate.properties || []) {
    if (prop.name === 'id' || AUDIT_FIELD_NAMES.has(prop.name)) continue;

    if (isMoneyType(prop.type)) {
      imports.add('java.math.BigDecimal');
      continue;
    }

    const ewm = /^Enum<(.+)>$/.exec(prop.type);
    const resolvedEnum = ewm ? ewm[1] : prop.type;
    if (ewm || isEnumType(resolvedEnum, bcYaml)) {
      imports.add(`${config.packageName}.${bc}.domain.enums.${resolvedEnum}`);
      continue;
    }

    const voDef = getVoDef(prop.type, bcYaml);
    if (voDef) {
      if ((voDef.properties || []).length === 1) {
        try {
          const { importHint } = mapType(voDef.properties[0].type, voDef.properties[0]);
          if (importHint) imports.add(importHint);
        } catch (_) { /* ignore */ }
      } else {
        // Multi-property VO expanded to scalar columns — collect scalar imports
        for (const voProp of (voDef.properties || [])) {
          try {
            const { importHint } = mapType(voProp.type, voProp);
            if (importHint) imports.add(importHint);
          } catch (_) { /* ignore */ }
        }
      }
      continue;
    }

    try {
      const { importHint } = mapType(prop.type, prop);
      if (importHint) imports.add(importHint);
    } catch (_) { /* ignore */ }
  }

  // Child entities
  if ((aggregate.entities || []).length > 0) {
    imports.add('java.util.List');
    imports.add('java.util.ArrayList');
    for (const entity of aggregate.entities) {
      imports.add(`${config.packageName}.${bc}.infrastructure.persistence.entities.${entity.name}Jpa`);
    }
  }

  return [...imports].sort();
}

/**
 * Build the fields array for a JPA child entity.
 * Excludes id (handled as @Id). Expands Money.
 */
function buildJpaChildFields(entity, bcYaml) {
  const fields = [];

  for (const prop of entity.properties || []) {
    if (prop.name === 'id') continue;

    if (isMoneyType(prop.type)) {
      fields.push(...expandMoneyField(prop, bcYaml));
      continue;
    }

    const voDef = getVoDef(prop.type, bcYaml);
    if (voDef && (voDef.properties || []).length === 1) {
      let javaType;
      try {
        javaType = mapType(voDef.properties[0].type, voDef.properties[0]).javaType;
      } catch (_) {
        javaType = 'String';
      }
      fields.push({
        name: prop.name,
        javaType,
        columnAnnotation: buildColumnAnnotation(prop, bcYaml),
      });
    } else if (voDef && (voDef.properties || []).length > 1) {
      fields.push(...expandMultiPropertyVoField(prop, voDef, bcYaml));
    } else {
      let javaType;
      try {
        javaType = mapType(prop.type, prop).javaType;
      } catch (_) {
        javaType = 'String';
      }
      fields.push({
        name: prop.name,
        javaType,
        columnAnnotation: buildColumnAnnotation(prop, bcYaml),
      });
    }
  }

  return fields;
}

/**
 * Collect imports for a JPA child entity.
 */
function buildJpaChildEntityImports(entity, bcYaml, config) {
  const imports = new Set();
  const bc = bcYaml.bc;

  // @Id field always needs UUID
  imports.add('java.util.UUID');

  for (const prop of entity.properties || []) {
    if (prop.name === 'id') continue;

    if (isMoneyType(prop.type)) {
      imports.add('java.math.BigDecimal');
      continue;
    }

    const ewm = /^Enum<(.+)>$/.exec(prop.type);
    const resolvedEnum = ewm ? ewm[1] : prop.type;
    if (ewm || isEnumType(resolvedEnum, bcYaml)) {
      imports.add(`${config.packageName}.${bc}.domain.enums.${resolvedEnum}`);
      continue;
    }

    const voDef = getVoDef(prop.type, bcYaml);
    if (voDef) {
      if ((voDef.properties || []).length === 1) {
        try {
          const { importHint } = mapType(voDef.properties[0].type, voDef.properties[0]);
          if (importHint) imports.add(importHint);
        } catch (_) { /* ignore */ }
      } else {
        // Multi-property VO expanded to scalar columns — collect scalar imports
        for (const voProp of (voDef.properties || [])) {
          try {
            const { importHint } = mapType(voProp.type, voProp);
            if (importHint) imports.add(importHint);
          } catch (_) { /* ignore */ }
        }
      }
      continue;
    }

    try {
      const { importHint } = mapType(prop.type, prop);
      if (importHint) imports.add(importHint);
    } catch (_) { /* ignore */ }
  }

  return [...imports].sort();
}

/**
 * Build table name from entity name: PascalCase → snake_case plural.
 */
function toTableName(entityName) {
  return pluralizeWord(toSnakeCase(entityName));
}

/**
 * Build index entries from properties marked with indexed: true.
 * unique: true properties get UNIQUE constraint via @Column — no separate index needed.
 */
function buildIndexes(aggregateName, properties) {
  const tableName = toTableName(aggregateName);
  return (properties || [])
    .filter((p) => p.indexed === true && p.unique !== true && p.name !== 'id')
    .map((p) => ({
      name: `idx_${tableName}_${toSnakeCase(p.name)}`,
      columnList: toSnakeCase(p.name),
    }));
}

// ─── Context builders ────────────────────────────────────────────────────────

function buildJpaEntityContext(aggregate, bcYaml, config) {
  const bc = bcYaml.bc;
  const hasAudit = aggregate.auditable === true;
  const hasSoftDelete = aggregate.softDelete === true;
  const baseClass = (hasAudit || hasSoftDelete) ? 'FullAuditableEntity' : null;

  const fields = buildJpaFields(aggregate.properties, aggregate, bcYaml);

  // For softDelete aggregates, ensure deleted_at column exists.
  // If the YAML has a deletedAt property it was already included above.
  // If not, add a synthetic field so @SQLRestriction("deleted_at IS NULL") works.
  if (hasSoftDelete && !fields.some((f) => f.name === 'deletedAt')) {
    fields.push({
      name: 'deletedAt',
      javaType: 'Instant',
      columnAnnotation: '@Column(name = "deleted_at")',
    });
  }

  const indexes = buildIndexes(aggregate.name, aggregate.properties);

  const childEntities = (aggregate.entities || []).map((entity) => ({
    name: entity.name,
    jpaName: `${entity.name}Jpa`,
    fieldName: toCamelCase(pluralizeWord(entity.name)),
    joinColumn: `${toSnakeCase(aggregate.name)}_id`,
    immutable: entity.immutable === true,
  }));

  const imports = buildJpaEntityImports(aggregate, bcYaml, config);

  return {
    packageName: config.packageName,
    bc,
    name: aggregate.name,
    tableName: toTableName(aggregate.name),
    description: aggregate.description || '',
    hasAudit,
    hasSoftDelete,
    baseClass,
    indexes,
    fields,
    childEntities,
    imports,
  };
}

function buildJpaChildEntityContext(entity, aggregate, bcYaml, config) {
  const bc = bcYaml.bc;
  const fields = buildJpaChildFields(entity, bcYaml);
  const imports = buildJpaChildEntityImports(entity, bcYaml, config);

  return {
    packageName: config.packageName,
    bc,
    name: entity.name,
    tableName: toTableName(entity.name),
    description: entity.description || '',
    immutable: entity.immutable === true,
    fields,
    imports,
  };
}

// ─── Main generator ───────────────────────────────────────────────────────────

/**
 * Generate JPA entities for all aggregates in a BC YAML.
 * Output:
 *   {bc}/infrastructure/persistence/entities/{AggregateName}Jpa.java
 *   {bc}/infrastructure/persistence/entities/{EntityName}Jpa.java
 */
async function generateJpaEntities(bcYaml, config, outputDir) {
  const bc = bcYaml.bc;
  const packagePath = toPackagePath(config.packageName);

  for (const aggregate of bcYaml.aggregates || []) {
    // 1. Aggregate JPA entity
    const entityContext = buildJpaEntityContext(aggregate, bcYaml, config);
    const entityDest = path.join(
      outputDir, 'src', 'main', 'java',
      packagePath, bc,
      'infrastructure', 'persistence', 'entities',
      `${aggregate.name}Jpa.java`
    );
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'infrastructure', 'JpaEntity.java.ejs'),
      entityDest,
      entityContext
    );

    // 2. Child entity JPA entities
    for (const entity of aggregate.entities || []) {
      const childContext = buildJpaChildEntityContext(entity, aggregate, bcYaml, config);
      const childDest = path.join(
        outputDir, 'src', 'main', 'java',
        packagePath, bc,
        'infrastructure', 'persistence', 'entities',
        `${entity.name}Jpa.java`
      );
      await renderAndWrite(
        path.join(TEMPLATES_DIR, 'infrastructure', 'JpaChildEntity.java.ejs'),
        childDest,
        childContext
      );
    }
  }
}

module.exports = { generateJpaEntities };
