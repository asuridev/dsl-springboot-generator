'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPackagePath, toCamelCase, pluralizeWord } = require('../utils/naming');
const { mapType } = require('../utils/type-mapper');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

// ─── Audit / SoftDelete field names that are injected, not from YAML props ───
const AUDIT_FIELDS = new Set(['createdAt', 'updatedAt']);
const SOFT_DELETE_FIELD = 'deletedAt';

// ─── Fields excluded from the creation constructor ────────────────────────────
// (in addition to readOnly fields that have a defaultValue)
const ALWAYS_EXCLUDE_FROM_CREATION = new Set(['createdAt', 'updatedAt', 'deletedAt']);

// ─── Helper: resolve Java type for a param name ───────────────────────────────
function resolveParamType(paramName, aggregateProps, childEntities, typeHint, bcYaml) {
  // 1. Match against aggregate properties
  const aggrProp = (aggregateProps || []).find((p) => p.name === paramName);
  if (aggrProp) {
    try {
      return mapType(aggrProp.type, aggrProp).javaType;
    } catch (_) {
      return 'Object';
    }
  }

  // 2. Match against child entity properties
  for (const entity of childEntities || []) {
    const entProp = (entity.properties || []).find((p) => p.name === paramName);
    if (entProp) {
      try {
        return mapType(entProp.type, entProp).javaType;
      } catch (_) {
        return 'Object';
      }
    }
  }

  // 3. Use inline type hint from method signature (e.g. "imageId: Uuid")
  if (typeHint) {
    // Check if it's a known value object or enum in the BC
    if (bcYaml) {
      if ((bcYaml.valueObjects || []).some((vo) => vo.name === typeHint)) return typeHint;
      const enumMatch = /^Enum<(.+)>$/.exec(typeHint);
      const resolvedEnum = enumMatch ? enumMatch[1] : typeHint;
      if ((bcYaml.enums || []).some((e) => e.name === resolvedEnum)) return resolvedEnum;
    }
    try {
      return mapType(typeHint, {}).javaType;
    } catch (_) {
      return typeHint; // pass through as domain type
    }
  }

  // 4. Heuristics by name convention
  if (paramName === 'id' || paramName.endsWith('Id')) return 'UUID';
  if (paramName.endsWith('At')) return 'Instant';
  if (paramName === 'password' || paramName === 'passwordHash') return 'String';

  return 'Object';
}

// ─── Helper: parse method signature string ────────────────────────────────────
// Input:  "create(name, description?, displayOrder?): Category"
// Input:  "removeImage(imageId: Uuid): void"  (inline type hints supported)
// Output: { name, params: [{name, optional, typeHint}], returnType }
function parseMethodSignature(sig) {
  if (!sig) return null;
  // Use a balanced-paren approach: find the outermost () then the final ': returnType'
  const firstParen = sig.indexOf('(');
  // Bare method name with no parens (e.g. "abandon", "addItem") — treat as no-arg, void
  if (firstParen === -1) return { name: sig.trim(), params: [], returnType: 'void' };
  // Walk forward to find the matching closing paren (handles nested parens like String(200))
  let depth = 0;
  let closeParen = -1;
  for (let i = firstParen; i < sig.length; i++) {
    if (sig[i] === '(') depth++;
    else if (sig[i] === ')') {
      depth--;
      if (depth === 0) { closeParen = i; break; }
    }
  }
  if (closeParen === -1) return null;
  const name = sig.substring(0, firstParen).trim();
  const paramsStr = sig.substring(firstParen + 1, closeParen);
  const returnTypeMatch = sig.substring(closeParen + 1).match(/^\s*:\s*(.+)$/);
  const returnType = returnTypeMatch ? returnTypeMatch[1].trim() : 'void';
  // Split params on commas that are NOT inside nested parens
  const rawParams = [];
  let current = '';
  let d = 0;
  for (const ch of paramsStr) {
    if (ch === '(') { d++; current += ch; }
    else if (ch === ')') { d--; current += ch; }
    else if (ch === ',' && d === 0) { rawParams.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  if (current.trim()) rawParams.push(current.trim());
  const params = rawParams
    .filter(Boolean)
    .map((p) => {
      const optional = p.includes('?');
      const clean = p.replace('?', '').trim();
      // Support inline type annotation: "paramName: TypeHint"
      const colonIdx = clean.indexOf(':');
      const paramName = colonIdx !== -1 ? clean.substring(0, colonIdx).trim() : clean;
      const typeHint = colonIdx !== -1 ? clean.substring(colonIdx + 1).trim() : null;
      return { name: paramName, optional, typeHint };
    });
  return { name, params, returnType };
}

// ─── Helper: try to detect state transition for a full-implementation UC ──────
// Returns { statusField, enumType, targetValue, emits } or null
function detectStateTransition(ucId, aggregate, bcEnums) {
  const statusFields = (aggregate.properties || []).filter((p) =>
    (bcEnums || []).some((e) => e.name === p.type)
  );
  for (const field of statusFields) {
    const enumDef = (bcEnums || []).find((e) => e.name === field.type);
    if (!enumDef) continue;
    for (const valueObj of enumDef.values || []) {
      for (const t of valueObj.transitions || []) {
        if (t && t.triggeredBy && (t.triggeredBy === ucId || t.triggeredBy.startsWith(ucId + ' '))) {
          return { statusField: field.name, enumType: field.type, targetValue: t.to, emits: t.emits || null };
        }
      }
    }
  }
  return null;
}

// ─── Helper: compute the body string for a business method ───────────────────
function computeMethodBody(uc, sig, aggregate, bcEnums, bcName, publishedEvents) {
  const scaffoldBody =
    `// TODO: implement business logic — ver ${bcName}-flows.md\n        throw new UnsupportedOperationException("Not implemented yet");`;

  if (uc.implementation === 'scaffold') return scaffoldBody;

  const { name: methodName, params } = sig;

  // ── Case 1: state transition (no params, full, enum field) ───────────────
  if (params.length === 0) {
    const transition = detectStateTransition(uc.id, aggregate, bcEnums);
    if (transition) {
      let body = `this.${transition.statusField} = this.${transition.statusField}.transitionTo(${transition.enumType}.${transition.targetValue});`;
      if (transition.emits && publishedEvents && publishedEvents.length > 0) {
        const event = publishedEvents.find((e) => e.name === transition.emits);
        if (event) {
          const aggregateCamelId = aggregate.name.charAt(0).toLowerCase() + aggregate.name.slice(1) + 'Id';
          const aggregatePropNames = new Set((aggregate.properties || []).map((pr) => pr.name));
          const args = (event.payload || []).map((p) => {
            if (p.name === aggregateCamelId) return 'this.getId()';
            if (aggregatePropNames.has(p.name)) {
              return `this.get${p.name.charAt(0).toUpperCase() + p.name.slice(1)}()`;
            }
            // Timestamp of occurrence — not a persisted aggregate field
            if (p.type === 'DateTime' || p.type === 'Instant') return 'Instant.now()';
            return `null /* TODO: provide value for ${p.name} */`;
          });
          body += `\n        raise(new ${event.name}Event(${args.join(', ')}));`;
        }
      }
      return body;
    }
    // No transition detected → scaffold
    return scaffoldBody;
  }

  // ── Case 2: child entity add (addX(...)) ──────────────────────────────────
  if (methodName.startsWith('add') && methodName.length > 3) {
    const entitySuffix =
      methodName.charAt(3).toUpperCase() + methodName.slice(4);
    // match exact or suffix (e.g. 'addImage' → 'Image' matches 'ProductImage')
    const entity = (aggregate.entities || []).find(
      (e) => e.name === entitySuffix || e.name.endsWith(entitySuffix)
    );
    if (entity) {
      const fieldName = toCamelCase(pluralizeWord(entity.name));
      // Creation params for the child entity (same exclusion rules)
      const entityCreationParams = (entity.properties || []).filter((ep) => {
        if (ep.name === 'id') return false;
        if (ALWAYS_EXCLUDE_FROM_CREATION.has(ep.name)) return false;
        if (ep.readOnly && ep.defaultValue != null) return false;
        return true;
      });
      const ctorArgs = entityCreationParams.map((ep) => ep.name).join(', ');
      return `this.${fieldName}.add(new ${entity.name}(${ctorArgs}));`;
    }
  }

  // ── Case 3: child entity remove (removeX(entityId)) ───────────────────────
  if (methodName.startsWith('remove') && methodName.length > 6 && params.length === 1) {
    const entitySuffix =
      methodName.charAt(6).toUpperCase() + methodName.slice(7);
    const entity = (aggregate.entities || []).find(
      (e) => e.name === entitySuffix || e.name.endsWith(entitySuffix)
    );
    if (entity) {
      const fieldName = toCamelCase(pluralizeWord(entity.name));
      const idParam = params[0].name;
      const varName = entity.name.charAt(0).toLowerCase() + entity.name.slice(1);
      return `this.${fieldName}.removeIf(${varName} -> ${varName}.getId().equals(${idParam}));`;
    }
  }

  // ── Case 4: simple field update (all params map to aggregate props) ────────
  const allMatch = params.every((p) =>
    (aggregate.properties || []).some((prop) => prop.name === p.name)
  );
  if (allMatch) {
    return params.map((p) => `this.${p.name} = ${p.name};`).join('\n        ');
  }

  // ── Fallback: scaffold ─────────────────────────────────────────────────────
  return scaffoldBody;
}

// ─── Helper: resolve Java return type string ──────────────────────────────────
function resolveReturnType(returnTypeStr, aggregateName) {
  if (!returnTypeStr || returnTypeStr === 'void' || returnTypeStr === 'null') return 'void';
  if (returnTypeStr === aggregateName) return aggregateName;
  // Other types pass through as-is
  return returnTypeStr;
}

// ─── Helper: check if a type is a known value object ─────────────────────────
function isValueObjectType(type, bcYaml) {
  return (bcYaml.valueObjects || []).some((vo) => vo.name === type);
}

// ─── Helper: check if a type is an enum ──────────────────────────────────────
function isEnumType(type, bcYaml) {
  return (bcYaml.enums || []).some((e) => e.name === type);
}

// ─── Helper: build imports for an aggregate class ────────────────────────────
function buildImports(aggregate, bcYaml, config, businessMethods, publishedEvents) {
  const bc = bcYaml.bc;
  const pkg = config.packageName;
  const imports = new Set();

  imports.add('import java.util.UUID;');

  // Check if audit fields are needed
  if (aggregate.auditable || aggregate.softDelete) {
    imports.add('import java.time.Instant;');
  }

  // Check all properties for additional types
  for (const prop of aggregate.properties || []) {
    const enumWrapperMatch = /^Enum<(.+)>$/.exec(prop.type);
    const resolvedType = enumWrapperMatch ? enumWrapperMatch[1] : prop.type;
    const isVO = isValueObjectType(resolvedType, bcYaml);
    const isEnum = enumWrapperMatch != null || isEnumType(resolvedType, bcYaml);

    if (isVO) {
      imports.add(`import ${pkg}.${bc}.domain.valueobject.${resolvedType};`);
    } else if (isEnum) {
      imports.add(`import ${pkg}.${bc}.domain.enums.${resolvedType};`);
    } else {
      try {
        const mapped = mapType(prop.type, prop);
        if (mapped.importHint) imports.add(`import ${mapped.importHint};`);
      } catch (_) {
        // skip unknown types
      }
    }
  }

  // Child entities
  if ((aggregate.entities || []).length > 0) {
    imports.add('import java.util.List;');
    imports.add('import java.util.ArrayList;');
    for (const entity of aggregate.entities) {
      imports.add(`import ${pkg}.${bc}.domain.entity.${entity.name};`);
    }
  }

  // Domain events infrastructure
  if (publishedEvents && publishedEvents.length > 0) {
    imports.add('import java.util.List;');
    imports.add('import java.util.ArrayList;');
    imports.add('import java.util.Collections;');
    imports.add(`import ${pkg}.shared.domain.DomainEvent;`);
    for (const event of publishedEvents) {
      imports.add(`import ${pkg}.${bc}.domain.events.${event.name}Event;`);
      // If any payload field is a DateTime/Instant not on the aggregate, Instant.now() is generated
      const aggregatePropNames = new Set((aggregate.properties || []).map((pr) => pr.name));
      const needsInstantForEvent = (event.payload || []).some(
        (p) => (p.type === 'DateTime' || p.type === 'Instant') && !aggregatePropNames.has(p.name)
      );
      if (needsInstantForEvent) imports.add('import java.time.Instant;');
    }
  }

  // Instant for audit (if not already added above)
  if (aggregate.auditable) imports.add('import java.time.Instant;');
  if (aggregate.softDelete) imports.add('import java.time.Instant;');

  // Business method param types
  for (const method of businessMethods || []) {
    for (const param of method.params || []) {
      const jt = param.javaType;
      if (jt === 'UUID') continue; // already imported
      if (jt === 'Instant') {
        imports.add('import java.time.Instant;');
      } else if (jt === 'URI') {
        imports.add('import java.net.URI;');
      } else if (jt === 'BigDecimal') {
        imports.add('import java.math.BigDecimal;');
      } else if (jt === 'LocalDate') {
        imports.add('import java.time.LocalDate;');
      } else if (isValueObjectType(jt, bcYaml)) {
        imports.add(`import ${pkg}.${bc}.domain.valueobject.${jt};`);
      } else if (isEnumType(jt, bcYaml)) {
        imports.add(`import ${pkg}.${bc}.domain.enums.${jt};`);
      }
    }
  }

  return [...imports].sort();
}

// ─── Helper: build imports for a child entity class ──────────────────────────
function buildChildEntityImports(entity, bcYaml, config) {
  const bc = bcYaml.bc;
  const pkg = config.packageName;
  const imports = new Set();

  imports.add('import java.util.UUID;');

  for (const prop of entity.properties || []) {
    if (prop.name === 'id') continue; // UUID already imported

    const enumWrapperMatch = /^Enum<(.+)>$/.exec(prop.type);
    const resolvedType = enumWrapperMatch ? enumWrapperMatch[1] : prop.type;
    const isVO = isValueObjectType(resolvedType, bcYaml);
    const isEnum = enumWrapperMatch != null || isEnumType(resolvedType, bcYaml);

    if (isVO) {
      imports.add(`import ${pkg}.${bc}.domain.valueobject.${resolvedType};`);
    } else if (isEnum) {
      imports.add(`import ${pkg}.${bc}.domain.enums.${resolvedType};`);
    } else {
      try {
        const mapped = mapType(prop.type, prop);
        if (mapped.importHint) imports.add(`import ${mapped.importHint};`);
      } catch (_) {
        // skip unknown
      }
    }
  }

  return [...imports].sort();
}

// ─── Main entry ──────────────────────────────────────────────────────────────

/**
 * Generates domain aggregate root + child entity classes for a BC.
 *
 * @param {object} bcYaml    — parsed BC YAML document
 * @param {object} config    — {packageName, ...}
 * @param {string} outputDir — root output directory
 */
async function generateAggregates(bcYaml, config, outputDir) {
  const aggregates = bcYaml.aggregates || [];
  if (aggregates.length === 0) return;

  const bc = bcYaml.bc;
  const packagePath = toPackagePath(config.packageName);
  const aggregateDir = path.join(outputDir, 'src', 'main', 'java', packagePath, bc, 'domain', 'aggregate');
  const entityDir = path.join(outputDir, 'src', 'main', 'java', packagePath, bc, 'domain', 'entity');

  const bcEnums = bcYaml.enums || [];
  const useCases = bcYaml.useCases || [];
  const publishedEvents = (bcYaml.domainEvents || {}).published || [];

  for (const aggregate of aggregates) {
    // ── 0. Determine if this aggregate is a read model (no domain events) ────────
    const isReadModel = aggregate.readModel === true;

    // Filter published events to this aggregate only; read models never raise events
    const aggregatePublishedEvents = isReadModel
      ? []
      : publishedEvents.filter((e) => !e.aggregate || e.aggregate === aggregate.name);

    // ── 1. Build scalar fields (from YAML properties, excluding id and audit) ──
    const allProps = aggregate.properties || [];
    const scalarFields = allProps
      .filter((p) => p.name !== 'id') // id is always first, handled separately
      .map((p) => {
        let javaType;
        if (isValueObjectType(p.type, bcYaml)) {
          javaType = p.type;
        } else if (isEnumType(p.type, bcYaml)) {
          javaType = p.type;
        } else {
          try {
            javaType = mapType(p.type, p).javaType;
          } catch (_) {
            javaType = p.type; // pass through unknown types
          }
        }
        return {
          name: p.name,
          javaType,
          readOnly: !!p.readOnly,
          defaultValue: p.defaultValue,
          internal: !!p.internal,
        };
      });

    // ── 2. Build child entity metadata ─────────────────────────────────────────
    const childEntities = (aggregate.entities || []).map((entity) => {
      const fieldName = toCamelCase(pluralizeWord(entity.name));
      return {
        name: entity.name,
        fieldName,
        javaType: `List<${entity.name}>`,
        immutable: !!entity.immutable,
      };
    });

    // ── 3. Creation constructor params ─────────────────────────────────────────
    // Exclude: id (auto-UUID), readOnly with defaultValue, audit/softDelete fields
    const creationParams = allProps
      .filter((p) => {
        if (p.name === 'id') return false;
        if (ALWAYS_EXCLUDE_FROM_CREATION.has(p.name)) return false;
        if (p.readOnly && p.defaultValue != null) return false;
        return true;
      })
      .map((p) => {
        let javaType;
        if (isValueObjectType(p.type, bcYaml)) {
          javaType = p.type;
        } else if (isEnumType(p.type, bcYaml)) {
          javaType = p.type;
        } else {
          try {
            javaType = mapType(p.type, p).javaType;
          } catch (_) {
            javaType = p.type;
          }
        }
        return { name: p.name, javaType };
      });

    // ── 4. Auto-initialized fields (readOnly with defaultValue) ───────────────
    const autoInits = allProps
      .filter((p) => p.name !== 'id' && p.readOnly && p.defaultValue != null)
      .map((p) => {
        let enumType = null;
        const enumWrapperMatch = /^Enum<(.+)>$/.exec(p.type);
        if (enumWrapperMatch) enumType = enumWrapperMatch[1];
        else if (isEnumType(p.type, bcYaml)) enumType = p.type;

        let value;
        if (p.defaultValue === 'generated') {
          value = 'UUID.randomUUID()';
        } else if (p.defaultValue === 'now()') {
          value = 'java.time.Instant.now()';
        } else if (enumType) {
          value = `${enumType}.${p.defaultValue}`;
        } else if (typeof p.defaultValue === 'boolean') {
          value = String(p.defaultValue);
        } else {
          value = JSON.stringify(String(p.defaultValue));
        }
        return { name: p.name, value };
      });

    // ── 5. Collect business methods from useCases ──────────────────────────────
    const seenMethods = new Set();
    const businessMethods = [];

    for (const uc of useCases) {
      if (uc.type !== 'command') continue;
      if (!uc.method) continue;
      if (uc.aggregate !== aggregate.name) continue;

      const sig = parseMethodSignature(uc.method);
      if (!sig) continue;
      if (sig.name === 'create') continue; // handled by creation constructor
      if (seenMethods.has(sig.name)) continue;
      seenMethods.add(sig.name);

      // Resolve Java types for each parameter
      const params = sig.params.map((p) => ({
        name: p.name,
        javaType: resolveParamType(p.name, aggregate.properties, aggregate.entities, p.typeHint, bcYaml),
        optional: p.optional,
      }));

      const returnType = resolveReturnType(sig.returnType, aggregate.name);
      const body = computeMethodBody(uc, sig, aggregate, bcEnums, bc, aggregatePublishedEvents);

      businessMethods.push({
        name: sig.name,
        params,
        returnType,
        derivedFrom: `${uc.id} ${uc.name}`,
        body,
      });
    }

    // ── 6. Build imports (after businessMethods so param types are included) ──
    const imports = buildImports(aggregate, bcYaml, config, businessMethods, aggregatePublishedEvents);

    // ── 7. Render aggregate root ───────────────────────────────────────────────
    const context = {
      packageName: config.packageName,
      bc,
      name: aggregate.name,
      description: aggregate.description || '',
      hasAudit: !!aggregate.auditable,
      hasSoftDelete: !!aggregate.softDelete,
      hasDomainEvents: aggregatePublishedEvents.length > 0,
      hasChildEntities: childEntities.length > 0,
      imports,
      fields: scalarFields,
      childEntities,
      creationParams,
      autoInits,
      businessMethods,
    };

    const destPath = path.join(aggregateDir, `${aggregate.name}.java`);
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'domain', 'AggregateRoot.java.ejs'),
      destPath,
      context
    );

    // ── 8. Render child entities ───────────────────────────────────────────────
    for (const entity of aggregate.entities || []) {
      const entityImports = buildChildEntityImports(entity, bcYaml, config);

      const entityFields = (entity.properties || [])
        .filter((p) => p.name !== 'id')
        .map((p) => {
          let javaType;
          if (isValueObjectType(p.type, bcYaml)) {
            javaType = p.type;
          } else if (isEnumType(p.type, bcYaml)) {
            javaType = p.type;
          } else {
            try {
              javaType = mapType(p.type, p).javaType;
            } catch (_) {
              javaType = p.type;
            }
          }
          return {
            name: p.name,
            javaType,
            readOnly: !!p.readOnly,
            defaultValue: p.defaultValue,
          };
        });

      const entityCreationParams = (entity.properties || [])
        .filter((p) => {
          if (p.name === 'id') return false;
          if (ALWAYS_EXCLUDE_FROM_CREATION.has(p.name)) return false;
          if (p.readOnly && p.defaultValue != null) return false;
          return true;
        })
        .map((p) => {
          let javaType;
          if (isValueObjectType(p.type, bcYaml)) {
            javaType = p.type;
          } else if (isEnumType(p.type, bcYaml)) {
            javaType = p.type;
          } else {
            try {
              javaType = mapType(p.type, p).javaType;
            } catch (_) {
              javaType = p.type;
            }
          }
          return { name: p.name, javaType };
        });

      // Auto-inits for entity (e.g., changedAt: readOnly, defaultValue: now())
      const entityAutoInits = (entity.properties || [])
        .filter((p) => p.name !== 'id' && p.readOnly && p.defaultValue != null)
        .map((p) => {
          let enumType = null;
          const enumWrapperMatch = /^Enum<(.+)>$/.exec(p.type);
          if (enumWrapperMatch) enumType = enumWrapperMatch[1];
          else if (isEnumType(p.type, bcYaml)) enumType = p.type;

          let value;
          if (p.defaultValue === 'generated') {
            value = 'UUID.randomUUID()';
          } else if (p.defaultValue === 'now()') {
            value = 'java.time.Instant.now()';
          } else if (enumType) {
            value = `${enumType}.${p.defaultValue}`;
          } else if (typeof p.defaultValue === 'boolean') {
            value = String(p.defaultValue);
          } else {
            value = JSON.stringify(String(p.defaultValue));
          }
          return { name: p.name, value };
        });

      const entityContext = {
        packageName: config.packageName,
        bc,
        name: entity.name,
        description: entity.description || '',
        immutable: !!entity.immutable,
        imports: entityImports,
        fields: entityFields,
        creationParams: entityCreationParams,
        autoInits: entityAutoInits,
      };

      const entityDestPath = path.join(entityDir, `${entity.name}.java`);
      await renderAndWrite(
        path.join(TEMPLATES_DIR, 'domain', 'ChildEntity.java.ejs'),
        entityDestPath,
        entityContext
      );
    }
  }
}

module.exports = { generateAggregates };
