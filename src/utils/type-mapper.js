'use strict';

/**
 * Canonical type → Java type mapping per BC-YAML-GENERATOR-SPEC §11.
 *
 * Returns an object describing how to represent a YAML canonical type in Java:
 *   {
 *     javaType:    string  — fully-qualified or simple Java type
 *     annotation:  string  — optional field-level annotation (empty string if none)
 *     columnType:  string  — PostgreSQL column type (informational)
 *     nullable:    boolean — whether Optional / nullable wrapping applies
 *   }
 */

const PROHIBITED_TYPES = new Set([
  'string',
  'int',
  'number',
  'float',
  'bool',
  'date',
  'timestamp',
  'any',
  'object',
  'bigint',
]);

// Matches String(n)
const STRING_N_RE = /^String\((\d+)\)$/;
// Matches List[T]
const LIST_T_RE = /^List\[(.+)\]$/;
// [G8] Matches Range[T] (numeric/temporal range filter)
const RANGE_T_RE = /^Range\[(.+)\]$/;

/**
 * Map a YAML canonical type string to Java metadata.
 * @param {string} type - Canonical type from YAML (e.g. "Uuid", "String(100)", "Money")
 * @param {object} [prop] - Full property object for precision/scale when type is Decimal
 * @returns {{ javaType: string, importHint: string|null, validationAnnotations: string[] }}
 */
function mapType(type, prop = {}) {
  if (!type) throw new Error('mapType: type is required');

  // Prohibited types — fail fast
  if (PROHIBITED_TYPES.has(type)) {
    throw new Error(
      `Type "${type}" is prohibited in YAML. Use canonical types (e.g. "String", "Integer", "Boolean"). ` +
        'See BC-YAML-GENERATOR-SPEC §11.'
    );
  }

  // varchar(n) prohibited
  if (/^varchar\(\d+\)/i.test(type)) {
    throw new Error(`Type "${type}" is prohibited. Use "String(n)" instead.`);
  }

  // String(n)
  const stringMatch = STRING_N_RE.exec(type);
  if (stringMatch) {
    const n = stringMatch[1];
    return {
      javaType: 'String',
      importHint: null,
      validationAnnotations: [`@Size(max = ${n})`],
    };
  }

  // List[T]
  const listMatch = LIST_T_RE.exec(type);
  if (listMatch) {
    const inner = mapType(listMatch[1]);
    return {
      javaType: `List<${inner.javaType}>`,
      importHint: 'java.util.List',
      validationAnnotations: [],
    };
  }

  // [G8] Range[T] — declarative numeric/temporal range filter.
  // Maps to the shared record Range<T>(min, max). The inner type drives the
  // generic parameter and its import hint is propagated so callers can add
  // both imports (the shared Range record + the inner type, e.g. BigDecimal).
  const rangeMatch = RANGE_T_RE.exec(type);
  if (rangeMatch) {
    const inner = mapType(rangeMatch[1]);
    return {
      javaType: `Range<${inner.javaType}>`,
      // The Range<T> record lives in shared/application/dtos. Callers that
      // build import lists need both this hint and the inner type's hint.
      importHint: null,
      innerImportHint: inner.importHint || null,
      validationAnnotations: [],
      isRange: true,
    };
  }

  // [G8] SearchText — declarative full-text-ish filter input.
  // Carried as a String at the wire level; the aggregate fields[] declared on
  // the input drive the Specification builder in the repository.
  if (type === 'SearchText') {
    return {
      javaType: 'String',
      importHint: null,
      validationAnnotations: [],
      isSearchText: true,
    };
  }

  switch (type) {
    case 'Uuid':
      return {
        javaType: 'UUID',
        importHint: 'java.util.UUID',
        validationAnnotations: [],
      };

    case 'String':
      return {
        javaType: 'String',
        importHint: null,
        validationAnnotations: [],
      };

    case 'Text':
      return {
        javaType: 'String',
        importHint: null,
        validationAnnotations: [],
      };

    case 'Integer':
      return {
        javaType: 'Integer',
        importHint: null,
        validationAnnotations: [],
      };

    case 'Long':
      return {
        javaType: 'Long',
        importHint: null,
        validationAnnotations: [],
      };

    case 'Decimal': {
      const precision = prop.precision || 19;
      const scale = prop.scale || 4;
      return {
        javaType: 'BigDecimal',
        importHint: 'java.math.BigDecimal',
        validationAnnotations: [],
        precision,
        scale,
      };
    }

    case 'Boolean':
      return {
        javaType: 'Boolean',
        importHint: null,
        validationAnnotations: [],
      };

    case 'Date':
      return {
        javaType: 'LocalDate',
        importHint: 'java.time.LocalDate',
        validationAnnotations: [],
      };

    case 'DateTime':
      return {
        javaType: 'Instant',
        importHint: 'java.time.Instant',
        validationAnnotations: [],
      };

    case 'Duration':
      return {
        javaType: 'Duration',
        importHint: 'java.time.Duration',
        validationAnnotations: [],
      };

    case 'Email':
      return {
        javaType: 'String',
        importHint: null,
        validationAnnotations: ['@Email'],
      };

    case 'Url':
      return {
        javaType: 'URI',
        importHint: 'java.net.URI',
        validationAnnotations: [],
      };

    case 'Money':
      // Value Object — handled as @Embedded; not decomposed here
      return {
        javaType: 'Money',
        importHint: null,
        validationAnnotations: ['@Valid'],
        isValueObject: true,
      };

    case 'PageRequest':
      // Framework-level pagination type; resolved in templates
      return {
        javaType: 'Pageable',
        importHint: 'org.springframework.data.domain.Pageable',
        validationAnnotations: [],
      };

    // [G12] Multipart upload — represented as Spring's MultipartFile.
    // Only valid on inputs with source: multipart (validated upstream).
    case 'File':
      return {
        javaType: 'MultipartFile',
        importHint: 'org.springframework.web.multipart.MultipartFile',
        validationAnnotations: [],
      };

    // [G12] Binary download — represented as Spring's Resource.
    // Only valid in useCases[].returns; controller wraps it in
    // ResponseEntity<Resource> with application/octet-stream.
    case 'BinaryStream':
      return {
        javaType: 'Resource',
        importHint: 'org.springframework.core.io.Resource',
        validationAnnotations: [],
      };

    default: {
      // Enum<X> → X (enum reference in YAML canonical form)
      const enumMatch = /^Enum<(.+)>$/.exec(type);
      if (enumMatch) {
        return {
          javaType: enumMatch[1],
          importHint: null,
          validationAnnotations: [],
          isDomainType: true,
        };
      }
      // Assume it's an enum or aggregate reference (PascalCase domain type)
      return {
        javaType: type,
        importHint: null,
        validationAnnotations: [],
        isDomainType: true,
      };
    }
  }
}

/**
 * Returns the PostgreSQL column type for a canonical type.
 * Used informational / for Flyway migrations (future scope).
 */
function mapToPostgres(type, prop = {}) {
  const stringMatch = STRING_N_RE.exec(type);
  if (stringMatch) return `varchar(${stringMatch[1]})`;

  switch (type) {
    case 'Uuid':      return 'uuid';
    case 'String':    return 'text';
    case 'Text':      return 'text';
    case 'Integer':   return 'integer';
    case 'Long':      return 'bigint';
    case 'Decimal':   return `numeric(${prop.precision || 19}, ${prop.scale || 4})`;
    case 'Boolean':   return 'boolean';
    case 'Date':      return 'date';
    case 'DateTime':  return 'timestamptz';
    case 'Duration':  return 'interval';
    case 'Email':     return 'varchar(254)';
    case 'Url':       return 'text';
    default:          return 'text';
  }
}

/**
 * Returns the OpenAPI format string for a canonical type.
 */
function mapToOpenApiFormat(type) {
  switch (type) {
    case 'Uuid':     return 'uuid';
    case 'Decimal':  return 'decimal';
    case 'Date':     return 'date';
    case 'DateTime': return 'date-time';
    case 'Duration': return 'duration';
    case 'Email':    return 'email';
    case 'Url':      return 'uri';
    default:         return null;
  }
}

/**
 * Returns true when type is a List[T] canonical form.
 * e.g. "List[String(100)]" → true
 */
function isListType(type) {
  return LIST_T_RE.test(type);
}

/**
 * Returns the element type T from List[T], or null if not a list type.
 * e.g. "List[String(100)]" → "String(100)"
 */
function getListElementType(type) {
  const m = LIST_T_RE.exec(type);
  return m ? m[1] : null;
}

/**
 * Resolves a canonical DSL return type to its Java equivalent.
 * Used by generators to resolve `returns:` on use cases to the correct
 * Java type without treating it as a BC DTO class name.
 *
 * Returns { javaType, importHint } for known scalar canonical types,
 * or null for non-canonical types (DTO names, enum references, etc.).
 *
 * Does NOT handle structural types (Page[T], List[T], Optional[T]) or
 * BinaryStream — those are matched upstream before this function is called.
 *
 * @param {string} type - Canonical DSL type (e.g. "Uuid", "Decimal")
 * @returns {{ javaType: string, importHint: string|null } | null}
 */
function resolveCanonicalReturnType(type) {
  switch (type) {
    case 'Uuid':     return { javaType: 'UUID',       importHint: 'java.util.UUID' };
    case 'Integer':  return { javaType: 'Integer',    importHint: null };
    case 'Long':     return { javaType: 'Long',       importHint: null };
    case 'Decimal':  return { javaType: 'BigDecimal', importHint: 'java.math.BigDecimal' };
    case 'Boolean':  return { javaType: 'Boolean',    importHint: null };
    case 'Date':     return { javaType: 'LocalDate',  importHint: 'java.time.LocalDate' };
    case 'DateTime': return { javaType: 'Instant',    importHint: 'java.time.Instant' };
    case 'Duration': return { javaType: 'Duration',   importHint: 'java.time.Duration' };
    case 'String':   return { javaType: 'String',     importHint: null };
    case 'Text':     return { javaType: 'String',     importHint: null };
    case 'Email':    return { javaType: 'String',     importHint: null };
    case 'Url':      return { javaType: 'URI',        importHint: 'java.net.URI' };
    default:         return null;
  }
}

module.exports = { mapType, mapToPostgres, mapToOpenApiFormat, PROHIBITED_TYPES, isListType, getListElementType, resolveCanonicalReturnType };
