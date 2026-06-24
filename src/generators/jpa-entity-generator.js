'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toSnakeCase, toCamelCase, pluralizeWord, toPackagePath } = require('../utils/naming');
const { mapType, isListType, getListElementType } = require('../utils/type-mapper');

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

function isStoredObjectType(type) {
  return type === 'StoredObject';
}

function isUrlType(type) {
  return type === 'Url';
}

/**
 * Expand a StoredObject property into its persistence columns:
 *   {name}StorageKey, {name}Url, {name}ContentType, {name}SizeBytes.
 *
 * The expansion is uniform across visibility/urlAccess modes (same treatment as
 * Money): {name}Url is a nullable TEXT column. For public-url stores it holds the
 * stable URL; for signed-url stores it stays null (the URL is signed on read and
 * surfaced in the response DTO, never persisted). Keeping the shape uniform lets
 * the JPA mapper reconstruct StoredObject without per-store knowledge.
 *
 * Returns an array of field descriptors: [{name, javaType, columnAnnotation}].
 */
function expandStoredObjectField(prop) {
  const nullable = prop.required !== true;
  const nullableClause = nullable ? '' : ', nullable = false';

  const keyName = `${prop.name}StorageKey`;
  const urlName = `${prop.name}Url`;
  const ctName = `${prop.name}ContentType`;
  const sizeName = `${prop.name}SizeBytes`;

  return [
    {
      name: keyName,
      javaType: 'String',
      columnAnnotation: `@Column(name = "${toSnakeCase(keyName)}", columnDefinition = "TEXT"${nullableClause})`,
    },
    {
      name: urlName,
      javaType: 'String',
      columnAnnotation: `@Column(name = "${toSnakeCase(urlName)}", columnDefinition = "TEXT")`,
    },
    {
      name: ctName,
      javaType: 'String',
      columnAnnotation: `@Column(name = "${toSnakeCase(ctName)}", length = 255)`,
    },
    {
      name: sizeName,
      javaType: 'Long',
      columnAnnotation: `@Column(name = "${toSnakeCase(sizeName)}"${nullableClause})`,
    },
  ];
}

/**
 * Java type for a property as stored in a JPA entity. Identical to mapType().javaType
 * except Url → String: JPA persists URLs as a TEXT column and the JpaMapper converts
 * URI ↔ String. Keeping URI here would make Hibernate serialize the URI as binary
 * (bytea) into the TEXT column. The domain model keeps URI for type-safety.
 */
function jpaFieldJavaType(type, prop) {
  if (isUrlType(type)) return 'String';
  return mapType(type, prop).javaType;
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
      javaType = jpaFieldJavaType(voProp.type, voProp);
    } catch (e) {
      throw new Error(
        `jpa-entity: no se puede mapear el tipo "${voProp.type}" de la propiedad "${voProp.name}" ` +
          `del value object "${voDef.name}" (usado por el campo "${prop.name}"): ${e.message}`
      );
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
 * Whether the BC models Money.amount as a (decimal) String rather than the canonical
 * BigDecimal. A BC may declare its own Money VO with `amount: String` (e.g. "12.50",
 * to avoid float precision loss). When undeclared, the canonical BigDecimal shape wins.
 * The JPA amount column type must mirror this so it matches the domain VO getter/ctor.
 */
function moneyAmountIsString(bcYaml) {
  const moneyVo = (bcYaml.valueObjects || []).find((v) => v.name === 'Money');
  const amountProp = moneyVo ? moneyVo.properties.find((p) => p.name === 'amount') : null;
  return !!(amountProp && /^String(\(\d+\))?$/.test(amountProp.type));
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

  // Honor the declared Money.amount type. When it is a (decimal) String, the column is
  // a VARCHAR/TEXT — precision/scale do not apply; use a declared String(n) length when
  // present. Otherwise fall back to the canonical BigDecimal column.
  let amountField;
  if (moneyAmountIsString(bcYaml)) {
    const lenMatch = amountProp ? /^String\((\d+)\)$/.exec(amountProp.type) : null;
    const lengthClause = lenMatch ? `, length = ${lenMatch[1]}` : '';
    amountField = {
      name: amountName,
      javaType: 'String',
      columnAnnotation: `@Column(name = "${toSnakeCase(amountName)}"${lengthClause}${nullableClause})`,
    };
  } else {
    amountField = {
      name: amountName,
      javaType: 'BigDecimal',
      columnAnnotation: `@Column(name = "${toSnakeCase(amountName)}", precision = ${precision}, scale = ${scale}${nullableClause})`,
    };
  }

  return [
    amountField,
    {
      name: currencyName,
      javaType: 'String',
      columnAnnotation: `@Column(name = "${toSnakeCase(currencyName)}", length = ${currencyLength}${nullableClause})`,
    },
  ];
}

/**
 * Nombres de campo JPA producidos por la expansión de VOs canónicos compuestos
 * (Money / StoredObject) de propiedades NO derivadas. Una propiedad `derived: true`
 * cuyo nombre coincida con uno de estos representa la MISMA columna física
 * (ej. `priceAmount` ES `price.amount`); debe omitirse para no duplicar la columna.
 */
function collectExpandedColumnNames(properties, bcYaml) {
  const names = new Set();
  for (const prop of properties || []) {
    if (prop.derived === true) continue;
    if (isMoneyType(prop.type)) {
      for (const f of expandMoneyField(prop, bcYaml)) names.add(f.name);
    } else if (isStoredObjectType(prop.type)) {
      for (const f of expandStoredObjectField(prop)) names.add(f.name);
    }
  }
  return names;
}

/**
 * Build an @ElementCollection field descriptor for a List[T] property.
 * T may be a scalar or a single-property VO (collapsed to its primitive type).
 * Multi-property VOs are not supported and throw a descriptive error.
 */
function buildElementCollectionField(prop, aggregate, bcYaml) {
  const innerType = getListElementType(prop.type);
  if (!innerType) throw new Error(`buildElementCollectionField called on non-list type: ${prop.type}`);

  // Resolve element Java type
  let elementJavaType;
  const colAttrs = [];

  const voDef = getVoDef(innerType, bcYaml);
  if (voDef) {
    const voProps = voDef.properties || [];
    if (voProps.length > 1) {
      // Multi-property VO → @Embeddable class; @Column defs live inside the embeddable
      const aggSnake = toSnakeCase(aggregate.name);
      const fieldSnake = toSnakeCase(prop.name);
      const multiColAnnotation = [
        '@ElementCollection',
        `@CollectionTable(name = "${aggSnake}_${fieldSnake}", joinColumns = @JoinColumn(name = "${aggSnake}_id"))`,
        '@Builder.Default',
      ].join('\n    ');
      return {
        name: prop.name,
        javaType: `List<${innerType}Embeddable>`,
        columnAnnotation: multiColAnnotation,
        isCollection: true,
        embeddableName: `${innerType}Embeddable`,
      };
    }
    // Single-property VO: collapse to its primitive type
    const voProp = voProps[0];
    try {
      elementJavaType = jpaFieldJavaType(voProp.type, voProp);
    } catch (e) {
      throw new Error(
        `jpa-entity: no se puede mapear el tipo "${voProp.type}" del value object "${voDef.name}" ` +
          `en la colección "${aggregate.name}.${prop.name}": ${e.message}`
      );
    }
    if (voProp.type === 'Email') {
      colAttrs.push('length = 254');
    } else if (/^String\(\d+\)$/.test(voProp.type)) {
      colAttrs.push(`length = ${parseInt(voProp.type.match(/\d+/)[0], 10)}`);
    }
  } else {
    // Scalar or enum type
    if (isEnumType(innerType, bcYaml)) {
      elementJavaType = innerType;
    } else {
      try {
        elementJavaType = jpaFieldJavaType(innerType);
      } catch (e) {
        throw new Error(
          `jpa-entity: no se puede mapear el tipo de elemento "${innerType}" ` +
            `en la colección "${aggregate.name}.${prop.name}": ${e.message}`
        );
      }
    }
    if (innerType === 'Email') {
      colAttrs.push('length = 254');
    } else if (/^String\(\d+\)$/.test(innerType)) {
      colAttrs.push(`length = ${parseInt(innerType.match(/\d+/)[0], 10)}`);
    }
  }

  if (prop.required === true) colAttrs.push('nullable = false');

  const aggSnake = toSnakeCase(aggregate.name);
  const fieldSnake = toSnakeCase(prop.name);
  const colAttrStr = colAttrs.length > 0
    ? `@Column(name = "${fieldSnake}", ${colAttrs.join(', ')})`
    : `@Column(name = "${fieldSnake}")`;

  const columnAnnotationParts = [
    '@ElementCollection',
    `@CollectionTable(name = "${aggSnake}_${fieldSnake}", joinColumns = @JoinColumn(name = "${aggSnake}_id"))`,
    colAttrStr,
  ];
  if (isEnumType(innerType, bcYaml)) {
    columnAnnotationParts.push('@Enumerated(EnumType.STRING)');
  }
  columnAnnotationParts.push('@Builder.Default');
  const columnAnnotation = columnAnnotationParts.join('\n    ');

  return {
    name: prop.name,
    javaType: `List<${elementJavaType}>`,
    columnAnnotation,
    isCollection: true,
  };
}

/**
 * Build the fields array for a JPA entity from aggregate properties.
 * Excludes: id (handled as @Id), audit fields (in FullAuditableEntity).
 * Expands Money into two fields.
 */
function buildJpaFields(properties, aggregate, bcYaml) {
  const fields = [];
  const expandedNames = collectExpandedColumnNames(properties, bcYaml);

  for (const prop of properties || []) {
    // Skip id (handled as @Id separately)
    if (prop.name === 'id') continue;

    // Skip audit fields ONLY when the aggregate is auditable — then createdAt/updatedAt
    // are managed by FullAuditableEntity. On a non-auditable aggregate an explicitly
    // declared createdAt/updatedAt is a normal persisted column (the domain aggregate
    // includes it in its reconstruction constructor, so the column + mapping must exist).
    if (AUDIT_FIELD_NAMES.has(prop.name) && aggregate.auditable === true) continue;

    // derived: true que colisiona con una columna de expansión Money/StoredObject:
    // es el mismo valor/columna física — se omite para no duplicarla.
    if (prop.derived === true && expandedNames.has(prop.name)) continue;

    // S5 — fields marked hidden: true get @JsonIgnore so they never leak through DTOs
    // serialized via Jackson. The column is still persisted; only its serialization is suppressed.
    const jsonIgnorePrefix = prop.hidden ? '@com.fasterxml.jackson.annotation.JsonIgnore\n    ' : '';

    // Expand StoredObject VO to its persistence columns
    if (isStoredObjectType(prop.type)) {
      const storedFields = expandStoredObjectField(prop);
      if (jsonIgnorePrefix) {
        for (const f of storedFields) f.columnAnnotation = jsonIgnorePrefix + f.columnAnnotation;
      }
      fields.push(...storedFields);
      continue;
    }

    // Expand Money VO to two columns
    if (isMoneyType(prop.type)) {
      const moneyFields = expandMoneyField(prop, bcYaml);
      if (jsonIgnorePrefix) {
        for (const f of moneyFields) f.columnAnnotation = jsonIgnorePrefix + f.columnAnnotation;
      }
      fields.push(...moneyFields);
      continue;
    }

    // List[T] — @ElementCollection
    if (isListType(prop.type)) {
      const ecField = buildElementCollectionField(prop, aggregate, bcYaml);
      if (jsonIgnorePrefix) ecField.columnAnnotation = jsonIgnorePrefix + ecField.columnAnnotation;
      fields.push(ecField);
      continue;
    }

    // Map type — flatten single-property VOs; expand multi-property VOs to individual columns
    const voDef = getVoDef(prop.type, bcYaml);
    if (voDef && (voDef.properties || []).length === 1) {
      let javaType;
      try {
        javaType = jpaFieldJavaType(voDef.properties[0].type, voDef.properties[0]);
      } catch (_) {
        javaType = 'String';
      }
      fields.push({
        name: prop.name,
        javaType,
        columnAnnotation: jsonIgnorePrefix + buildColumnAnnotation(prop, bcYaml),
      });
    } else if (voDef && (voDef.properties || []).length > 1) {
      const expanded = expandMultiPropertyVoField(prop, voDef, bcYaml);
      if (jsonIgnorePrefix) {
        for (const f of expanded) f.columnAnnotation = jsonIgnorePrefix + f.columnAnnotation;
      }
      fields.push(...expanded);
    } else {
      let javaType;
      try {
        javaType = jpaFieldJavaType(prop.type, prop);
      } catch (_) {
        javaType = 'String'; // fallback
      }
      fields.push({
        name: prop.name,
        javaType,
        columnAnnotation: jsonIgnorePrefix + buildColumnAnnotation(prop, bcYaml),
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
    // Audit-named fields contribute imports only when NOT audit-managed (i.e. the
    // aggregate is non-auditable and declares createdAt/updatedAt as a real column).
    if (prop.name === 'id') continue;
    if (AUDIT_FIELD_NAMES.has(prop.name) && aggregate.auditable === true) continue;

    // StoredObject expands to String/Long columns only — no extra imports needed.
    if (isStoredObjectType(prop.type)) continue;

    if (isMoneyType(prop.type)) {
      if (!moneyAmountIsString(bcYaml)) imports.add('java.math.BigDecimal');
      continue;
    }

    // List[T] — collection properties
    if (isListType(prop.type)) {
      imports.add('java.util.List');
      imports.add('java.util.ArrayList');
      const innerType = getListElementType(prop.type);
      if (innerType) {
        const innerVoDef = getVoDef(innerType, bcYaml);
        if (innerVoDef && (innerVoDef.properties || []).length > 1) {
          // Multi-prop VO → import the generated @Embeddable class
          imports.add(`${config.packageName}.${bc}.infrastructure.persistence.entities.${innerType}Embeddable`);
        } else if (!innerVoDef) {
          if (isEnumType(innerType, bcYaml)) {
            imports.add(`${config.packageName}.${bc}.domain.enums.${innerType}`);
          } else {
            try {
              const { importHint } = mapType(innerType);
              if (importHint) imports.add(importHint);
            } catch (_) { /* skip */ }
          }
        }
      }
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

  // Url is persisted as String in JPA entities → java.net.URI is never needed here,
  // even if a Url-typed property's mapType() importHint suggested it.
  return [...imports].filter((i) => i !== 'java.net.URI').sort();
}

/**
 * Build the fields array for a JPA child entity.
 * Excludes id (handled as @Id). Expands Money.
 */
function buildJpaChildFields(entity, bcYaml) {
  const fields = [];
  const expandedNames = collectExpandedColumnNames(entity.properties, bcYaml);

  for (const prop of entity.properties || []) {
    if (prop.name === 'id') continue;

    // derived: true que colisiona con una columna de expansión Money/StoredObject → omitir.
    if (prop.derived === true && expandedNames.has(prop.name)) continue;

    if (isStoredObjectType(prop.type)) {
      fields.push(...expandStoredObjectField(prop));
      continue;
    }

    if (isMoneyType(prop.type)) {
      fields.push(...expandMoneyField(prop, bcYaml));
      continue;
    }

    // List[T] — @ElementCollection (same as aggregate root)
    if (isListType(prop.type)) {
      fields.push(buildElementCollectionField(prop, entity, bcYaml));
      continue;
    }

    const voDef = getVoDef(prop.type, bcYaml);
    if (voDef && (voDef.properties || []).length === 1) {
      let javaType;
      try {
        javaType = jpaFieldJavaType(voDef.properties[0].type, voDef.properties[0]);
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
        javaType = jpaFieldJavaType(prop.type, prop);
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

    // StoredObject expands to String/Long columns only — no extra imports needed.
    if (isStoredObjectType(prop.type)) continue;

    if (isMoneyType(prop.type)) {
      if (!moneyAmountIsString(bcYaml)) imports.add('java.math.BigDecimal');
      continue;
    }

    // List[T] — @ElementCollection
    if (isListType(prop.type)) {
      imports.add('java.util.List');
      imports.add('java.util.ArrayList');
      const innerType = getListElementType(prop.type);
      if (innerType) {
        const innerVoDef = getVoDef(innerType, bcYaml);
        if (innerVoDef && (innerVoDef.properties || []).length > 1) {
          imports.add(`${config.packageName}.${bc}.infrastructure.persistence.entities.${innerType}Embeddable`);
        } else if (!innerVoDef) {
          if (isEnumType(innerType, bcYaml)) {
            imports.add(`${config.packageName}.${bc}.domain.enums.${innerType}`);
          } else {
            try {
              const { importHint } = mapType(innerType);
              if (importHint) imports.add(importHint);
            } catch (_) { /* skip */ }
          }
        }
      }
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

  // Url is persisted as String in JPA entities → java.net.URI is never needed here,
  // even if a Url-typed property's mapType() importHint suggested it.
  return [...imports].filter((i) => i !== 'java.net.URI').sort();
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
function buildIndexes(aggregateName, properties, bcYaml) {
  const tableName = toTableName(aggregateName);
  return (properties || [])
    .filter((p) => {
      if (p.indexed !== true || p.unique === true || p.name === 'id') return false;
      // Skip Money / StoredObject and multi-prop VOs — they expand to multiple columns; @Index column name would be wrong
      if (isMoneyType(p.type) || isStoredObjectType(p.type)) return false;
      const voDef = getVoDef(p.type, bcYaml || {});
      if (voDef && (voDef.properties || []).length > 1) return false;
      return true;
    })
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

  const indexes = buildIndexes(aggregate.name, aggregate.properties, bcYaml);

  // [Phase 3, Gap E6] Emit named DB-level UNIQUE constraints for uniqueness
  // domainRules that declare both `field` and `constraintName`. The named
  // constraint is what `HandlerExceptions.onDataIntegrityViolation` uses to
  // map the SQL constraint violation back to the declared `errorCode`.
  const uniqueConstraints = (aggregate.domainRules || [])
    .filter((r) => r.type === 'uniqueness' && r.constraintName && r.field)
    .map((r) => ({
      name: r.constraintName,
      columnNames: toSnakeCase(r.field),
    }));

  const childEntities = (aggregate.entities || []).map((entity) => {
    // S6 — cardinality + relationship (defaults: oneToMany + composition)
    const cardinality = entity.cardinality === 'oneToOne' ? 'oneToOne' : 'oneToMany';
    const relationship = entity.relationship === 'aggregation' ? 'aggregation' : 'composition';
    const isOneToOne = cardinality === 'oneToOne';
    return {
      name: entity.name,
      jpaName: `${entity.name}Jpa`,
      fieldName: isOneToOne
        ? toCamelCase(entity.name)
        : toCamelCase(pluralizeWord(entity.name)),
      // @OneToMany: FK lives in the child table → parentAggregate_id (e.g. order_id in order_lines)
      // @OneToOne:  FK lives in the parent table → childEntity_id   (e.g. delivery_address_snapshot_id in orders)
      joinColumn: isOneToOne
        ? `${toSnakeCase(entity.name)}_id`
        : `${toSnakeCase(aggregate.name)}_id`,
      immutable: entity.immutable === true,
      cardinality,
      relationship,
      isOneToOne,
    };
  });

  const imports = buildJpaEntityImports(aggregate, bcYaml, config);

  // S2 — Optimistic locking: emit @Version Long version when the aggregate
  // declares concurrencyControl: optimistic. Hibernate manages the field;
  // domain code does not need to read it.
  const hasVersion = aggregate.concurrencyControl === 'optimistic';

  return {
    packageName: config.packageName,
    bc,
    name: aggregate.name,
    tableName: toTableName(aggregate.name),
    description: aggregate.description || '',
    hasAudit,
    hasSoftDelete,
    hasVersion,
    baseClass,
    indexes,
    uniqueConstraints,
    fields,
    childEntities,
    imports,
  };
}

function buildJpaChildEntityContext(entity, aggregate, bcYaml, config) {
  const bc = bcYaml.bc;
  const fields = buildJpaChildFields(entity, bcYaml);
  const imports = buildJpaChildEntityImports(entity, bcYaml, config);
  const indexes = buildIndexes(entity.name, entity.properties, bcYaml);

  return {
    packageName: config.packageName,
    bc,
    name: entity.name,
    tableName: toTableName(entity.name),
    description: entity.description || '',
    immutable: entity.immutable === true,
    fields,
    imports,
    indexes,
  };
}

// ─── Main generator ───────────────────────────────────────────────────────────

/**
 * Generate JPA entities for all aggregates in a BC YAML.
 * Output:
 *   {bc}/infrastructure/persistence/entities/{AggregateName}Jpa.java
 *   {bc}/infrastructure/persistence/entities/{EntityName}Jpa.java
 */
/**
 * Build the context object for a @Embeddable class generated from a multi-property VO
 * that appears in a List[T] property.
 */
function buildEmbeddableContext(voName, voDef, bcYaml, config) {
  const bc = bcYaml.bc;
  const fields = [];
  const imports = new Set();

  for (const prop of (voDef.properties || [])) {
    let javaType;
    if (isUrlType(prop.type)) {
      // Url persisted as String (TEXT column); no java.net.URI import in JPA.
      javaType = 'String';
    } else {
      try {
        const mapped = mapType(prop.type, prop);
        javaType = mapped.javaType;
        if (mapped.importHint) imports.add(mapped.importHint);
      } catch (_) {
        javaType = 'String';
      }
    }
    if (isEnumType(prop.type, bcYaml)) {
      imports.add(`${config.packageName}.${bc}.domain.enums.${prop.type}`);
    }

    const colAttrs = [`name = "${toSnakeCase(prop.name)}"`];
    if (prop.type === 'Email') {
      colAttrs.push('length = 254');
    } else if (/^String\(\d+\)$/.test(prop.type)) {
      colAttrs.push(`length = ${parseInt(prop.type.match(/\d+/)[0], 10)}`);
    } else if (prop.type === 'Decimal') {
      colAttrs.push(`precision = ${prop.precision || 19}, scale = ${prop.scale || 4}`);
    }
    if (prop.required === true) colAttrs.push('nullable = false');

    let columnAnnotation = `@Column(${colAttrs.join(', ')})`;
    if (isEnumType(prop.type, bcYaml)) {
      columnAnnotation += '\n    @Enumerated(EnumType.STRING)';
    }
    fields.push({
      name: prop.name,
      javaType,
      columnAnnotation,
    });
  }

  return {
    packageName: config.packageName,
    bc,
    name: `${voName}Embeddable`,
    voName,
    fields,
    imports: [...imports].sort(),
  };
}

async function generateJpaEntities(bcYaml, config, outputDir) {
  const bc = bcYaml.bc;
  const packagePath = toPackagePath(config.packageName);
  const entitiesDir = path.join(outputDir, 'src', 'main', 'java', packagePath, bc, 'infrastructure', 'persistence', 'entities');

  // Collect @Embeddable classes needed across all aggregates (deduplicated by VO name)
  const embeddablesNeeded = new Map(); // voName → voDef

  for (const aggregate of bcYaml.aggregates || []) {
    // 1. Aggregate JPA entity
    const entityContext = buildJpaEntityContext(aggregate, bcYaml, config);
    const entityDest = path.join(entitiesDir, `${aggregate.name}Jpa.java`);
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'infrastructure', 'JpaEntity.java.ejs'),
      entityDest,
      entityContext
    );

    // 2. Child entity JPA entities
    for (const entity of aggregate.entities || []) {
      const childContext = buildJpaChildEntityContext(entity, aggregate, bcYaml, config);
      const childDest = path.join(entitiesDir, `${entity.name}Jpa.java`);
      await renderAndWrite(
        path.join(TEMPLATES_DIR, 'infrastructure', 'JpaChildEntity.java.ejs'),
        childDest,
        childContext
      );
    }

    // 3. Collect multi-prop VO embeddables needed by List[T] properties
    for (const prop of aggregate.properties || []) {
      if (!isListType(prop.type)) continue;
      const innerType = getListElementType(prop.type);
      if (!innerType || embeddablesNeeded.has(innerType)) continue;
      const voDef = getVoDef(innerType, bcYaml);
      if (voDef && (voDef.properties || []).length > 1) {
        embeddablesNeeded.set(innerType, voDef);
      }
    }
    // 3b. Same for child entity properties
    for (const entity of aggregate.entities || []) {
      for (const prop of entity.properties || []) {
        if (!isListType(prop.type)) continue;
        const innerType = getListElementType(prop.type);
        if (!innerType || embeddablesNeeded.has(innerType)) continue;
        const voDef = getVoDef(innerType, bcYaml);
        if (voDef && (voDef.properties || []).length > 1) {
          embeddablesNeeded.set(innerType, voDef);
        }
      }
    }
  }

  // 4. Generate one @Embeddable class per collected multi-prop VO
  for (const [voName, voDef] of embeddablesNeeded) {
    const embeddableContext = buildEmbeddableContext(voName, voDef, bcYaml, config);
    const embeddableDest = path.join(entitiesDir, `${voName}Embeddable.java`);
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'infrastructure', 'JpaEmbeddable.java.ejs'),
      embeddableDest,
      embeddableContext
    );
  }
}

module.exports = { generateJpaEntities };
