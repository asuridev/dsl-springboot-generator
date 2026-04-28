'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toSnakeCase, toCamelCase, toPascalCase, pluralizeWord, toPackagePath } = require('../utils/naming');
const { mapType } = require('../utils/type-mapper');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

const AUDIT_FIELD_NAMES = new Set(['createdAt', 'updatedAt', 'deletedAt']);

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

function isVoType(type, bcYaml) {
  if (type === 'Money') return false;
  return (bcYaml.valueObjects || []).some((vo) => vo.name === type);
}

function getVoInnerProp(type, bcYaml) {
  const voDef = (bcYaml.valueObjects || []).find((vo) => vo.name === type);
  if (voDef && (voDef.properties || []).length === 1) return voDef.properties[0].name;
  return null;
}

function getVoDef(type, bcYaml) {
  return (bcYaml.valueObjects || []).find((vo) => vo.name === type) || null;
}

/**
 * Map a YAML canonical type to a Java type string for use in repo/impl code.
 * PageRequest → Pageable (Spring Data)
 */
function yamlTypeToJava(type) {
  if (!type) return 'String';
  if (type === 'Uuid') return 'UUID';
  if (type === 'PageRequest') return 'Pageable';
  if (type === 'String' || type === 'Text' || type === 'Email') return 'String';
  if (/^String\(\d+\)$/.test(type)) return 'String';
  if (type === 'Integer') return 'Integer';
  if (type === 'Long') return 'Long';
  if (type === 'Boolean') return 'Boolean';
  if (type === 'Decimal') return 'BigDecimal';
  if (type === 'DateTime') return 'Instant';
  if (type === 'Date') return 'LocalDate';
  if (type === 'Url') return 'URI';
  if (type === 'Money') return 'Money';
  // Enum<X> → X
  const enumMatch = type.match(/^Enum<(.+)>$/);
  if (enumMatch) return enumMatch[1];
  const listMatch = type.match(/^List\[(.+)\]$/);
  if (listMatch) return `List<${yamlTypeToJava(listMatch[1])}>`;
  // Enum, aggregate, or VO name — use as-is
  return type;
}

/**
 * Map a YAML return type string to a Java return type string.
 */
function yamlReturnToJava(returns) {
  if (!returns || returns === 'void') return 'void';
  if (returns === 'Int') return 'int';
  const optionalMatch = returns.match(/^(.+)\?$/);
  if (optionalMatch) return `Optional<${optionalMatch[1]}>`;
  const pageMatch = returns.match(/^Page\[(.+)\]$/);
  if (pageMatch) return `Page<${pageMatch[1]}>`;
  const listMatch = returns.match(/^List\[(.+)\]$/);
  if (listMatch) return `List<${listMatch[1]}>`;
  return returns;
}

/**
 * Infer a parameter name from its YAML type + method name context.
 */
function inferParamName(type, methodName) {
  // findBy{Field} → field name
  const findByMatch = methodName.match(/^findBy([A-Z]\w+)$/);
  if (findByMatch) return toCamelCase(findByMatch[1]);

  if (type === 'Uuid') return methodName.includes('findBy') ? toCamelCase(methodName.replace('findBy', '')) : 'id';
  if (type === 'Email') return 'email';
  if (type === 'PageRequest') return 'pageable';
  if (type === 'String') return 'query';
  if (/^String\(\d+\)$/.test(type)) return 'value';
  if (type.endsWith('Status')) return 'status';
  if (/^List\[/.test(type)) return 'statuses';
  return toCamelCase(type);
}

/**
 * Parse a repo method in "signature" format: "findById(Uuid): Customer?"
 * Returns { name, params: [{type, name, required}], returns }
 */
function parseSignatureFormat(sig, methodName) {
  if (!sig) return null;

  // Match with return type
  const withReturn = sig.match(/^(\w+)\(([^)]*)\)\s*:\s*(.+)$/);
  if (withReturn) {
    const [, name, paramsStr, returns] = withReturn;
    const params = paramsStr
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        // Format: "paramName?: Type" — named optional param (TypeScript-style)
        const namedOptional = p.match(/^(\w+)\?\s*:\s*(.+)$/);
        if (namedOptional) {
          return { type: namedOptional[2].trim(), name: namedOptional[1], required: false };
        }
        // Format: "Type?" — type-only optional, or bare type name
        const optional = p.endsWith('?');
        const typeStr = optional ? p.slice(0, -1).trim() : p.trim();
        return { type: typeStr, name: inferParamName(typeStr, name), required: !optional };
      });
    return { name, params, returns };
  }

  // Match without return type (e.g. "save(Customer)")
  const noReturn = sig.match(/^(\w+)\(([^)]*)\)$/);
  if (noReturn) {
    const [, name, paramsStr] = noReturn;
    const params = paramsStr
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        // Format: "paramName?: Type" — named optional param (TypeScript-style)
        const namedOptional = p.match(/^(\w+)\?\s*:\s*(.+)$/);
        if (namedOptional) {
          return { type: namedOptional[2].trim(), name: namedOptional[1], required: false };
        }
        // Format: "Type?" — type-only optional, or bare type name
        const optional = p.endsWith('?');
        const typeStr = optional ? p.slice(0, -1).trim() : p.trim();
        return { type: typeStr, name: inferParamName(typeStr, name), required: !optional };
      });
    return { name, params, returns: 'void' };
  }

  return null;
}

/**
 * Parse a repo method in "params/returns" format (catalog YAML style).
 * Handles both structured form ({ name, type }) and inline flow form ({ paramName: 'Type' }).
 */
function parseParamsFormat(method) {
  const params = (method.params || []).map((p) => {
    // Inline YAML flow form: [id: Uuid] is parsed as [{id: 'Uuid'}]
    if (typeof p === 'object' && p !== null && !('name' in p) && !('type' in p)) {
      const entries = Object.entries(p);
      if (entries.length === 1) {
        const [name, type] = entries[0];
        return { type: String(type), name, required: true };
      }
    }
    return { ...p, type: p.type, name: p.name, required: p.required !== false };
  });
  return { name: method.name, params, returns: method.returns || 'void' };
}

/**
 * Normalize a YAML repository method into a unified descriptor.
 */
function normalizeMethod(yamlMethod) {
  if (yamlMethod.signature) {
    return parseSignatureFormat(yamlMethod.signature, yamlMethod.name) || { name: yamlMethod.name, params: [], returns: 'void' };
  }
  return parseParamsFormat(yamlMethod);
}

/**
 * Build the JPQL query for a "list" method (optional-filter + pagination).
 * entityAlias — single-letter alias; jpaEntityName — "ProductJpa"; optional params
 */
function buildListQuery(jpaEntityName, optionalParams, requiredFilterParams, alias) {
  const a = alias || jpaEntityName.charAt(0).toLowerCase();
  const reqConditions = (requiredFilterParams || []).map((p) => `${a}.${p.name} = :${p.name}`);
  const optConditions = optionalParams.map((p) => {
    if (p.filterOn && Array.isArray(p.filterOn) && p.filterOn.length > 0) {
      // LIKE_CONTAINS: search param mapped to one or more entity fields
      const likeConditions = p.filterOn.map((f) => `${a}.${f} LIKE CONCAT('%', :${p.name}, '%')`);
      return `(:${p.name} IS NULL OR (${likeConditions.join(' OR ')}))`;
    }
    return `(:${p.name} IS NULL OR ${a}.${p.name} = :${p.name})`;
  });
  const allConditions = [...reqConditions, ...optConditions];
  const where = allConditions.length > 0 ? ` WHERE ${allConditions.join(' AND ')}` : '';
  return `SELECT ${a} FROM ${jpaEntityName} ${a}${where}`;
}

/**
 * Build the JPQL query for a "count across entity" method.
 * Method name pattern: count{Entities}InXxx or count{Entities}ByXxx
 * Params: [{name, type}] — FK param + optional filter
 */
function buildCountQuery(methodName, params, bcYaml, fallbackJpaEntityName, currentAggregate) {
  // Extract entity plural from method name: countActiveProductsByCategoryId → ActiveProducts
  const match = methodName.match(/^count([A-Z][a-zA-Z]+?)(?:In|By|With)/);
  if (!match) {
    // Fallback: build JPQL using the current aggregate's JPA entity and params
    const jpaName = fallbackJpaEntityName || 'EntityJpa';
    const a = jpaName.charAt(0).toLowerCase();
    const conditions = (params || []).map((p) => `${a}.${p.name} = :${p.name}`);
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    return `SELECT COUNT(${a}) FROM ${jpaName} ${a}${where}`;
  }
  const entityPlural = match[1];

  // 1. Try direct aggregate match: countProductsBy... → Products → Product
  let aggregate = (bcYaml.aggregates || []).find(
    (a) => a.name === entityPlural || pluralizeWord(a.name) === entityPlural
  );

  const extraConditions = [];

  // 2. Suffix match: countActiveProductsBy... → prefix="Active", entity="Products" → Product
  //    Adds a status condition automatically (e.g. p.status = 'ACTIVE').
  if (!aggregate) {
    for (const agg of (bcYaml.aggregates || [])) {
      const plural = pluralizeWord(agg.name);
      if (entityPlural.endsWith(plural) && entityPlural.length > plural.length) {
        const statusValue = entityPlural.slice(0, entityPlural.length - plural.length).toUpperCase();
        aggregate = agg;
        const statusProp = (agg.properties || []).find(
          (p) => p.name === 'status' || (p.type && p.type.endsWith('Status'))
        );
        const statusField = statusProp ? statusProp.name : 'status';
        extraConditions.push(`${statusField} = '${statusValue}'`);
        break;
      }
    }
  }

  // If no aggregate matched, entityPlural is a state qualifier (e.g. 'Active', 'Pending').
  // Add a status condition and fall back to the current aggregate's JPA entity.
  // Exception: soft-delete aggregates have no status field — @SQLRestriction handles filtering.
  if (!aggregate && extraConditions.length === 0) {
    if (!currentAggregate || currentAggregate.softDelete !== true) {
      extraConditions.push(`status = '${entityPlural.toUpperCase()}'`);
    }
  }
  const jpaName = aggregate ? `${aggregate.name}Jpa` : (fallbackJpaEntityName || `${entityPlural.replace(/s$/, '')}Jpa`);
  const a = jpaName.charAt(0).toLowerCase();

  const conditions = [
    ...extraConditions.map((c) => `${a}.${c}`),
    ...params.map((p) => {
      if (/^List\[/.test(p.type)) return `${a}.${p.name.replace(/s$/, '')} IN :${p.name}`;
      return `${a}.${p.name} = :${p.name}`;
    }),
  ];
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  return `SELECT COUNT(${a}) FROM ${jpaName} ${a}${where}`;
}

/**
 * Build the JPQL for a "search" method (LIKE on multiple fields).
 * Assumes method name: searchBy{Field1}Or{Field2}(query, PageRequest)
 */
function buildSearchQuery(methodName, jpaEntityName, aggregate) {
  const a = jpaEntityName.charAt(0).toLowerCase();
  // Extract field names from method name: searchByNameOrSku → [name, sku]
  const fieldsMatch = methodName.match(/^searchBy(.+)$/);
  if (!fieldsMatch) return `// TODO: write @Query for ${methodName}`;

  const fieldNames = fieldsMatch[1]
    .split('Or')
    .map((f) => f.charAt(0).toLowerCase() + f.slice(1));

  const conditions = fieldNames.map((f) => `LOWER(${a}.${f}) LIKE LOWER(CONCAT('%', :query, '%'))`);
  return `SELECT ${a} FROM ${jpaEntityName} ${a} WHERE ${conditions.join(' OR ')}`;
}

/**
 * Determine if a method should appear in the Spring Data JPA interface.
 * Returns: 'skip' | 'derived' | 'custom'
 */
function classifyMethod(method) {
  if (method.derivedFrom === 'implicit') return 'skip';
  if (method.name === 'findById' || method.name === 'save') return 'skip';

  // Spring Data derived: findByXxx with a single non-Pageable param
  if (/^findBy[A-Z]/.test(method.name)) {
    const nonPageable = (method.params || []).filter((p) => p.type !== 'PageRequest' && p.name !== 'pageable');
    if (nonPageable.length === 1 && !method.returns?.startsWith('Page[')) return 'derived';
  }

  // Spring Data derived: countByXxx — Spring Data derives count queries from method name
  if (/^countBy[A-Z]/.test(method.name)) {
    return 'derived';
  }

  return 'custom';
}

/**
 * Build the @Query string for a custom JPA repository method.
 */
function buildJpqlQuery(method, jpaEntityName, aggregate, bcYaml) {
  const { name, params, returns } = method;

  if (returns && returns.startsWith('Page[')) {
    // list or search
    if (/^search/.test(name)) {
      return buildSearchQuery(name, jpaEntityName, aggregate);
    }
    // page/size Integer params are pagination — exclude from JPQL conditions
    const isPaginationParam = (p) =>
      p.type === 'PageRequest' || p.name === 'pageable' ||
      ((p.name === 'page' || p.name === 'size') && p.type === 'Integer');
    const requiredFilterParams = (params || []).filter((p) => !isPaginationParam(p) && p.required !== false);
    const optionalParams = (params || []).filter((p) => !isPaginationParam(p) && p.required === false);
    return buildListQuery(jpaEntityName, optionalParams, requiredFilterParams);
  }

  if (returns === 'Int' || returns === 'Integer') {
    return buildCountQuery(name, params || [], bcYaml, jpaEntityName, aggregate);
  }

  if (returns && returns.startsWith('List[')) {
    const a = jpaEntityName.charAt(0).toLowerCase();
    const conditions = (params || [])
      .filter((p) => p.type !== 'PageRequest' && p.name !== 'pageable')
      .map((p) => {
        if (/^List\[/.test(p.type)) return `${a}.${p.name.replace(/s$/, '')} IN :${p.name}`;
        return `${a}.${p.name} = :${p.name}`;
      });
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    return `SELECT ${a} FROM ${jpaEntityName} ${a}${where}`;
  }

  return null;
}

/**
 * Build the Spring Data JPA method signature string for an interface declaration.
 */
function buildJpaMethodSignature(method, jpaEntityName) {
  const params = (method.params || []).map((p) => {
    const javaType = yamlTypeToJava(p.type);
    if (p.type === 'PageRequest') {
      return `Pageable ${p.name}`;
    }
    if (method.returns && (method.returns.startsWith('Page[') || method.returns === 'Int' || method.returns === 'Integer') && p.required === false) {
      return `@Param("${p.name}") ${javaType} ${p.name}`;
    }
    if ((method.returns && method.returns.startsWith('Page[')) || method.returns === 'Int' || method.returns === 'Integer') {
      return `@Param("${p.name}") ${javaType} ${p.name}`;
    }
    return `${javaType} ${p.name}`;
  });

  let returnType = yamlReturnToJava(method.returns);
  // For JPA repo: use Jpa entity type instead of domain type
  returnType = returnType
    .replace(new RegExp(`Optional<${method.aggregateName}>`), `Optional<${jpaEntityName}>`)
    .replace(new RegExp(`Page<${method.aggregateName}>`), `Page<${jpaEntityName}>`)
    .replace(new RegExp(`List<${method.aggregateName}>`), `List<${jpaEntityName}>`);

  return { returnType, paramsStr: params.join(', ') };
}

// ─── Import collection ────────────────────────────────────────────────────────

function collectRepoInterfaceImports(methods, bc, packageName) {
  const imports = new Set();
  let hasOptional = false;
  let hasPage = false;
  let hasPageable = false;

  for (const method of methods) {
    const rt = method.returnType;
    if (rt.startsWith('Optional<')) hasOptional = true;
    if (rt.startsWith('Page<')) { hasPage = true; hasPageable = true; }
    if (rt === 'int' || rt === 'void') { /* primitive */ }

    for (const p of method.params) {
      if (p.javaType === 'Pageable') hasPageable = true;
      if (p.javaType === 'UUID') imports.add('java.util.UUID');
      if (p.javaType.startsWith('List<')) imports.add('java.util.List');
      if (p.javaType === 'BigDecimal') imports.add('java.math.BigDecimal');
      if (p.javaType === 'Instant') imports.add('java.time.Instant');
      if (p.javaType === 'LocalDate') imports.add('java.time.LocalDate');
      if (p.javaType === 'URI') imports.add('java.net.URI');
      // Enum or domain types: need full import
      if (/^[A-Z]/.test(p.javaType) && !['UUID', 'String', 'Integer', 'Long', 'Boolean', 'BigDecimal', 'Instant', 'LocalDate', 'URI', 'Pageable', 'Money'].includes(p.javaType)) {
        // Enum type
        if (p.javaType.endsWith('Status') || p.javaType.endsWith('Type') || p.javaType.endsWith('State')) {
          imports.add(`${packageName}.${bc}.domain.enums.${p.javaType}`);
        }
      }
      // List inner types
      const listMatch = p.javaType.match(/^List<(.+)>$/);
      if (listMatch) {
        const inner = listMatch[1];
        if (inner.endsWith('Status') || inner.endsWith('Type') || inner.endsWith('State')) {
          imports.add(`${packageName}.${bc}.domain.enums.${inner}`);
        }
        imports.add('java.util.List');
      }
    }

    // Return type imports
    if (rt.startsWith('List<')) imports.add('java.util.List');
    const aggMatch = rt.match(/^(?:Optional|Page|List)<(.+)>$/);
    if (aggMatch) {
      const inner = aggMatch[1];
      // Aggregate domain class
      imports.add(`${packageName}.${bc}.domain.aggregate.${inner}`);
    }
  }

  if (hasOptional) imports.add('java.util.Optional');
  if (hasPage) imports.add('org.springframework.data.domain.Page');
  if (hasPageable) imports.add('org.springframework.data.domain.Pageable');

  return [...imports].sort();
}

function collectJpaRepoImports(customMethods, aggregate, jpaEntityName, bc, packageName, bcYaml) {
  const imports = new Set();
  imports.add(`${packageName}.${bc}.infrastructure.persistence.entities.${jpaEntityName}`);

  let hasPage = false;
  let hasPageable = false;

  for (const method of customMethods) {
    if (method.returnType.startsWith('Page<')) { hasPage = true; hasPageable = true; }
    if (method.returnType.startsWith('List<')) imports.add('java.util.List');

    // Parse param types from paramsStr for imports
    const params = method._params || [];
    for (const p of params) {
      if (p.javaType === 'UUID') imports.add('java.util.UUID');
      if (p.javaType.startsWith('List<')) {
        imports.add('java.util.List');
        const listMatch = p.javaType.match(/^List<(.+)>$/);
        if (listMatch) {
          const inner = listMatch[1];
          if (isEnumType(inner, bcYaml)) imports.add(`${packageName}.${bc}.domain.enums.${inner}`);
        }
      }
      if (isEnumType(p.javaType, bcYaml)) {
        imports.add(`${packageName}.${bc}.domain.enums.${p.javaType}`);
      }
    }
  }

  if (hasPage) imports.add('org.springframework.data.domain.Page');
  if (hasPageable) imports.add('org.springframework.data.domain.Pageable');

  // @Modifying methods (e.g. softDelete) require extra imports
  if (customMethods.some((m) => m.modifying)) {
    imports.add('org.springframework.data.jpa.repository.Modifying');
    imports.add('org.springframework.transaction.annotation.Transactional');
  }

  return [...imports].sort();
}

// ─── Mapper code generation ───────────────────────────────────────────────────

/**
 * Get the Money VO property names (amount, currency) from the BC YAML.
 */
function getMoneyVoProps(bcYaml) {
  const moneyVo = (bcYaml.valueObjects || []).find((v) => v.name === 'Money');
  if (moneyVo && moneyVo.properties && moneyVo.properties.length >= 2) {
    return moneyVo.properties.map((p) => p.name);
  }
  return ['amount', 'currency'];
}

/**
 * Build the body of the toDomain mapper for an aggregate.
 * Reconstruction constructor order: id, all props (minus id/audit), child lists, audit, softDelete
 */
function buildToDomainBody(aggregate, bcYaml) {
  const name = aggregate.name;
  const moneyProps = getMoneyVoProps(bcYaml);
  const [amountProp, currencyProp] = moneyProps;

  const props = (aggregate.properties || []).filter((p) => {
    if (p.name === 'id') return false;
    if (p.name === 'createdAt' || p.name === 'updatedAt') return false;
    // deletedAt is excluded only when softDelete=true (handled at end of constructor)
    // When declared explicitly as a prop (e.g. LRM with softDelete=false), include it
    if (p.name === 'deletedAt' && aggregate.softDelete === true) return false;
    return true;
  });

  const args = ['jpa.getId()'];

  for (const prop of props) {
    if (isMoneyType(prop.type)) {
      const amountField = `${prop.name}${capitalize(amountProp)}`;
      const currencyField = `${prop.name}${capitalize(currencyProp)}`;
      args.push(`new Money(jpa.get${capitalize(amountField)}(), jpa.get${capitalize(currencyField)}())`);
    } else if (isVoType(prop.type, bcYaml)) {
      const inner = getVoInnerProp(prop.type, bcYaml);
      if (inner) {
        // Single-property VO: reconstruct from scalar column
        const nullable = prop.nullable === true;
        const getter = `jpa.get${capitalize(prop.name)}()`;
        args.push(nullable
          ? `${getter} != null ? new ${prop.type}(${getter}) : null`
          : `new ${prop.type}(${getter})`);
      } else {
        // Multi-property VO: reconstruct from expanded columns
        const voDef = getVoDef(prop.type, bcYaml);
        if (voDef) {
          const voArgs = (voDef.properties || []).map(
            (vp) => `jpa.get${capitalize(prop.name)}${capitalize(vp.name)}()`
          );
          args.push(`new ${prop.type}(${voArgs.join(', ')})`);
        } else {
          args.push(`jpa.get${capitalize(prop.name)}()`);
        }
      }
    } else {
      args.push(`jpa.get${capitalize(prop.name)}()`);
    }
  }

  for (const entity of aggregate.entities || []) {
    const fieldName = toCamelCase(pluralizeWord(entity.name));
    args.push(`jpa.get${capitalize(fieldName)}().stream().map(this::to${entity.name}Domain).toList()`);
  }

  if (aggregate.auditable) {
    args.push('jpa.getCreatedAt()');
    args.push('jpa.getUpdatedAt()');
  }
  if (aggregate.softDelete) {
    args.push('jpa.getDeletedAt()');
  }

  const argLines = args.map((a, i) => `${i > 0 ? '            ' : ''}${a}${i < args.length - 1 ? ',' : ''}`);
  return `return new ${name}(\n            ${argLines.join('\n').trimStart()}\n        );`;
}

/**
 * Build the body of the toJpa mapper for an aggregate.
 */
function buildToJpaBody(aggregate, bcYaml) {
  const name = aggregate.name;
  const moneyProps = getMoneyVoProps(bcYaml);
  const [amountProp, currencyProp] = moneyProps;

  const props = (aggregate.properties || []).filter((p) => {
    if (p.name === 'id') return false;
    if (p.name === 'createdAt' || p.name === 'updatedAt') return false;
    // deletedAt is never in the Lombok builder — it lives in FullAuditableEntity (inherited).
    // FullAuditableEntity is used when auditable=true OR softDelete=true.
    if (p.name === 'deletedAt' && (aggregate.auditable === true || aggregate.softDelete === true)) return false;
    return true;
  });

  const lines = [`${name}Jpa jpa = ${name}Jpa.builder()`, `        .id(domain.getId())`];

  for (const prop of props) {
    if (isMoneyType(prop.type)) {
      const amountField = `${prop.name}${capitalize(amountProp)}`;
      const currencyField = `${prop.name}${capitalize(currencyProp)}`;
      lines.push(`        .${amountField}(domain.get${capitalize(prop.name)}().get${capitalize(amountProp)}())`);
      lines.push(`        .${currencyField}(domain.get${capitalize(prop.name)}().get${capitalize(currencyProp)}())`);
    } else if (isVoType(prop.type, bcYaml)) {
      const inner = getVoInnerProp(prop.type, bcYaml);
      if (inner) {
        const nullable = prop.nullable === true;
        const domainGetter = `domain.get${capitalize(prop.name)}()`;
        lines.push(nullable
          ? `        .${prop.name}(${domainGetter} != null ? ${domainGetter}.get${capitalize(inner)}() : null)`
          : `        .${prop.name}(${domainGetter}.get${capitalize(inner)}())`);
      } else {
        // Multi-property VO: expand to individual JPA builder calls
        const voDef = getVoDef(prop.type, bcYaml);
        if (voDef) {
          for (const vp of (voDef.properties || [])) {
            const jpaField = `${prop.name}${capitalize(vp.name)}`;
            lines.push(`        .${jpaField}(domain.get${capitalize(prop.name)}().get${capitalize(vp.name)}())`);
          }
        } else {
          lines.push(`        .${prop.name}(domain.get${capitalize(prop.name)}())`);
        }
      }
    } else {
      lines.push(`        .${prop.name}(domain.get${capitalize(prop.name)}())`);
    }
  }

  for (const entity of aggregate.entities || []) {
    const fieldName = toCamelCase(pluralizeWord(entity.name));
    lines.push(`        .${fieldName}(domain.get${capitalize(fieldName)}().stream().map(this::to${entity.name}Jpa).collect(java.util.stream.Collectors.toCollection(java.util.ArrayList::new)))`);
  }

  lines.push(`        .build();`);

  // Set deletedAt via setter — field lives in FullAuditableEntity, not in builder.
  // Applies when: softDelete=true (injected field) OR aggregate has explicit deletedAt prop.
  const hasExplicitDeletedAt = (aggregate.properties || []).some((p) => p.name === 'deletedAt');
  if (aggregate.softDelete || hasExplicitDeletedAt) {
    lines.push(`jpa.setDeletedAt(domain.getDeletedAt());`);
  }

  lines.push(`return jpa;`);

  return lines.join('\n        ');
}

/**
 * Build toDomain body for a child entity.
 */
function buildChildToDomainBody(entity, bcYaml) {
  const name = entity.name;
  const moneyProps = getMoneyVoProps(bcYaml);
  const [amountProp, currencyProp] = moneyProps;

  const props = (entity.properties || []).filter((p) => p.name !== 'id');

  const args = ['jpa.getId()'];

  for (const prop of props) {
    if (isMoneyType(prop.type)) {
      const amountField = `${prop.name}${capitalize(amountProp)}`;
      const currencyField = `${prop.name}${capitalize(currencyProp)}`;
      args.push(`new Money(jpa.get${capitalize(amountField)}(), jpa.get${capitalize(currencyField)}())`);
    } else if (isVoType(prop.type, bcYaml)) {
      const inner = getVoInnerProp(prop.type, bcYaml);
      if (inner) {
        // Single-property VO: reconstruct from scalar column
        const nullable = prop.nullable === true;
        const getter = `jpa.get${capitalize(prop.name)}()`;
        args.push(nullable
          ? `${getter} != null ? new ${prop.type}(${getter}) : null`
          : `new ${prop.type}(${getter})`);
      } else {
        // Multi-property VO: reconstruct from expanded columns
        const voDef = getVoDef(prop.type, bcYaml);
        if (voDef) {
          const voArgs = (voDef.properties || []).map(
            (vp) => `jpa.get${capitalize(prop.name)}${capitalize(vp.name)}()`
          );
          args.push(`new ${prop.type}(${voArgs.join(', ')})`);
        } else {
          args.push(`jpa.get${capitalize(prop.name)}()`);
        }
      }
    } else {
      args.push(`jpa.get${capitalize(prop.name)}()`);
    }
  }

  const argLines = args.map((a, i) => `${i > 0 ? '            ' : ''}${a}${i < args.length - 1 ? ',' : ''}`);
  return `return new ${name}(\n            ${argLines.join('\n').trimStart()}\n        );`;
}

/**
 * Build toJpa body for a child entity.
 */
function buildChildToJpaBody(entity, bcYaml) {
  const name = entity.name;
  const moneyProps = getMoneyVoProps(bcYaml);
  const [amountProp, currencyProp] = moneyProps;

  const props = (entity.properties || []).filter((p) => p.name !== 'id');

  const lines = [`return ${name}Jpa.builder()`, `        .id(domain.getId())`];

  for (const prop of props) {
    if (isMoneyType(prop.type)) {
      const amountField = `${prop.name}${capitalize(amountProp)}`;
      const currencyField = `${prop.name}${capitalize(currencyProp)}`;
      lines.push(`        .${amountField}(domain.get${capitalize(prop.name)}().get${capitalize(amountProp)}())`);
      lines.push(`        .${currencyField}(domain.get${capitalize(prop.name)}().get${capitalize(currencyProp)}())`);
    } else if (isVoType(prop.type, bcYaml)) {
      const inner = getVoInnerProp(prop.type, bcYaml);
      if (inner) {
        // Single-property VO: unwrap to scalar column
        const nullable = prop.nullable === true;
        const domainGetter = `domain.get${capitalize(prop.name)}()`;
        lines.push(nullable
          ? `        .${prop.name}(${domainGetter} != null ? ${domainGetter}.get${capitalize(inner)}() : null)`
          : `        .${prop.name}(${domainGetter}.get${capitalize(inner)}())`);
      } else {
        // Multi-property VO: expand to individual JPA builder calls
        const voDef = getVoDef(prop.type, bcYaml);
        if (voDef) {
          for (const vp of (voDef.properties || [])) {
            const jpaField = `${prop.name}${capitalize(vp.name)}`;
            lines.push(`        .${jpaField}(domain.get${capitalize(prop.name)}().get${capitalize(vp.name)}())`);
          }
        } else {
          lines.push(`        .${prop.name}(domain.get${capitalize(prop.name)}())`);
        }
      }
    } else {
      lines.push(`        .${prop.name}(domain.get${capitalize(prop.name)}())`);
    }
  }

  lines.push(`        .build();`);
  return lines.join('\n        ');
}

// ─── Method body (RepositoryImpl) ────────────────────────────────────────────

/**
 * Build the Java method body for a RepositoryImpl method.
 */
function buildImplMethodBody(normalizedMethod, methodReturnType, hasDomainEvents) {
  const { name, params } = normalizedMethod;
  const paramNames = (params || []).map((p) => p.name).join(', ');
  const entityParam = params[0]?.name || 'entity';

  if (name === 'save' && hasDomainEvents) {
    if (methodReturnType === 'void') {
      return `jpaRepository.save(toJpa(${entityParam}));\n        ${entityParam}.pullDomainEvents().forEach(eventPublisher::publishEvent);`;
    }
    return `${methodReturnType} saved = toDomain(jpaRepository.save(toJpa(${entityParam})));\n        ${entityParam}.pullDomainEvents().forEach(eventPublisher::publishEvent);\n        return saved;`;
  }

  if (name === 'save') {
    if (methodReturnType === 'void') {
      return `jpaRepository.save(toJpa(${entityParam}));`;
    }
    return `return toDomain(jpaRepository.save(toJpa(${entityParam})));`;
  }

  if (methodReturnType === 'void') {
    return `jpaRepository.${name}(${paramNames});`;
  }

  if (methodReturnType === 'int') {
    return `return jpaRepository.${name}(${paramNames});`;
  }

  if (methodReturnType.startsWith('Optional<')) {
    if (name === 'findById') {
      return `return jpaRepository.findById(${params[0]?.name || 'id'}).map(this::toDomain);`;
    }
    return `return jpaRepository.${name}(${paramNames}).map(this::toDomain);`;
  }

  if (methodReturnType.startsWith('Page<')) {
    // If params include page+size pair, build PageRequest.of(page, size) for JPA call
    const pageParam = (params || []).find((p) => p.name === 'page');
    const sizeParam = (params || []).find((p) => p.name === 'size');
    if (pageParam && sizeParam) {
      const otherParams = (params || []).filter((p) => p.name !== 'page' && p.name !== 'size');
      const otherNames = otherParams.map((p) => p.name).join(', ');
      const jpaArgs = otherNames ? `${otherNames}, PageRequest.of(page, size)` : 'PageRequest.of(page, size)';
      return `return jpaRepository.${name}(${jpaArgs}).map(this::toDomain);`;
    }
    return `return jpaRepository.${name}(${paramNames}).map(this::toDomain);`;
  }

  if (methodReturnType.startsWith('List<')) {
    return `return jpaRepository.${name}(${paramNames}).stream().map(this::toDomain).toList();`;
  }

  return `return jpaRepository.${name}(${paramNames});`;
}

// ─── Import collection for RepositoryImpl ─────────────────────────────────────

function collectImplImports(aggregateName, aggregate, methods, bc, packageName, bcYaml, hasDomainEvents) {
  const imports = new Set();

  // Always needed
  imports.add(`${packageName}.${bc}.domain.repository.${aggregateName}Repository`);
  imports.add(`${packageName}.${bc}.infrastructure.persistence.entities.${aggregateName}Jpa`);
  imports.add(`${packageName}.${bc}.domain.aggregate.${aggregateName}`);

  let hasOptional = false;
  let hasPage = false;
  let hasPageable = false;

  for (const method of methods) {
    const rt = method.returnType;
    if (rt.startsWith('Optional<')) hasOptional = true;
    if (rt.startsWith('Page<')) { hasPage = true; hasPageable = true; }
    if (rt.startsWith('List<')) imports.add('java.util.List');

    for (const p of method.params) {
      if (p.javaType === 'UUID') imports.add('java.util.UUID');
      if (p.javaType.startsWith('List<')) {
        imports.add('java.util.List');
        const inner = p.javaType.match(/^List<(.+)>$/)?.[1];
        if (inner && isEnumType(inner, bcYaml)) {
          imports.add(`${packageName}.${bc}.domain.enums.${inner}`);
        }
      }
      if (isEnumType(p.javaType, bcYaml)) {
        imports.add(`${packageName}.${bc}.domain.enums.${p.javaType}`);
      }
      if (p.javaType === 'Pageable') hasPageable = true;
    }
  }

  // PageRequest needed when any Page<> method uses page+size Integer pagination
  let hasPageRequest = false;
  for (const method of methods) {
    if (method.returnType.startsWith('Page<')) {
      const hasPageParam = method.params.some((p) => p.name === 'page');
      const hasSizeParam = method.params.some((p) => p.name === 'size');
      if (hasPageParam && hasSizeParam) hasPageRequest = true;
    }
  }

  if (hasOptional) imports.add('java.util.Optional');
  if (hasPage) imports.add('org.springframework.data.domain.Page');
  if (hasPageable) imports.add('org.springframework.data.domain.Pageable');
  if (hasPageRequest) imports.add('org.springframework.data.domain.PageRequest');

  // Child entities
  for (const entity of aggregate.entities || []) {
    imports.add(`${packageName}.${bc}.domain.entity.${entity.name}`);
    imports.add(`${packageName}.${bc}.infrastructure.persistence.entities.${entity.name}Jpa`);
  }

  // Money VO (if any property or child entity property is Money)
  const hasMoneyInAggregate = (aggregate.properties || []).some((p) => isMoneyType(p.type));
  const hasMoneyInEntities = (aggregate.entities || []).some((e) =>
    (e.properties || []).some((p) => isMoneyType(p.type))
  );
  if (hasMoneyInAggregate || hasMoneyInEntities) {
    imports.add(`${packageName}.${bc}.domain.valueobject.Money`);
  }

  // Non-Money VOs used in toDomain/toJpa mappers
  const allProps = [
    ...(aggregate.properties || []),
    ...(aggregate.entities || []).flatMap((e) => e.properties || []),
  ];
  for (const prop of allProps) {
    if (isVoType(prop.type, bcYaml)) {
      imports.add(`${packageName}.${bc}.domain.valueobject.${prop.type}`);
    }
  }

  // JpaRepository interface
  imports.add(`${packageName}.${bc}.infrastructure.persistence.repositories.${aggregateName}JpaRepository`);

  // ApplicationEventPublisher (domain events)
  if (hasDomainEvents) {
    imports.add('org.springframework.context.ApplicationEventPublisher');
  }

  return [...imports].sort();
}

// ─── Main context builders ────────────────────────────────────────────────────

function buildRepoInterfaceContext(aggregateName, normalizedMethods, bc, packageName, bcYaml) {
  const methods = normalizedMethods.map((m) => ({
    name: m.name,
    returnType: yamlReturnToJava(m.returns),
    params: (m.params || []).map((p) => ({
      name: p.name,
      javaType: yamlTypeToJava(p.type),
    })),
  }));

  const imports = collectRepoInterfaceImports(methods, bc, packageName);
  return { packageName, bc, aggregateName, methods, imports };
}

function buildJpaRepoInterfaceContext(aggregateName, normalizedMethods, aggregate, bc, packageName, bcYaml) {
  const jpaEntityName = `${aggregateName}Jpa`;

  const customMethods = [];
  for (const m of normalizedMethods) {
    const classification = classifyMethod({ ...m, aggregateName, derivedFrom: m.derivedFrom });
    if (classification === 'skip') continue;

    const javaParams = (m.params || []).map((p) => ({
      name: p.name,
      javaType: yamlTypeToJava(p.type),
    }));

    let jpaReturnType = yamlReturnToJava(m.returns)
      .replace(`Optional<${aggregateName}>`, `Optional<${jpaEntityName}>`)
      .replace(`Page<${aggregateName}>`, `Page<${jpaEntityName}>`)
      .replace(`List<${aggregateName}>`, `List<${jpaEntityName}>`);

    // Build params string with @Param annotations for @Query methods
    let paramsStr;
    const needsQuery = classification === 'custom';

    if (needsQuery) {
      const isPageReturn = m.returns && m.returns.startsWith('Page[');
      const hasPageSize = isPageReturn
        && (m.params || []).some((p) => p.name === 'page' && p.type === 'Integer')
        && (m.params || []).some((p) => p.name === 'size' && p.type === 'Integer');
      let pageableAdded = false;
      paramsStr = (m.params || []).map((p) => {
        const javaType = yamlTypeToJava(p.type);
        if (p.type === 'PageRequest') return `Pageable ${p.name || 'pageable'}`;
        if (hasPageSize && (p.name === 'page' || p.name === 'size') && p.type === 'Integer') {
          if (!pageableAdded) { pageableAdded = true; return 'Pageable pageRequest'; }
          return null; // drop second of the pair
        }
        return `@Param("${p.name}") ${javaType} ${p.name}`;
      }).filter(Boolean).join(', ');
    } else {
      // derived
      paramsStr = javaParams.map((p) => `${p.javaType} ${p.name}`).join(', ');
    }

    const query = needsQuery ? buildJpqlQuery(m, jpaEntityName, aggregate, bcYaml) : null;

    customMethods.push({
      name: m.name,
      returnType: jpaReturnType,
      paramsStr,
      query,
      _params: javaParams,
    });
  }

  // Auto-inject softDelete for soft-delete aggregates.
  // derivedFrom: implicit causes classifyMethod to skip it, but Spring Data does NOT provide softDelete.
  if (aggregate.softDelete === true && !customMethods.some((m) => m.name === 'softDelete')) {
    customMethods.push({
      name: 'softDelete',
      returnType: 'void',
      paramsStr: '@Param("id") UUID id',
      query: `UPDATE ${jpaEntityName} a SET a.deletedAt = CURRENT_TIMESTAMP WHERE a.id = :id`,
      modifying: true,
      _params: [{ name: 'id', javaType: 'UUID' }],
    });
  }

  const imports = collectJpaRepoImports(customMethods, aggregate, jpaEntityName, bc, packageName, bcYaml);
  return { packageName, bc, aggregateName, jpaEntityName, customMethods, imports };
}

function buildRepoImplContext(aggregateName, normalizedMethods, aggregate, bc, packageName, bcYaml, hasDomainEvents) {
  const jpaEntityName = `${aggregateName}Jpa`;

  const methods = normalizedMethods.map((m) => {
    const returnType = yamlReturnToJava(m.returns);
    const params = (m.params || []).map((p) => ({
      name: p.name,
      javaType: yamlTypeToJava(p.type),
    }));
    const body = buildImplMethodBody(m, returnType, hasDomainEvents);
    return { name: m.name, returnType, params, body };
  });

  const toDomainBody = buildToDomainBody(aggregate, bcYaml);
  const toJpaBody = buildToJpaBody(aggregate, bcYaml);

  const childEntityMappers = (aggregate.entities || []).map((entity) => ({
    entityName: entity.name,
    toDomainBody: buildChildToDomainBody(entity, bcYaml),
    toJpaBody: buildChildToJpaBody(entity, bcYaml),
  }));

  const imports = collectImplImports(aggregateName, aggregate, methods, bc, packageName, bcYaml, hasDomainEvents);

  return {
    packageName,
    bc,
    aggregateName,
    jpaEntityName,
    methods,
    toDomainBody,
    toJpaBody,
    childEntityMappers,
    hasDomainEvents: !!hasDomainEvents,
    imports,
  };
}

// ─── Main generator ───────────────────────────────────────────────────────────

/**
 * Generate repository layer for all aggregates defined in repositories[] section.
 * Output:
 *   {bc}/domain/repository/{Aggregate}Repository.java          — domain port
 *   {bc}/infrastructure/persistence/repositories/{Aggregate}JpaRepository.java
 *   {bc}/infrastructure/persistence/repositories/{Aggregate}RepositoryImpl.java
 */
async function generateRepositories(bcYaml, config, outputDir) {
  const bc = bcYaml.bc;
  const packagePath = toPackagePath(config.packageName);

  for (const repoEntry of bcYaml.repositories || []) {
    const aggregateName = repoEntry.aggregate;

    const aggregate = (bcYaml.aggregates || []).find((a) => a.name === aggregateName);
    if (!aggregate) {
      continue;
    }

    // Normalize methods — attach derivedFrom for classification
    const normalizedMethods = (repoEntry.methods || []).map((m) => {
      const normalized = normalizeMethod(m);
      return { ...normalized, derivedFrom: m.derivedFrom };
    });

    // hasDomainEvents: read models never publish events and must not inject eventPublisher
    const allPublishedEvents = (bcYaml.domainEvents || {}).published || [];
    const hasDomainEvents = !(aggregate.readModel === true) &&
      allPublishedEvents.some((e) => !e.aggregate || e.aggregate === aggregateName);

    // 1. Domain repository interface
    const ifaceContext = buildRepoInterfaceContext(aggregateName, normalizedMethods, bc, config.packageName, bcYaml);
    const ifacePath = path.join(
      outputDir, 'src', 'main', 'java',
      packagePath, bc,
      'domain', 'repository',
      `${aggregateName}Repository.java`
    );
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'infrastructure', 'RepositoryInterface.java.ejs'),
      ifacePath,
      ifaceContext
    );

    // 2. Spring Data JPA repository interface
    const jpaIfaceContext = buildJpaRepoInterfaceContext(aggregateName, normalizedMethods, aggregate, bc, config.packageName, bcYaml);
    const jpaIfacePath = path.join(
      outputDir, 'src', 'main', 'java',
      packagePath, bc,
      'infrastructure', 'persistence', 'repositories',
      `${aggregateName}JpaRepository.java`
    );
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'infrastructure', 'JpaRepositoryInterface.java.ejs'),
      jpaIfacePath,
      jpaIfaceContext
    );

    // 3. Repository implementation (adapter)
    const implContext = buildRepoImplContext(aggregateName, normalizedMethods, aggregate, bc, config.packageName, bcYaml, hasDomainEvents);
    const implPath = path.join(
      outputDir, 'src', 'main', 'java',
      packagePath, bc,
      'infrastructure', 'persistence', 'repositories',
      `${aggregateName}RepositoryImpl.java`
    );
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'infrastructure', 'RepositoryImpl.java.ejs'),
      implPath,
      implContext
    );
  }
}

module.exports = { generateRepositories };
