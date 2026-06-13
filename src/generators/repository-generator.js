'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toSnakeCase, toCamelCase, toPascalCase, pluralizeWord, toPackagePath } = require('../utils/naming');
const { mapType, isListType, getListElementType } = require('../utils/type-mapper');

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

function isStoredObjectType(type) {
  return type === 'StoredObject';
}

/**
 * Mapper fragments for a StoredObject property. The domain holds the shared
 * StoredObject record (storageKey, url:URI, contentType, sizeBytes); the JPA
 * entity holds four expanded columns ({name}StorageKey/Url/ContentType/SizeBytes).
 * All accesses are null-safe because a StoredObject property is often optional
 * (e.g. an image attached later).
 */
function storedObjectToDomainExpr(prop) {
  const p = capitalize(prop.name);
  return `new StoredObject(jpa.get${p}StorageKey(), jpa.get${p}Url() != null ? java.net.URI.create(jpa.get${p}Url()) : null, jpa.get${p}ContentType(), jpa.get${p}SizeBytes())`;
}
function storedObjectToJpaLines(prop) {
  const p = capitalize(prop.name);
  const g = `domain.get${p}()`;
  return [
    `        .${prop.name}StorageKey(${g} != null ? ${g}.storageKey() : null)`,
    `        .${prop.name}Url(${g} != null && ${g}.url() != null ? ${g}.url().toString() : null)`,
    `        .${prop.name}ContentType(${g} != null ? ${g}.contentType() : null)`,
    `        .${prop.name}SizeBytes(${g} != null ? ${g}.sizeBytes() : null)`,
  ];
}

function isUrlType(type) {
  return type === 'Url';
}

/**
 * Mapper fragments for a Url property: the domain holds java.net.URI, the JPA
 * column is a String (see jpa-entity-generator.jpaFieldJavaType). These bridge
 * the two so Hibernate stores text instead of a binary-serialized URI.
 */
function urlToDomainExpr(prop) {
  const getter = `jpa.get${capitalize(prop.name)}()`;
  // Optional Url → null-safe; required → unconditional (URI.create(null) would NPE).
  return prop.required === false
    ? `${getter} != null ? java.net.URI.create(${getter}) : null`
    : `java.net.URI.create(${getter})`;
}
function urlToJpaExpr(prop) {
  const getter = `domain.get${capitalize(prop.name)}()`;
  return `${getter} != null ? ${getter}.toString() : null`;
}

function isVoType(type, bcYaml) {
  if (type === 'Money') return false;
  return (bcYaml.valueObjects || []).some((vo) => vo.name === type);
}

function isProjectionType(type, bcYaml) {
  return (bcYaml && bcYaml.projections || []).some((p) => p.name === type);
}

function getWrappedReturnInner(returnType) {
  const match = returnType && returnType.match(/^(?:Optional|Page|List|Slice|Stream)<(.+)>$/);
  return match ? match[1] : null;
}

function isProjectionReturnType(returnType, bcYaml) {
  const inner = getWrappedReturnInner(returnType) || returnType;
  return isProjectionType(inner, bcYaml);
}

// [G8] Returns true when any query UC targeting this aggregate declares a
// Range[T] or SearchText input — meaning the JPA repository must extend
// JpaSpecificationExecutor to expose findAll(Specification, Pageable).
const SPECS_FILTER_RE = /^Range\[.+\]$/;
function aggregateHasSpecsFilter(aggregateName, bcYaml) {
  for (const uc of bcYaml.useCases || []) {
    if (uc.type !== 'query' || uc.aggregate !== aggregateName) continue;
    for (const inp of uc.input || []) {
      if (SPECS_FILTER_RE.test(inp.type) || inp.type === 'SearchText') return true;
    }
  }
  return false;
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
  // R15: Boolean / Long / canonical primitives mapped explicitly so existsBy*
  // / countBy* methods emit boolean / long instead of leaking the YAML token.
  if (returns === 'Boolean') return 'boolean';
  if (returns === 'Long') return 'long';
  const optionalMatch = returns.match(/^(.+)\?$/);
  if (optionalMatch) return `Optional<${optionalMatch[1]}>`;
  const pageMatch = returns.match(/^Page\[(.+)\]$/);
  if (pageMatch) return `Page<${pageMatch[1]}>`;
  const listMatch = returns.match(/^List\[(.+)\]$/);
  if (listMatch) return `List<${listMatch[1]}>`;
  // R15: opt-in canonical types — Slice for cursor-style pagination without
  // a total count, Stream for incremental processing of large result sets.
  const sliceMatch = returns.match(/^Slice\[(.+)\]$/);
  if (sliceMatch) return `Slice<${sliceMatch[1]}>`;
  const streamMatch = returns.match(/^Stream\[(.+)\]$/);
  if (streamMatch) return `Stream<${streamMatch[1]}>`;
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
 * Resolve the effective operator for a query param. The YAML can declare
 * `operator` explicitly; otherwise we infer the most idiomatic default:
 *   - filterOn with no operator → LIKE_CONTAINS (back-compat with existing search-style params)
 *   - List[T] type              → IN
 *   - anything else             → EQ
 * The dispatcher used by both list and List[T] queries reads this to decide
 * the JPQL fragment to emit. Returning a stable string lets validation in
 * `bc-yaml-reader.validateRepositories` keep the operator whitelist in sync.
 */
function resolveEffectiveOperator(param) {
  if (param.operator) return param.operator;
  if (param.type && /^List\[/.test(param.type)) return 'IN';
  if (param.filterOn && Array.isArray(param.filterOn) && param.filterOn.length > 0) {
    return 'LIKE_CONTAINS';
  }
  return 'EQ';
}

/**
 * Build a single JPQL predicate for a query param. Returned predicate already
 * accounts for the LOWER(...) wrapping (LIKE operators) and IN-list semantics
 * (`p.name IN :p.name` vs `p.field IN :p.name`). Caller decides whether to
 * wrap the predicate with `(:name IS NULL OR ...)` for optional params.
 *
 * Centralising this dispatcher keeps `buildListQuery` and the List[T] branch
 * of `buildJpqlQuery` consistent: a `LIKE_CONTAINS` filter behaves the same
 * way regardless of whether the return type is `Page[T]` or `List[T]`.
 */
function buildParamPredicate(param, alias) {
  const op = resolveEffectiveOperator(param);
  const a = alias;
  const pn = param.name;
  const fields = (param.filterOn && param.filterOn.length > 0)
    ? param.filterOn
    : [pn];

  switch (op) {
    case 'EQ':
      return fields.map((f) => `${a}.${f} = :${pn}`).join(' OR ');
    case 'GTE':
      return fields.map((f) => `${a}.${f} >= :${pn}`).join(' OR ');
    case 'LTE':
      return fields.map((f) => `${a}.${f} <= :${pn}`).join(' OR ');
    // The LIKE parameter is wrapped in CAST(:p AS string) so PostgreSQL can infer
    // a type for the bind even when the value is null (optional filters). Without
    // the cast, a null param inside CONCAT defaults to bytea and Hibernate's
    // LOWER(...) fails ("function lower(bytea) does not exist"). The cast is a
    // no-op for non-null strings. Field-side casting stays in jpqlLikeFieldExpression.
    case 'LIKE_CONTAINS':
      return fields
        .map((f) => `LOWER(${jpqlLikeFieldExpression(param, a, f)}) LIKE LOWER(CONCAT('%', CAST(:${pn} AS string), '%'))`)
        .join(' OR ');
    case 'LIKE_STARTS':
      return fields
        .map((f) => `LOWER(${jpqlLikeFieldExpression(param, a, f)}) LIKE LOWER(CONCAT(CAST(:${pn} AS string), '%'))`)
        .join(' OR ');
    case 'LIKE_ENDS':
      return fields
        .map((f) => `LOWER(${jpqlLikeFieldExpression(param, a, f)}) LIKE LOWER(CONCAT('%', CAST(:${pn} AS string)))`)
        .join(' OR ');
    case 'IN': {
      // For IN we expect a single field, derived either from filterOn or by
      // de-pluralising the param name (e.g. `categoryIds` → `categoryId`).
      const target = (param.filterOn && param.filterOn[0])
        || (pn.endsWith('s') ? pn.slice(0, -1) : pn);
      return `${a}.${target} IN :${pn}`;
    }
    default:
      throw new Error(
        `[repository-generator] Unsupported operator "${op}" on param "${pn}". ` +
        `Allowed: EQ, GTE, LTE, LIKE_CONTAINS, LIKE_STARTS, LIKE_ENDS, IN.`
      );
  }
}

/**
 * Build the trailing ORDER BY clause for a method, sourced from the YAML
 * declaration `defaultSort: { field, direction }`. Only applied to List[T]
 * returns: for Page[T] the caller's `Pageable.sort` drives ordering and a
 * static ORDER BY would be silently overridden by Spring Data.
 *
 * Direction defaults to ASC when omitted; field validation (existence in the
 * aggregate) lives in `bc-yaml-reader.validateRepositories`, so by the time we
 * reach here the field is guaranteed to be a valid column on the JPA entity.
 */
function buildOrderByClause(method, alias) {
  const ds = method && method.defaultSort;
  if (!ds || !ds.field) return '';
  const dir = (ds.direction || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  return ` ORDER BY ${alias}.${ds.field} ${dir}`;
}

/**
 * Build the JPQL query for a "list" method (optional-filter + pagination).
 * entityAlias — single-letter alias; jpaEntityName — "ProductJpa"; optional params
 */
function buildListQuery(jpaEntityName, optionalParams, requiredFilterParams, alias, extraConditions = []) {
  const a = alias || jpaEntityName.charAt(0).toLowerCase();
  const reqConditions = (requiredFilterParams || []).map((p) => {
    const pred = buildParamPredicate(p, a);
    // If the predicate is a disjunction (filterOn with multiple fields), wrap it.
    return pred.includes(' OR ') ? `(${pred})` : pred;
  });
  const optConditions = (optionalParams || []).map((p) => {
    const pred = buildParamPredicate(p, a);
    const wrapped = pred.includes(' OR ') ? `(${pred})` : pred;
    return `(:${p.name} IS NULL OR ${wrapped})`;
  });
  const allConditions = [...(extraConditions || []), ...reqConditions, ...optConditions];
  const where = allConditions.length > 0 ? ` WHERE ${allConditions.join(' AND ')}` : '';
  return `SELECT ${a} FROM ${jpaEntityName} ${a}${where}`;
}

function resolveSearchQualifierConditions(methodName, aggregate, bcYaml, alias) {
  const match = methodName.match(/^search(?!By)([A-Z][a-zA-Z]*)$/);
  if (!match) return [];
  const qualifier = match[1];
  if (qualifier === 'All') return [];
  return resolveCountQualifier(qualifier, aggregate, bcYaml, alias, methodName);
}

function normalizeQueryParamForAggregate(param, aggregate) {
  if (!param || !aggregate || param.filterOn) return param;
  const aggregateIdsName = `${toCamelCase(aggregate.name)}Ids`;
  if (param.name === aggregateIdsName && /^List\[Uuid\]$/.test(param.type || '')) {
    return { ...param, filterOn: ['id'] };
  }
  return param;
}

function enrichFilterParamFieldTypes(param, aggregate) {
  if (!param || !aggregate) return param;
  const fields = (param.filterOn && param.filterOn.length > 0) ? param.filterOn : [param.name];
  const fieldTypes = {};
  for (const field of fields) {
    const prop = (aggregate.properties || []).find((p) => p.name === field);
    if (prop && prop.type) fieldTypes[field] = prop.type;
  }
  return Object.keys(fieldTypes).length > 0 ? { ...param, filterFieldTypes: fieldTypes } : param;
}

function jpqlLikeFieldExpression(param, alias, field) {
  const type = param && param.filterFieldTypes ? param.filterFieldTypes[field] : null;
  const expr = `${alias}.${field}`;
  if (!type || type === 'String' || type === 'Text' || type === 'Email' || /^String\(/.test(type)) return expr;
  return `CAST(${expr} AS string)`;
}

/**
 * Resolve a count-method qualifier (e.g. "Active", "NonDeleted") against a target aggregate.
 * Returns the list of JPQL conditions to AND into the WHERE clause.
 * Throws if the qualifier cannot be mapped — the generator does NOT invent literals.
 */
function resolveCountQualifier(qualifier, targetAggregate, bcYaml, alias, methodName) {
  // 1. Soft-delete vocabulary
  if (qualifier === 'NonDeleted' || qualifier === 'NotDeleted') {
    if (targetAggregate.softDelete === true) {
      return [`${alias}.deletedAt IS NULL`];
    }
    // Try DELETED enum literal as a fallback if the target has a status enum with that value.
    const statusInfo = findStatusEnum(targetAggregate, bcYaml);
    if (statusInfo && statusInfo.values.includes('DELETED')) {
      return [`${alias}.${statusInfo.field} <> '${statusInfo.values.find((v) => v === 'DELETED')}'`];
    }
    throw new Error(
      `[repository-generator] Qualifier 'NonDeleted' on count method '${methodName}' targets aggregate ` +
      `'${targetAggregate.name}' which is neither softDelete:true nor declares a status enum with a 'DELETED' value. ` +
      `Either enable softDelete on the aggregate, add a 'DELETED' enum value, or rename the method.`
    );
  }
  if (qualifier === 'Deleted') {
    if (targetAggregate.softDelete === true) {
      return [`${alias}.deletedAt IS NOT NULL`];
    }
    const statusInfo = findStatusEnum(targetAggregate, bcYaml);
    if (statusInfo && statusInfo.values.includes('DELETED')) {
      return [`${alias}.${statusInfo.field} = 'DELETED'`];
    }
    throw new Error(
      `[repository-generator] Qualifier 'Deleted' on count method '${methodName}' targets aggregate ` +
      `'${targetAggregate.name}' which is neither softDelete:true nor declares a status enum with a 'DELETED' value.`
    );
  }

  // 2. Status-enum literal lookup
  const statusInfo = findStatusEnum(targetAggregate, bcYaml);
  if (statusInfo) {
    const upper = qualifier.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
    if (statusInfo.values.includes(upper)) {
      return [`${alias}.${statusInfo.field} = '${upper}'`];
    }
    // Negated form: Non{Literal} → status <> 'LITERAL'
    if (qualifier.startsWith('Non')) {
      const inner = qualifier.slice(3);
      const innerUpper = inner.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
      if (statusInfo.values.includes(innerUpper)) {
        return [`${alias}.${statusInfo.field} <> '${innerUpper}'`];
      }
    }
  }

  // 3. Unknown qualifier — stop rather than invent.
  const known = statusInfo ? statusInfo.values.join(', ') : '(none — target has no status enum)';
  throw new Error(
    `[repository-generator] Unknown qualifier '${qualifier}' in count method '${methodName}' for aggregate ` +
    `'${targetAggregate.name}'. Recognised qualifiers: NonDeleted, Deleted, or any literal of the target's ` +
    `status enum [${known}]. Rename the method or extend the enum.`
  );
}

/**
 * Find the status-enum field on an aggregate. Returns { field, enumName, values } or null.
 */
function findStatusEnum(aggregate, bcYaml) {
  const statusProp = (aggregate.properties || []).find(
    (p) => p.name === 'status' || (p.type && p.type.endsWith('Status'))
  );
  if (!statusProp) return null;
  const enumDef = (bcYaml.enums || []).find((e) => e.name === statusProp.type);
  if (!enumDef) return null;
  const values = (enumDef.values || []).map((v) => (typeof v === 'string' ? v : v.value));
  return { field: statusProp.name, enumName: enumDef.name, values };
}

function statusQualifierMatches(qualifier, aggregate, bcYaml) {
  if (!aggregate) return false;
  if ((qualifier === 'NonDeleted' || qualifier === 'NotDeleted' || qualifier === 'Deleted') && aggregate.softDelete === true) {
    return true;
  }
  const statusInfo = findStatusEnum(aggregate, bcYaml);
  if (!statusInfo) return false;
  if ((qualifier === 'NonDeleted' || qualifier === 'NotDeleted' || qualifier === 'Deleted') && statusInfo.values.includes('DELETED')) {
    return true;
  }
  const upper = qualifier.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
  if (statusInfo.values.includes(upper)) return true;
  if (qualifier.startsWith('Non')) {
    const innerUpper = qualifier.slice(3).replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
    return statusInfo.values.includes(innerUpper);
  }
  return false;
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
  //    Resolves the qualifier against a strict vocabulary. The generator does NOT invent
  //    enum literals — unrecognised qualifiers stop generation with a precise error.
  if (!aggregate) {
    let resolvedTarget = null;
    let qualifier = null;
    for (const agg of (bcYaml.aggregates || [])) {
      const plural = pluralizeWord(agg.name);
      if (entityPlural.endsWith(plural) && entityPlural.length > plural.length) {
        resolvedTarget = agg;
        qualifier = entityPlural.slice(0, entityPlural.length - plural.length);
        break;
      }
    }

    if (resolvedTarget && qualifier) {
      aggregate = resolvedTarget;
      const a = `${resolvedTarget.name}Jpa`.charAt(0).toLowerCase();
      extraConditions.push(
        ...resolveCountQualifier(qualifier, resolvedTarget, bcYaml, a, methodName)
      );
    }
  }

  // If no aggregate matched, the qualifier-only form is valid only when the
  // current aggregate is the implicit target (e.g. countNonDeletedByCategoryId on
  // ProductRepository → target=Product, qualifier=NonDeleted).
  if (!aggregate && currentAggregate) {
    aggregate = currentAggregate;
    const a = `${currentAggregate.name}Jpa`.charAt(0).toLowerCase();
    extraConditions.push(
      ...resolveCountQualifier(entityPlural, currentAggregate, bcYaml, a, methodName)
    );
  }

  // If no aggregate matched, the method name is structurally invalid for a count query.
  // Per AGENTS.md, the generator must stop rather than invent a literal.
  if (!aggregate) {
    throw new Error(
      `[repository-generator] Cannot resolve target aggregate for count method '${methodName}'. ` +
      `Method name must follow 'count{Qualifier}{AggregatePlural}By{Field}' where {AggregatePlural} ` +
      `is the plural of an aggregate defined in the BC YAML.`
    );
  }
  const jpaName = `${aggregate.name}Jpa`;
  const a = jpaName.charAt(0).toLowerCase();

  // extraConditions are already alias-prefixed by resolveCountQualifier; params are not.
  const conditions = [
    ...extraConditions,
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
  if (!fieldsMatch) {
    throw new Error(`[repository-generator] Cannot build search query for method '${methodName}'. Supported forms: searchBy{Field}Or{Field}, searchAll, or search{StatusQualifier}.`);
  }

  const fieldNames = fieldsMatch[1]
    .split('Or')
    .map((f) => f.charAt(0).toLowerCase() + f.slice(1));

  const aggregateFields = new Set((aggregate.properties || []).map((p) => p.name));
  for (const field of fieldNames) {
    if (!aggregateFields.has(field)) {
      throw new Error(`[repository-generator] Cannot build search query '${methodName}': field '${field}' is not a property of aggregate '${aggregate.name}'.`);
    }
  }

  // CAST(:query AS string) — see buildParamPredicate: gives PostgreSQL a type for
  // the bind so a null param inside CONCAT does not collapse to bytea.
  const conditions = fieldNames.map((f) => `LOWER(${a}.${f}) LIKE LOWER(CONCAT('%', CAST(:query AS string), '%'))`);
  return `SELECT ${a} FROM ${jpaEntityName} ${a} WHERE ${conditions.join(' OR ')}`;
}

/**
 * Determine if a method should appear in the Spring Data JPA interface.
 * Returns: 'skip' | 'derived' | 'custom'
 */
function classifyMethod(method) {
  if (method.derivedFrom === 'implicit') {
    // findBy[A-Z]* methods (except findById) are Spring Data derived queries —
    // they are NOT inherited from JpaRepository and MUST be declared in the JPA
    // interface even when tagged derivedFrom: implicit. Let them fall through to
    // the normal derived/custom classification below.
    if (/^findBy[A-Z]/.test(method.name) && method.name !== 'findById') {
      // fall through
    } else if (/^find(?!By)[A-Z][A-Za-z0-9]*By[A-Z][A-Za-z0-9]*$/.test(method.name)) {
      // fall through
    } else {
      return 'skip';
    }
  }
  if (method.name === 'findById' || method.name === 'save' || method.name === 'upsert') return 'skip';
  // 'delete(id)' is inherited from JpaRepository as deleteById — do not redeclare
  if (method.name === 'delete' && (method.params || []).length === 1) return 'skip';
  // R11: bulk operations are inherited verbatim from JpaRepository.
  if (method.name === 'saveAll' || method.name === 'findAllById') return 'skip';
  if (method.name === 'count' && (!method.params || method.params.length === 0)) return 'skip';

  // Spring Data derived: findByXxx[AndYyy...] — Spring Data resolves the query from
  // the method name when the number of non-pageable params equals the number of
  // And/Or-separated segments after "findBy". Page returns are also derivable as
  // long as the last param is Pageable.
  if (/^findBy[A-Z]/.test(method.name)) {
    const nonPageable = (method.params || []).filter((p) => p.type !== 'PageRequest' && p.name !== 'pageable');
    if (nonPageable.some((p) => /^List\[/.test(p.type || ''))) return 'custom';
    const tokens = method.name.replace(/^findBy/, '').split(/And|Or/).filter(Boolean);
    const isPageReturn = method.returns && method.returns.startsWith('Page[');
    // Page return needs an explicit PageRequest/pageable param the YAML must declare;
    // when present, Spring Data still derives the query.
    if (isPageReturn) {
      const hasPageable = (method.params || []).some((p) => p.type === 'PageRequest' || p.name === 'pageable');
      if (hasPageable && nonPageable.length === tokens.length) return 'derived';
      return 'custom';
    }
    if (nonPageable.length === tokens.length && tokens.length >= 1) return 'derived';
  }

  // Spring Data derived: countByXxx — Spring Data derives count queries from method name
  if (/^countBy[A-Z]/.test(method.name)) {
    return 'derived';
  }

  // R7: Spring Data derived: existsByXxx — boolean existence check.
  if (/^existsBy[A-Z]/.test(method.name)) {
    return 'derived';
  }

  // R10: deleteByXxx — needs a custom @Modifying @Query, NOT Spring Data
  // derivation, because the generator must emit the @Modifying / @Transactional
  // annotations explicitly on the JPA interface.
  if (/^deleteBy[A-Z]/.test(method.name) && method.name !== 'deleteById') {
    return 'custom';
  }

  // R13: findByIdForUpdate — convention for pessimistic locking. The JPA
  // method is still derivable by Spring Data (findById*), but the generator
  // emits an explicit @Query so that @Lock can be attached unambiguously.
  if (method.name === 'findByIdForUpdate') {
    return 'custom';
  }

  return 'custom';
}

/**
 * Build the @Query string for a custom JPA repository method.
 */
function buildJpqlQuery(method, jpaEntityName, aggregate, bcYaml) {
  const { name, params, returns } = method;

  // R13: pessimistic-lock variant of findById. Spring Data exposes the @Lock
  // annotation only on @Query-annotated methods, so we emit the JPQL by hand.
  if (name === 'findByIdForUpdate') {
    const a = jpaEntityName.charAt(0).toLowerCase();
    return `SELECT ${a} FROM ${jpaEntityName} ${a} WHERE ${a}.id = :id`;
  }

  // R10: deleteBy{Field} — emit a JPQL DELETE so the @Modifying annotation
  // can be attached. The single param targets the field encoded in the name.
  if (/^deleteBy[A-Z]/.test(name) && name !== 'deleteById') {
    const fieldRaw = name.replace(/^deleteBy/, '');
    const field = fieldRaw.charAt(0).toLowerCase() + fieldRaw.slice(1);
    const a = jpaEntityName.charAt(0).toLowerCase();
    const paramName = (params && params[0] && params[0].name) || field;
    return `DELETE FROM ${jpaEntityName} ${a} WHERE ${a}.${field} = :${paramName}`;
  }

  const existsQualifiedMatch = name.match(/^exists(.+)By([A-Z][a-zA-Z]*)$/);
  if ((returns === 'Boolean' || returns === 'boolean') && existsQualifiedMatch && !name.startsWith('existsBy')) {
    const [, qualifier, fieldRaw] = existsQualifiedMatch;
    const a = jpaEntityName.charAt(0).toLowerCase();
    const field = fieldRaw.charAt(0).toLowerCase() + fieldRaw.slice(1);
    const paramName = (params && params[0] && params[0].name) || field;
    const qualifierConditions = resolveCountQualifier(qualifier, aggregate, bcYaml, a, name);
    const conditions = [...qualifierConditions, `${a}.${field} = :${paramName}`];
    return `SELECT CASE WHEN COUNT(${a}) > 0 THEN true ELSE false END FROM ${jpaEntityName} ${a} WHERE ${conditions.join(' AND ')}`;
  }

  const findQualifiedMatch = name.match(/^find(?!By)([A-Z][A-Za-z0-9]*)By([A-Z][A-Za-z0-9]*)$/);
  if (findQualifiedMatch && statusQualifierMatches(findQualifiedMatch[1], aggregate, bcYaml)) {
    const [, qualifier, fieldRaw] = findQualifiedMatch;
    const a = jpaEntityName.charAt(0).toLowerCase();
    const field = fieldRaw.charAt(0).toLowerCase() + fieldRaw.slice(1);
    const paramName = (params && params[0] && params[0].name) || field;
    const qualifierConditions = resolveCountQualifier(qualifier, aggregate, bcYaml, a, name);
    const conditions = [...qualifierConditions, `${a}.${field} = :${paramName}`];
    return `SELECT ${a} FROM ${jpaEntityName} ${a} WHERE ${conditions.join(' AND ')}`;
  }

  if (returns && (returns.startsWith('Page[') || returns.startsWith('Slice[') || returns.startsWith('Stream['))) {
    // list or search — Slice and Stream follow identical JPQL rules to Page
    if (/^searchBy/.test(name)) {
      return buildSearchQuery(name, jpaEntityName, aggregate);
    }
    // page/size Integer params are pagination — exclude from JPQL conditions
    const isPaginationParam = (p) =>
      p.type === 'PageRequest' || p.name === 'pageable' ||
      ((p.name === 'page' || p.name === 'size') && p.type === 'Integer');
    const queryParams = (params || [])
      .map((p) => normalizeQueryParamForAggregate(p, aggregate))
      .map((p) => enrichFilterParamFieldTypes(p, aggregate));
    const requiredFilterParams = queryParams.filter((p) => !isPaginationParam(p) && p.required !== false);
    const optionalParams = queryParams.filter((p) => !isPaginationParam(p) && p.required === false);
    const alias = jpaEntityName.charAt(0).toLowerCase();
    const qualifierConditions = resolveSearchQualifierConditions(name, aggregate, bcYaml, alias);
    return buildListQuery(jpaEntityName, optionalParams, requiredFilterParams, alias, qualifierConditions);
  }

  if (returns === 'Int' || returns === 'Integer' || returns === 'Long' || returns === 'long') {
    return buildCountQuery(name, params || [], bcYaml, jpaEntityName, aggregate);
  }

  if (returns && returns.startsWith('List[')) {
    const a = jpaEntityName.charAt(0).toLowerCase();
    const filterParams = (params || [])
      .map((p) => normalizeQueryParamForAggregate(p, aggregate))
      .map((p) => enrichFilterParamFieldTypes(p, aggregate))
      .filter((p) => p.type !== 'PageRequest' && p.name !== 'pageable');

    // Detect {subEntityName}Ids params — the IDs belong to a sub-entity, not a
    // field on the aggregate root. Require a JOIN to navigate to the collection.
    // E.g. variantIds → SELECT p FROM ProductJpa p JOIN p.productVariants v WHERE v.id IN :variantIds
    const subEntityIdsParam = filterParams.find((p) => {
      if (!p.name.endsWith('Ids')) return false;
      const entitySuffix = p.name.slice(0, -3).toLowerCase(); // "variant" from "variantIds"
      return (aggregate.entities || []).some(
        (e) => e.name.toLowerCase() === entitySuffix || e.name.toLowerCase().endsWith(entitySuffix)
      );
    });
    if (subEntityIdsParam) {
      const entitySuffix = subEntityIdsParam.name.slice(0, -3).toLowerCase();
      const matchedEntity = (aggregate.entities || []).find(
        (e) => e.name.toLowerCase() === entitySuffix || e.name.toLowerCase().endsWith(entitySuffix)
      );
      const isOneToOne = matchedEntity.cardinality === 'oneToOne';
      const collectionField = isOneToOne
        ? toCamelCase(matchedEntity.name)
        : toCamelCase(pluralizeWord(matchedEntity.name));
      const vChar = matchedEntity.name.charAt(0).toLowerCase();
      const v = vChar !== a ? vChar : `${vChar}2`;
      // Remaining params (non-sub-entity-id) add standard WHERE conditions on the root
      const otherParams = filterParams.filter((p) => p !== subEntityIdsParam);
      const otherConds = otherParams.map((p) => {
        const pred = buildParamPredicate(p, a);
        return pred.includes(' OR ') ? `(${pred})` : pred;
      });
      const joinCond = `${v}.id IN :${subEntityIdsParam.name}`;
      const allConds = [joinCond, ...otherConds];
      const orderBy = buildOrderByClause(method, a);
      return `SELECT ${a} FROM ${jpaEntityName} ${a} JOIN ${a}.${collectionField} ${v} WHERE ${allConds.join(' AND ')}${orderBy}`;
    }

    // Reuse the same operator dispatcher used by Page[T] queries so a YAML
    // declaring `operator: GTE` produces consistent SQL regardless of whether
    // the return type is List or Page.
    const required = filterParams.filter((p) => p.required !== false);
    const optional = filterParams.filter((p) => p.required === false);
    const reqConds = required.map((p) => {
      const pred = buildParamPredicate(p, a);
      return pred.includes(' OR ') ? `(${pred})` : pred;
    });
    const optConds = optional.map((p) => {
      const pred = buildParamPredicate(p, a);
      const wrapped = pred.includes(' OR ') ? `(${pred})` : pred;
      return `(:${p.name} IS NULL OR ${wrapped})`;
    });
    const allConds = [...reqConds, ...optConds];
    const where = allConds.length > 0 ? ` WHERE ${allConds.join(' AND ')}` : '';
    const orderBy = buildOrderByClause(method, a);
    return `SELECT ${a} FROM ${jpaEntityName} ${a}${where}${orderBy}`;
  }

  // find{EntityName}By{Field} — the field lives on a sub-entity, not the aggregate root.
  // Spring Data cannot derive this from the method name; emit an explicit JOIN query.
  // E.g. findVariantBySku → SELECT p FROM ProductJpa p JOIN p.productVariants v WHERE v.sku = :sku
  const subEntityMatch = /^find([A-Z][a-zA-Z]*)By([A-Z][a-zA-Z]*)$/.exec(name);
  if (subEntityMatch) {
    const entityNameSuffix = subEntityMatch[1]; // e.g. "Variant"
    const fieldCap = subEntityMatch[2];          // e.g. "Sku"
    const field = fieldCap.charAt(0).toLowerCase() + fieldCap.slice(1); // "sku"
    const matchedEntity = (aggregate.entities || []).find(
      (e) => e.name === entityNameSuffix || e.name.endsWith(entityNameSuffix)
    );
    if (matchedEntity) {
      const isOneToOne = matchedEntity.cardinality === 'oneToOne';
      const collectionField = isOneToOne
        ? toCamelCase(matchedEntity.name)
        : toCamelCase(pluralizeWord(matchedEntity.name));
      const a = jpaEntityName.charAt(0).toLowerCase();
      // Use the entity-name suffix (e.g. "Variant") for the JOIN alias to avoid
      // collision when the sub-entity's full name starts with the same letter as
      // the aggregate (e.g. ProductVariant → alias "v", not "p").
      const vChar = entityNameSuffix.charAt(0).toLowerCase();
      const v = vChar !== a ? vChar : `${vChar}2`;
      const paramName = (params && params[0] && params[0].name) || field;
      return `SELECT ${a} FROM ${jpaEntityName} ${a} JOIN ${a}.${collectionField} ${v} WHERE ${v}.${field} = :${paramName}`;
    }
    // Qualifier is the aggregate root itself (e.g. findItemByName on Item aggregate).
    // Emit a simple field equality lookup on the root entity.
    if (aggregate && entityNameSuffix === aggregate.name) {
      const a = jpaEntityName.charAt(0).toLowerCase();
      const paramName = (params && params[0] && params[0].name) || field;
      return `SELECT ${a} FROM ${jpaEntityName} ${a} WHERE ${a}.${field} = :${paramName}`;
    }
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

function collectRepoInterfaceImports(methods, aggregateName, bc, packageName, bcYaml) {
  const imports = new Set();
  const voNames = new Set((bcYaml && bcYaml.valueObjects || []).map((v) => v.name));
  let hasOptional = false;
  let hasPage = false;
  let hasPageable = false;
  let hasSlice = false;
  let hasStream = false;

  // Scalar types that may appear as inner type of Optional/List/Page/Slice/Stream
  // and do NOT live in domain.aggregate — they need their own import.
  const SCALAR_IMPORTS = {
    UUID: 'java.util.UUID',
    BigDecimal: 'java.math.BigDecimal',
    Instant: 'java.time.Instant',
    LocalDate: 'java.time.LocalDate',
    URI: 'java.net.URI',
  };

  for (const method of methods) {
    const rt = method.returnType;
    if (rt.startsWith('Optional<')) hasOptional = true;
    if (rt.startsWith('Page<')) { hasPage = true; hasPageable = true; }
    if (rt.startsWith('Slice<')) { hasSlice = true; hasPageable = true; }
    if (rt.startsWith('Stream<')) hasStream = true;
    if (rt === 'int' || rt === 'void') { /* primitive */ }
    if (rt === 'UUID') imports.add('java.util.UUID');
    if (rt === 'BigDecimal') imports.add('java.math.BigDecimal');
    if (rt === 'Instant') imports.add('java.time.Instant');
    if (rt === 'LocalDate') imports.add('java.time.LocalDate');
    if (rt === 'URI') imports.add('java.net.URI');

    for (const p of method.params) {
      if (p.javaType === 'Pageable') hasPageable = true;
      if (p.javaType === 'UUID') imports.add('java.util.UUID');
      if (p.javaType.startsWith('List<')) imports.add('java.util.List');
      if (p.javaType === 'BigDecimal') imports.add('java.math.BigDecimal');
      if (p.javaType === 'Instant') imports.add('java.time.Instant');
      if (p.javaType === 'LocalDate') imports.add('java.time.LocalDate');
      if (p.javaType === 'URI') imports.add('java.net.URI');
      // Value object param types need a domain import
      if (voNames.has(p.javaType)) imports.add(`${packageName}.${bc}.domain.valueobject.${p.javaType}`);
      // D4: Use full enum list lookup (not just conventional name suffixes) so that
      // enums named e.g. 'Category' or 'Priority' are imported correctly.
      if (isEnumType(p.javaType, bcYaml)) {
        imports.add(`${packageName}.${bc}.domain.enums.${p.javaType}`);
      }
      // List inner types
      const listMatch = p.javaType.match(/^List<(.+)>$/);
      if (listMatch) {
        const inner = listMatch[1];
        imports.add('java.util.List');
        // D3: scalar types inside List<> need their own import
        if (SCALAR_IMPORTS[inner]) {
          imports.add(SCALAR_IMPORTS[inner]);
        } else if (isEnumType(inner, bcYaml)) {
          imports.add(`${packageName}.${bc}.domain.enums.${inner}`);
        }
      }
    }

    // Return type imports
    if (rt.startsWith('List<')) imports.add('java.util.List');
    // D1/D2: extend wrapper regex to include Slice and Stream so the inner
    // aggregate type is imported and not mistakenly looked up in domain.aggregate
    // when the inner type is a scalar (UUID, BigDecimal, …).
    const aggMatch = rt.match(/^(?:Optional|Page|List|Slice|Stream)<(.+)>$/);
    if (aggMatch) {
      const inner = aggMatch[1];
      if (SCALAR_IMPORTS[inner]) {
        imports.add(SCALAR_IMPORTS[inner]);
      } else if (isProjectionType(inner, bcYaml)) {
        imports.add(`${packageName}.${bc}.application.dtos.${inner}`);
      } else {
        // Aggregate domain class
        imports.add(`${packageName}.${bc}.domain.aggregate.${inner}`);
      }
    } else if (rt === aggregateName) {
      imports.add(`${packageName}.${bc}.domain.aggregate.${rt}`);
    } else if (isProjectionType(rt, bcYaml)) {
      imports.add(`${packageName}.${bc}.application.dtos.${rt}`);
    }
  }

  if (hasOptional) imports.add('java.util.Optional');
  if (hasPage) imports.add('org.springframework.data.domain.Page');
  if (hasSlice) imports.add('org.springframework.data.domain.Slice');
  if (hasStream) imports.add('java.util.stream.Stream');
  if (hasPageable) imports.add('org.springframework.data.domain.Pageable');

  return [...imports].sort();
}

function collectJpaRepoImports(customMethods, aggregate, jpaEntityName, bc, packageName, bcYaml) {
  const imports = new Set();
  imports.add(`${packageName}.${bc}.infrastructure.persistence.entities.${jpaEntityName}`);
  const voNames = new Set((bcYaml && bcYaml.valueObjects || []).map((v) => v.name));

  let hasPage = false;
  let hasPageable = false;
  let hasSlice = false;
  let hasStream = false;

  for (const method of customMethods) {
    if (method.returnType.startsWith('Page<')) { hasPage = true; hasPageable = true; }
    if (method.returnType.startsWith('Slice<')) { hasSlice = true; hasPageable = true; }
    if (method.returnType.startsWith('Stream<')) hasStream = true;
    if (method.returnType.startsWith('List<')) imports.add('java.util.List');

    const returnInner = getWrappedReturnInner(method.returnType) || method.returnType;
    if (isProjectionType(returnInner, bcYaml)) {
      imports.add(`${packageName}.${bc}.application.dtos.${returnInner}`);
    }

    // Parse param types from paramsStr for imports
    const params = method._params || [];
    for (const p of params) {
      // java.util.UUID is hardcoded by the template — do not duplicate it via imports.
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
      if (voNames.has(p.javaType)) imports.add(`${packageName}.${bc}.domain.valueobject.${p.javaType}`);
    }
  }

  if (hasPage) imports.add('org.springframework.data.domain.Page');
  if (hasSlice) imports.add('org.springframework.data.domain.Slice');
  if (hasStream) imports.add('java.util.stream.Stream');
  if (hasPageable) imports.add('org.springframework.data.domain.Pageable');

  // @Modifying methods (e.g. softDelete) require extra imports
  if (customMethods.some((m) => m.modifying)) {
    imports.add('org.springframework.data.jpa.repository.Modifying');
    imports.add('org.springframework.transaction.annotation.Transactional');
  }

  // R13: pessimistic lock annotations require Spring Data's @Lock + JPA's
  // LockModeType enum.
  if (customMethods.some((m) => m.lockMode)) {
    imports.add('org.springframework.data.jpa.repository.Lock');
    imports.add('jakarta.persistence.LockModeType');
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
    if (isStoredObjectType(prop.type)) {
      args.push(storedObjectToDomainExpr(prop));
    } else if (isMoneyType(prop.type)) {
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
    } else if (isListType(prop.type)) {
      const innerType = getListElementType(prop.type);
      const innerVoDef = innerType ? (bcYaml.valueObjects || []).find((vo) => vo.name === innerType) : null;
      if (innerVoDef && (innerVoDef.properties || []).length > 1) {
        // List[MultiPropVO]: map each @Embeddable back to domain VO
        const voArgs = (innerVoDef.properties || []).map((vp) => `e.get${capitalize(vp.name)}()`).join(', ');
        args.push(`jpa.get${capitalize(prop.name)}().stream().map(e -> new ${innerType}(${voArgs})).toList()`);
      } else {
        // List[Scalar] or List[SinglePropVO]: JPA type matches domain type — pass through
        args.push(`jpa.get${capitalize(prop.name)}()`);
      }
    } else if (isUrlType(prop.type)) {
      args.push(urlToDomainExpr(prop));
    } else {
      args.push(`jpa.get${capitalize(prop.name)}()`);
    }
  }

  for (const entity of aggregate.entities || []) {
    const isOneToOne = entity.cardinality === 'oneToOne';
    const fieldName = isOneToOne
      ? toCamelCase(entity.name)
      : toCamelCase(pluralizeWord(entity.name));
    if (isOneToOne) {
      // S6 — oneToOne: single mapping, null-safe
      args.push(`jpa.get${capitalize(fieldName)}() != null ? to${entity.name}Domain(jpa.get${capitalize(fieldName)}()) : null`);
    } else {
      args.push(`jpa.get${capitalize(fieldName)}().stream().map(this::to${entity.name}Domain).toList()`);
    }
  }

  if (aggregate.auditable) {
    args.push('jpa.getCreatedAt()');
    args.push('jpa.getUpdatedAt()');
  }
  if (aggregate.softDelete) {
    args.push('jpa.getDeletedAt()');
  }
  // Optimistic locking: thread the @Version column back into the domain aggregate
  // so the next toJpa()/save() carries the loaded version and Hibernate's guard works.
  if (aggregate.concurrencyControl === 'optimistic') {
    args.push('jpa.getVersion()');
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
    if (isStoredObjectType(prop.type)) {
      lines.push(...storedObjectToJpaLines(prop));
    } else if (isMoneyType(prop.type)) {
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
    } else if (isListType(prop.type)) {
      const innerType = getListElementType(prop.type);
      const innerVoDef = innerType ? (bcYaml.valueObjects || []).find((vo) => vo.name === innerType) : null;
      if (innerVoDef && (innerVoDef.properties || []).length > 1) {
        // List[MultiPropVO]: map each domain VO to @Embeddable
        const builderCalls = (innerVoDef.properties || []).map((vp) => `.${vp.name}(t.get${capitalize(vp.name)}())`).join('');
        lines.push(`        .${prop.name}(domain.get${capitalize(prop.name)}().stream().map(t -> ${innerType}Embeddable.builder()${builderCalls}.build()).collect(java.util.stream.Collectors.toCollection(java.util.ArrayList::new)))`);
      } else {
        // List[Scalar] or List[SinglePropVO]: pass through directly
        lines.push(`        .${prop.name}(domain.get${capitalize(prop.name)}())`);
      }
    } else if (isUrlType(prop.type)) {
      lines.push(`        .${prop.name}(${urlToJpaExpr(prop)})`);
    } else {
      lines.push(`        .${prop.name}(domain.get${capitalize(prop.name)}())`);
    }
  }

  for (const entity of aggregate.entities || []) {
    const isOneToOne = entity.cardinality === 'oneToOne';
    const fieldName = isOneToOne
      ? toCamelCase(entity.name)
      : toCamelCase(pluralizeWord(entity.name));
    if (isOneToOne) {
      // S6 — oneToOne: single mapping, null-safe
      lines.push(`        .${fieldName}(domain.get${capitalize(fieldName)}() != null ? to${entity.name}Jpa(domain.get${capitalize(fieldName)}()) : null)`);
    } else {
      lines.push(`        .${fieldName}(domain.get${capitalize(fieldName)}().stream().map(this::to${entity.name}Jpa).collect(java.util.stream.Collectors.toCollection(java.util.ArrayList::new)))`);
    }
  }

  // Optimistic locking: propagate the loaded @Version so updates run the optimistic
  // guard; null on a freshly-created aggregate → Hibernate assigns 0 on INSERT.
  if (aggregate.concurrencyControl === 'optimistic') {
    lines.push(`        .version(domain.getVersion())`);
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
    if (isStoredObjectType(prop.type)) {
      args.push(storedObjectToDomainExpr(prop));
    } else if (isMoneyType(prop.type)) {
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
    } else if (isUrlType(prop.type)) {
      args.push(urlToDomainExpr(prop));
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
    if (isStoredObjectType(prop.type)) {
      lines.push(...storedObjectToJpaLines(prop));
    } else if (isMoneyType(prop.type)) {
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
    } else if (isUrlType(prop.type)) {
      lines.push(`        .${prop.name}(${urlToJpaExpr(prop)})`);
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
function buildImplMethodBody(normalizedMethod, methodReturnType, hasDomainEvents, aggregateName, bcYaml) {
  const { name, params } = normalizedMethod;
  const paramNames = (params || []).map((p) => p.name).join(', ');
  const entityParam = params[0]?.name || 'entity';

  if (name === 'save' && hasDomainEvents) {
    if (methodReturnType === 'void') {
      return `jpaRepository.save(mapper.toJpa(${entityParam}));\n        ${entityParam}.pullDomainEvents().forEach(eventPublisher::publishEvent);`;
    }
    return `${methodReturnType} saved = mapper.toDomain(jpaRepository.save(mapper.toJpa(${entityParam})));\n        ${entityParam}.pullDomainEvents().forEach(eventPublisher::publishEvent);\n        return saved;`;
  }

  if (name === 'save') {
    if (methodReturnType === 'void') {
      return `jpaRepository.save(mapper.toJpa(${entityParam}));`;
    }
    return `return mapper.toDomain(jpaRepository.save(mapper.toJpa(${entityParam})));`;
  }

  // upsert is semantically equivalent to save for read-model aggregates (no domain events).
  // JpaRepository.save() covers both insert and update via Spring Data merge semantics.
  if (name === 'upsert') {
    if (methodReturnType === 'void') {
      return `jpaRepository.save(mapper.toJpa(${entityParam}));`;
    }
    return `return mapper.toDomain(jpaRepository.save(mapper.toJpa(${entityParam})));`;
  }

  if (name === 'delete') {
    return `jpaRepository.deleteById(${paramNames});`;
  }

  if (name === 'softDelete') {
    // softDelete(id) is implemented as a custom @Modifying @Query on the JPA repo.
    // D5: only emit as a void statement when the method actually returns void;
    // if the domain port declares a non-void return, fall through to the normal
    // Optional / aggregate dispatch below.
    if (methodReturnType === 'void') {
      return `jpaRepository.softDelete(${paramNames});`;
    }
  }

  // R11: bulk operations. JpaRepository inherits these — we only emit the
  // domain port + impl wiring with explicit toJpa/toDomain mapping.
  if (name === 'saveAll') {
    const p = params[0]?.name || 'entities';
    return `return jpaRepository.saveAll(${p}.stream().map(mapper::toJpa).toList())\n                .stream().map(mapper::toDomain).toList();`;
  }
  if (name === 'findAllById') {
    const p = params[0]?.name || 'ids';
    return `return jpaRepository.findAllById(${p}).stream().map(mapper::toDomain).toList();`;
  }
  if (name === 'count' && (!params || params.length === 0)) {
    return `return jpaRepository.count();`;
  }

  if (methodReturnType === 'void') {
    return `jpaRepository.${name}(${paramNames});`;
  }

  if (methodReturnType === 'int' || methodReturnType === 'long') {
    return `return jpaRepository.${name}(${paramNames});`;
  }

  if (methodReturnType.startsWith('Optional<')) {
    if (isProjectionReturnType(methodReturnType, bcYaml)) {
      return `return jpaRepository.${name}(${paramNames});`;
    }
    if (name === 'findById') {
      return `return jpaRepository.findById(${params[0]?.name || 'id'}).map(mapper::toDomain);`;
    }
    return `return jpaRepository.${name}(${paramNames}).map(mapper::toDomain);`;
  }

  if (methodReturnType.startsWith('Page<')) {
    if (isProjectionReturnType(methodReturnType, bcYaml)) {
      return `return jpaRepository.${name}(${paramNames});`;
    }
    // If params include page+size pair, build PageRequest.of(page, size) for JPA call
    const pageParam = (params || []).find((p) => p.name === 'page');
    const sizeParam = (params || []).find((p) => p.name === 'size');
    if (pageParam && sizeParam) {
      const otherParams = (params || []).filter((p) => p.name !== 'page' && p.name !== 'size');
      const otherNames = otherParams.map((p) => p.name).join(', ');
      // S14: when page/size are optional, apply sensible defaults to avoid NPE in PageRequest.of
      const isOptional = pageParam.required === false || sizeParam.required === false;
      if (isOptional) {
        const lines = [];
        lines.push(`int _page = page != null ? page : 0;`);
        lines.push(`        int _size = size != null ? size : 20;`);
        const jpaArgs = otherNames ? `${otherNames}, PageRequest.of(_page, _size)` : 'PageRequest.of(_page, _size)';
        lines.push(`        return jpaRepository.${name}(${jpaArgs}).map(mapper::toDomain);`);
        return lines.join('\n        ');
      }
      const jpaArgs = otherNames ? `${otherNames}, PageRequest.of(page, size)` : 'PageRequest.of(page, size)';
      return `return jpaRepository.${name}(${jpaArgs}).map(mapper::toDomain);`;
    }
    return `return jpaRepository.${name}(${paramNames}).map(mapper::toDomain);`;
  }

  if (methodReturnType.startsWith('List<')) {
    if (isProjectionReturnType(methodReturnType, bcYaml)) {
      return `return jpaRepository.${name}(${paramNames});`;
    }
    return `return jpaRepository.${name}(${paramNames}).stream().map(mapper::toDomain).toList();`;
  }

  // R15: Slice<T> — Spring Data's Slice.map() converts each Jpa entity to domain.
  if (methodReturnType.startsWith('Slice<')) {
    if (isProjectionReturnType(methodReturnType, bcYaml)) {
      return `return jpaRepository.${name}(${paramNames});`;
    }
    return `return jpaRepository.${name}(${paramNames}).map(mapper::toDomain);`;
  }

  // R15: Stream<T> — JPA streams require an open transaction; the class-level
  // @Transactional(readOnly = true) covers read streams.
  if (methodReturnType.startsWith('Stream<')) {
    if (isProjectionReturnType(methodReturnType, bcYaml)) {
      return `return jpaRepository.${name}(${paramNames});`;
    }
    return `return jpaRepository.${name}(${paramNames}).map(mapper::toDomain);`;
  }

  if (methodReturnType === aggregateName) {
    if (name === 'findById') {
      return `return jpaRepository.findById(${params[0]?.name || 'id'}).map(mapper::toDomain).orElse(null);`;
    }
    return `return mapper.toDomain(jpaRepository.${name}(${paramNames}));`;
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
  let hasSlice = false;
  let hasStream = false;

  for (const method of methods) {
    const rt = method.returnType;
    if (rt.startsWith('Optional<')) hasOptional = true;
    if (rt.startsWith('Page<')) { hasPage = true; hasPageable = true; }
    if (rt.startsWith('Slice<')) { hasSlice = true; hasPageable = true; }
    if (rt.startsWith('Stream<')) hasStream = true;
    if (rt.startsWith('List<')) imports.add('java.util.List');

    const returnInner = getWrappedReturnInner(rt) || rt;
    if (isProjectionType(returnInner, bcYaml)) {
      imports.add(`${packageName}.${bc}.application.dtos.${returnInner}`);
    }

    for (const p of method.params) {
      if (p.javaType === 'UUID') imports.add('java.util.UUID');
      if (p.javaType.startsWith('List<')) {
        imports.add('java.util.List');
        const inner = p.javaType.match(/^List<(.+)>$/)?.[1];
        if (inner) {
          // D3: scalar types inside List<> (e.g. List<UUID>) need their own import
          if (inner === 'UUID') imports.add('java.util.UUID');
          else if (inner === 'BigDecimal') imports.add('java.math.BigDecimal');
          else if (inner === 'Instant') imports.add('java.time.Instant');
          else if (inner === 'LocalDate') imports.add('java.time.LocalDate');
          else if (isEnumType(inner, bcYaml)) imports.add(`${packageName}.${bc}.domain.enums.${inner}`);
        }
      }
      if (isEnumType(p.javaType, bcYaml)) {
        imports.add(`${packageName}.${bc}.domain.enums.${p.javaType}`);
      }
      if (p.javaType === 'Pageable') hasPageable = true;
    }
  }

  // PageRequest needed when any Page<>/Slice<> method uses page+size Integer pagination
  let hasPageRequest = false;
  for (const method of methods) {
    if (method.returnType.startsWith('Page<') || method.returnType.startsWith('Slice<')) {
      const hasPageParam = method.params.some((p) => p.name === 'page');
      const hasSizeParam = method.params.some((p) => p.name === 'size');
      if (hasPageParam && hasSizeParam) hasPageRequest = true;
    }
  }

  if (hasOptional) imports.add('java.util.Optional');
  if (hasPage) imports.add('org.springframework.data.domain.Page');
  if (hasSlice) imports.add('org.springframework.data.domain.Slice');
  if (hasStream) imports.add('java.util.stream.Stream');
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

  // StoredObject VO (shared, object storage) — reconstructed in the mappers.
  const hasStoredObjectInAggregate = (aggregate.properties || []).some((p) => isStoredObjectType(p.type));
  const hasStoredObjectInEntities = (aggregate.entities || []).some((e) =>
    (e.properties || []).some((p) => isStoredObjectType(p.type))
  );
  if (hasStoredObjectInAggregate || hasStoredObjectInEntities) {
    imports.add(`${packageName}.shared.domain.valueobject.StoredObject`);
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

  // List[MultiPropVO] — @Embeddable classes referenced in toDomain/toJpa
  for (const prop of allProps) {
    if (!isListType(prop.type)) continue;
    const innerType = getListElementType(prop.type);
    if (!innerType) continue;
    const innerVoDef = (bcYaml.valueObjects || []).find((vo) => vo.name === innerType && (vo.properties || []).length > 1);
    if (innerVoDef) {
      imports.add(`${packageName}.${bc}.domain.valueobject.${innerType}`);
      imports.add(`${packageName}.${bc}.infrastructure.persistence.entities.${innerType}Embeddable`);
    }
  }

  // JpaRepository interface
  imports.add(`${packageName}.${bc}.infrastructure.persistence.repositories.${aggregateName}JpaRepository`);

  // R21: extracted JPA mapper (sibling package).
  imports.add(`${packageName}.${bc}.infrastructure.persistence.mappers.${aggregateName}JpaMapper`);

  // ApplicationEventPublisher (domain events)
  if (hasDomainEvents) {
    imports.add('org.springframework.context.ApplicationEventPublisher');
  }

  // R20: @Transactional on RepositoryImpl class + write methods.
  imports.add('org.springframework.transaction.annotation.Transactional');

  return [...imports].sort();
}

// ─── Main context builders ────────────────────────────────────────────────────

function buildRepoInterfaceContext(aggregateName, normalizedMethods, bc, packageName, bcYaml) {
  const methods = normalizedMethods.map((m) => ({
    name: m.name,
    returnType: yamlReturnToJava(m.returns),
    derivedFrom: m.derivedFrom,
    params: (m.params || []).map((p) => ({
      name: p.name,
      javaType: yamlTypeToJava(p.type),
    })),
  }));

  const imports = collectRepoInterfaceImports(methods, aggregateName, bc, packageName, bcYaml);
  return { packageName, bc, aggregateName, methods, imports };
}

function buildJpaRepoInterfaceContext(aggregateName, normalizedMethods, aggregate, bc, packageName, bcYaml) {
  const jpaEntityName = `${aggregateName}Jpa`;

  const customMethods = [];
  for (const m of normalizedMethods) {
    const classification = classifyMethod({ ...m, aggregateName, derivedFrom: m.derivedFrom });
    if (classification === 'skip') continue;
    // Renamed delete→softDelete is materialized by the auto-inject block below;
    // skip here to avoid emitting a method without @Query.
    if (aggregate.softDelete === true && m.name === 'softDelete' && (m.params || []).length === 1) continue;

    const javaParams = (m.params || []).map((p) => ({
      name: p.name,
      javaType: yamlTypeToJava(p.type),
    }));

    let jpaReturnType = yamlReturnToJava(m.returns)
      .replace(`Optional<${aggregateName}>`, `Optional<${jpaEntityName}>`)
      .replace(`Page<${aggregateName}>`, `Page<${jpaEntityName}>`)
      .replace(`List<${aggregateName}>`, `List<${jpaEntityName}>`)
      .replace(`Slice<${aggregateName}>`, `Slice<${jpaEntityName}>`)
      .replace(`Stream<${aggregateName}>`, `Stream<${jpaEntityName}>`);
    if (jpaReturnType === aggregateName) {
      jpaReturnType = jpaEntityName;
    }

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
    if (needsQuery && (!query || /^\s*\/\//.test(query))) {
      throw new Error(`[repository-generator] Unsupported repository method '${aggregateName}.${m.name}'. The generator could not derive a valid JPQL @Query from the YAML declaration.`);
    }

    // R10: deleteBy{Field} requires @Modifying. R13: findByIdForUpdate needs
    // @Lock(LockModeType.PESSIMISTIC_WRITE). Both flags travel through the
    // template context so the EJS can decide which annotations to render.
    const isModifying = /^deleteBy[A-Z]/.test(m.name) && m.name !== 'deleteById';
    const lockMode = m.name === 'findByIdForUpdate' ? 'PESSIMISTIC_WRITE' : null;

    customMethods.push({
      name: m.name,
      returnType: jpaReturnType,
      paramsStr,
      query,
      derivedFrom: m.derivedFrom,
      modifying: isModifying,
      lockMode,
      _params: javaParams,
    });
  }

  // Auto-inject softDelete for soft-delete aggregates.
  // derivedFrom: implicit causes classifyMethod to skip it, but Spring Data does NOT provide softDelete.
  // R3: refresh updatedAt when the aggregate is auditable (audit listeners are bypassed by @Modifying)
  // and add `AND a.deletedAt IS NULL` to make the query idempotent.
  if (aggregate.softDelete === true && !customMethods.some((m) => m.name === 'softDelete')) {
    const setClause = aggregate.auditable === true
      ? 'a.deletedAt = CURRENT_TIMESTAMP, a.updatedAt = CURRENT_TIMESTAMP'
      : 'a.deletedAt = CURRENT_TIMESTAMP';
    customMethods.push({
      name: 'softDelete',
      returnType: 'void',
      paramsStr: '@Param("id") UUID id',
      query: `UPDATE ${jpaEntityName} a SET ${setClause} WHERE a.id = :id AND a.deletedAt IS NULL`,
      modifying: true,
      _params: [{ name: 'id', javaType: 'UUID' }],
    });
  }

  const hasSpecs = aggregateHasSpecsFilter(aggregateName, bcYaml);
  const rawImports = collectJpaRepoImports(customMethods, aggregate, jpaEntityName, bc, packageName, bcYaml);
  const importsSet = new Set(rawImports);
  if (hasSpecs) importsSet.add('org.springframework.data.jpa.repository.JpaSpecificationExecutor');
  return { packageName, bc, aggregateName, jpaEntityName, customMethods, imports: [...importsSet].sort(), hasSpecs };
}

function buildRepoImplContext(aggregateName, normalizedMethods, aggregate, bc, packageName, bcYaml, hasDomainEvents) {
  const jpaEntityName = `${aggregateName}Jpa`;

  const methods = normalizedMethods.map((m) => {
    const returnType = yamlReturnToJava(m.returns);
    const params = (m.params || []).map((p) => ({
      name: p.name,
      javaType: yamlTypeToJava(p.type),
    }));
    const body = buildImplMethodBody(m, returnType, hasDomainEvents, aggregateName, bcYaml);
    // R20: methods that mutate state must run inside a read-write transaction.
    // The class-level annotation defaults everything to readOnly=true; these
    // methods opt back in to a writable transaction.
    const isWrite = m.name === 'save' || m.name === 'upsert' || m.name === 'delete' || m.name === 'softDelete'
      || /^delete[A-Z]/.test(m.name) || /^save[A-Z]/.test(m.name);
    return { name: m.name, returnType, params, body, isWrite };
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
    // queryMethods (list/page queries) + methods (findBy, save, delete, etc.) are both valid repo methods
    const allMethods = [...(repoEntry.queryMethods || []), ...(repoEntry.methods || [])];
    const normalizedMethods = allMethods.map((m) => {
      const normalized = normalizeMethod(m);
      // Auto-inject the aggregate as the first param for save/upsert when the YAML
      // omits params (a common shorthand: "name: save, returns: void, derivedFrom: implicit").
      // Without this, the domain port interface generates void save() with no arguments.
      if ((normalized.name === 'save' || normalized.name === 'upsert') && (!normalized.params || normalized.params.length === 0)) {
        const paramName = aggregateName.charAt(0).toLowerCase() + aggregateName.slice(1);
        normalized.params = [{ name: paramName, type: aggregateName, required: true }];
      }
      // Auto-infer params and return type for findByXxx shorthand (e.g. "name: findByAddressId"
      // with no params declared). Mirrors the same convention as save/upsert above.
      if (/^findBy[A-Z]/.test(normalized.name) && (!normalized.params || normalized.params.length === 0)) {
        const tokens = normalized.name.replace(/^findBy/, '').split(/And|Or/).filter(Boolean);
        const aggregatePropByName = new Map((aggregate.properties || []).map((p) => [p.name, p]));
        normalized.params = tokens.map((token) => {
          const fieldName = token.charAt(0).toLowerCase() + token.slice(1);
          const prop = aggregatePropByName.get(fieldName);
          return { name: fieldName, type: prop ? prop.type : 'Uuid', required: true };
        });
      }
      if (/^findBy[A-Z]/.test(normalized.name) && (!normalized.returns || normalized.returns === 'void')) {
        normalized.returns = `${aggregateName}?`;
      }
      return { ...normalized, derivedFrom: m.derivedFrom, defaultSort: m.defaultSort };
    });

    // Soft-delete rename: when the aggregate uses softDelete, the YAML 'delete(id)'
    // method must materialize as 'softDelete(id)' on the domain port and impl.
    // The Spring Data JpaRepository interface still inherits hard deleteById, but it is
    // never invoked from the domain layer because the port no longer exposes 'delete'.
    if (aggregate.softDelete === true) {
      for (const m of normalizedMethods) {
        if (m.name === 'delete' && (m.params || []).length === 1) {
          m.name = 'softDelete';
        }
      }
    }

    // R11: bulkOperations: true exposes saveAll / findAllById / count on the
    // domain port. These come straight from JpaRepository so we skip them on
    // the JPA interface (classifyMethod returns 'skip') but still need them on
    // the domain repository + impl. Skip duplicates if the YAML declared them
    // explicitly.
    if (repoEntry.bulkOperations === true) {
      const existing = new Set(normalizedMethods.map((m) => m.name));
      if (!existing.has('saveAll')) {
        normalizedMethods.push({
          name: 'saveAll',
          params: [{ name: 'entities', type: `List[${aggregateName}]`, required: true }],
          returns: `List[${aggregateName}]`,
          derivedFrom: 'bulk-operations',
        });
      }
      if (!existing.has('findAllById')) {
        normalizedMethods.push({
          name: 'findAllById',
          params: [{ name: 'ids', type: 'List[Uuid]', required: true }],
          returns: `List[${aggregateName}]`,
          derivedFrom: 'bulk-operations',
        });
      }
      if (!existing.has('count')) {
        normalizedMethods.push({
          name: 'count',
          params: [],
          returns: 'Long',
          derivedFrom: 'bulk-operations',
        });
      }
    }

    // R25/R26: auto-derive repository methods from `uniqueness` domain rules.
    // For each rule of type `uniqueness` declared on this aggregate that names
    // a `field`, the repository must expose either `existsBy{Field}` or
    // `findBy{Field}` so the rule is enforceable. When neither is declared and
    // auto-derivation is allowed, inject a `findBy{Field}: Aggregate?` method
    // and tag it with the rule id as derivedFrom. Opt-out: autoDerive: false.
    //
    // R25-SKIP: if the field belongs to a child entity (not the root aggregate
    // properties), Spring Data cannot derive findBy{field} on the parent JPA
    // entity. Uniqueness for child-entity fields is enforced at the DB level via
    // the constraintName — no repository method is needed or possible.
    if (repoEntry.autoDerive !== false) {
      const aggRules = (aggregate.domainRules || []).filter(
        (r) => r && r.type === 'uniqueness' && typeof r.field === 'string' && r.field.trim() !== ''
      );
      for (const rule of aggRules) {
        const field = rule.field;
        // Skip if the field lives on a child entity, not the root aggregate.
        const rootProp = (aggregate.properties || []).find((p) => p.name === field);
        const isChildEntityField = !rootProp && (aggregate.entities || []).some(
          (e) => (e.properties || []).some((p) => p.name === field)
        );
        if (isChildEntityField) continue;

        const cap = field.charAt(0).toUpperCase() + field.slice(1);
        const findName = `findBy${cap}`;
        const existsName = `existsBy${cap}`;
        const declared = normalizedMethods.some((m) => m.name === findName || m.name === existsName);
        if (declared) continue;
        // Locate the field's declared YAML type on the aggregate root properties.
        const paramType = rootProp && rootProp.type ? rootProp.type : 'String';
        normalizedMethods.push({
          name: findName,
          params: [{ name: field, type: paramType, required: true }],
          returns: `${aggregateName}?`,
          derivedFrom: rule.id,
        });
      }
    }

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

    // 4. Extracted JPA mapper (R21). Sourced from the same context as the
    // RepositoryImpl: the mapper bodies are unchanged, only their host class
    // moves out of the adapter.
    const mapperContext = {
      packageName: implContext.packageName,
      bc: implContext.bc,
      aggregateName: implContext.aggregateName,
      jpaEntityName: implContext.jpaEntityName,
      toDomainBody: implContext.toDomainBody,
      toJpaBody: implContext.toJpaBody,
      childEntityMappers: implContext.childEntityMappers,
      imports: implContext.imports.filter((imp) =>
        // The mapper does not orchestrate transactions, persistence calls or
        // event publishing; drop the imports that only the adapter needs.
        imp !== 'org.springframework.transaction.annotation.Transactional'
        && imp !== 'org.springframework.context.ApplicationEventPublisher'
        && !imp.endsWith(`.${aggregateName}JpaRepository`)
        && !imp.endsWith(`.${aggregateName}JpaMapper`)
        && !imp.endsWith(`.${aggregateName}Repository`)
      ),
    };
    const mapperPath = path.join(
      outputDir, 'src', 'main', 'java',
      packagePath, bc,
      'infrastructure', 'persistence', 'mappers',
      `${aggregateName}JpaMapper.java`
    );
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'infrastructure', 'JpaMapper.java.ejs'),
      mapperPath,
      mapperContext
    );
  }
}

module.exports = { generateRepositories };
