'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPackagePath } = require('../utils/naming');
const { mapType, isListType, getListElementType, isCanonicalSharedVo } = require('../utils/type-mapper');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

const CANONICAL_TYPES = new Set([
  'Uuid', 'String', 'Text', 'Integer', 'Long', 'Decimal', 'Boolean',
  'Date', 'DateTime', 'Duration', 'Email', 'Url', 'Money', 'StoredObject', 'PageRequest',
]);

const NUMERIC_PRIM_TYPES = new Set(['Integer', 'Long']);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isEnumName(type, bcYaml) {
  return (bcYaml.enums || []).some((e) => e.name === type);
}

function isVoName(type, bcYaml) {
  return (bcYaml.valueObjects || []).some((v) => v.name === type);
}

function unwrapEnumRef(type) {
  const m = /^Enum<(.+)>$/.exec(type);
  return m ? m[1] : null;
}

function pascal(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function quoteJava(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Extracts validation values from prop.validations[] into a flat map.
 * Translates positive/negative shortcuts into numericMin/numericMax sentinels:
 *   '0+' → strictly > 0
 *   '0-' → strictly < 0
 */
function extractValidations(prop) {
  const v = {
    minLength: null,
    maxLength: null,
    notEmpty: false,
    pattern: null,
    numericMin: null,
    numericMax: null,
    minStrict: false, // for '0+' positive shortcut
    maxStrict: false, // for '0-' negative shortcut
  };

  // String(n) → maxLength (merged with explicit maxLength)
  const strMatch = /^String\((\d+)\)$/.exec(prop.type || '');
  if (strMatch) v.maxLength = Number(strMatch[1]);

  for (const c of prop.validations || []) {
    const key = Object.keys(c)[0];
    const val = c[key];
    switch (key) {
      case 'minLength': v.minLength = Number(val); break;
      case 'maxLength':
        if (v.maxLength == null || Number(val) < v.maxLength) v.maxLength = Number(val);
        break;
      case 'notEmpty':  if (val === true) v.notEmpty = true; break;
      case 'pattern':   v.pattern = String(val); break;
      case 'min':       v.numericMin = val; break;
      case 'max':       v.numericMax = val; break;
      case 'positive':       if (val === true) { v.numericMin = 0; v.minStrict = true; } break;
      case 'positiveOrZero': if (val === true) v.numericMin = 0; break;
      case 'negative':       if (val === true) { v.numericMax = 0; v.maxStrict = true; } break;
      case 'negativeOrZero': if (val === true) v.numericMax = 0; break;
      default: /* ignore */ break;
    }
  }
  return v;
}

/**
 * Build the Java guard statements for a single VO property.
 * Returns an array of statement strings (already indented with 8 spaces).
 */
function buildGuards(prop, ctx) {
  const { name, isString, isDecimal, isNumeric, isLong, isEmailType, vals, voName } = ctx;
  const stmts = [];
  const errPrefix = `VO ${voName}.${name}`;

  if (prop.required === true) {
    stmts.push(`        if (${name} == null) {`);
    stmts.push(`            throw new IllegalArgumentException("${errPrefix}: required");`);
    stmts.push(`        }`);
  }

  if (isString) {
    if (vals.maxLength != null) {
      stmts.push(`        if (${name} != null && ${name}.length() > ${vals.maxLength}) {`);
      stmts.push(`            throw new IllegalArgumentException("${errPrefix}: exceeds max length ${vals.maxLength}");`);
      stmts.push(`        }`);
    }
    if (vals.minLength != null) {
      stmts.push(`        if (${name} != null && ${name}.length() < ${vals.minLength}) {`);
      stmts.push(`            throw new IllegalArgumentException("${errPrefix}: below min length ${vals.minLength}");`);
      stmts.push(`        }`);
    }
    if (vals.notEmpty) {
      stmts.push(`        if (${name} != null && ${name}.isEmpty()) {`);
      stmts.push(`            throw new IllegalArgumentException("${errPrefix}: must not be empty");`);
      stmts.push(`        }`);
    }
    if (vals.pattern) {
      stmts.push(`        if (${name} != null && !Pattern.matches("${quoteJava(vals.pattern)}", ${name})) {`);
      stmts.push(`            throw new IllegalArgumentException("${errPrefix}: does not match required pattern");`);
      stmts.push(`        }`);
    }
    if (isEmailType) {
      stmts.push(`        if (${name} != null && !EMAIL_PATTERN.matcher(${name}).matches()) {`);
      stmts.push(`            throw new IllegalArgumentException("${errPrefix}: invalid email format");`);
      stmts.push(`        }`);
    }
  }

  if (isDecimal) {
    if (vals.numericMin != null) {
      const op = vals.minStrict ? '<=' : '<';
      const cmp = vals.minStrict ? `> 0` : `>= ${vals.numericMin}`;
      stmts.push(`        if (${name} != null && ${name}.compareTo(new BigDecimal("${vals.numericMin}")) ${op} 0) {`);
      stmts.push(`            throw new IllegalArgumentException("${errPrefix}: must be ${cmp}");`);
      stmts.push(`        }`);
    }
    if (vals.numericMax != null) {
      const op = vals.maxStrict ? '>=' : '>';
      const cmp = vals.maxStrict ? `< 0` : `<= ${vals.numericMax}`;
      stmts.push(`        if (${name} != null && ${name}.compareTo(new BigDecimal("${vals.numericMax}")) ${op} 0) {`);
      stmts.push(`            throw new IllegalArgumentException("${errPrefix}: must be ${cmp}");`);
      stmts.push(`        }`);
    }
  } else if (isNumeric) {
    if (vals.numericMin != null) {
      const op = vals.minStrict ? '<=' : '<';
      const cmp = vals.minStrict ? `> 0` : `>= ${vals.numericMin}`;
      const minLit = isLong ? `${vals.numericMin}L` : `${vals.numericMin}`;
      stmts.push(`        if (${name} != null && ${name} ${op} ${minLit}) {`);
      stmts.push(`            throw new IllegalArgumentException("${errPrefix}: must be ${cmp}");`);
      stmts.push(`        }`);
    }
    if (vals.numericMax != null) {
      const op = vals.maxStrict ? '>=' : '>';
      const cmp = vals.maxStrict ? `< 0` : `<= ${vals.numericMax}`;
      const maxLit = isLong ? `${vals.numericMax}L` : `${vals.numericMax}`;
      stmts.push(`        if (${name} != null && ${name} ${op} ${maxLit}) {`);
      stmts.push(`            throw new IllegalArgumentException("${errPrefix}: must be ${cmp}");`);
      stmts.push(`        }`);
    }
  }

  return stmts;
}

/**
 * Resolve an extra import for a property whose type is a domain reference
 * (enum or VO). Returns null if it cannot be resolved.
 */
function resolveDomainImport(typeName, bcYaml, config) {
  const pkg = config.packageName;
  const bc = bcYaml.bc;
  const enumWrap = unwrapEnumRef(typeName);
  const resolved = enumWrap || typeName;
  if (enumWrap || isEnumName(resolved, bcYaml)) {
    return { javaType: resolved, importStmt: `import ${pkg}.${bc}.domain.enums.${resolved};` };
  }
  if (isVoName(resolved, bcYaml)) {
    return { javaType: resolved, importStmt: null }; // same package
  }
  return null;
}

// ─── Main generator ──────────────────────────────────────────────────────────

// Descriptor canónico del VO `Money`. type-mapper.js y type-resolution-validator.js
// tratan `Money` como tipo canónico (no requiere declararse en valueObjects[]), por
// lo que el resto de generators emite `import {bc}.domain.valueobject.Money` de forma
// incondicional. Cuando el diseñador NO lo declara, este generador debe emitir la
// clase para que ese import resuelva. Forma confirmada por el código consumidor
// (p. ej. ProductJpaMapper: `new Money(BigDecimal, String)`, getAmount()/getCurrency()).
const CANONICAL_MONEY_VO = {
  name: 'Money',
  description: 'Monetary amount with currency (canonical value object).',
  properties: [
    { name: 'amount', type: 'Decimal', precision: 19, scale: 4, required: true },
    { name: 'currency', type: 'String(3)', required: true },
  ],
};

// Wrappers estructurales + String(n), reutilizando el patrón de type-resolution-validator.
const MONEY_WRAPPER_RE = /^(List|Page|Slice|Stream|Set|Optional|Range)\[(.+)\]$/;
const MONEY_STRING_N_RE = /^String\(\d+\)$/;

/**
 * ¿Algún `type:` del BC resuelve (tras quitar wrappers y sufijo `?`) al canónico Money?
 * Solo se inspeccionan valores bajo claves `type` para evitar falsos positivos de
 * descripciones/comentarios que mencionen "money".
 */
function bcReferencesMoney(bcYaml) {
  let found = false;

  const typeHasMoney = (raw) => {
    if (raw == null || typeof raw !== 'string') return false;
    let t = raw.trim();
    while (t.endsWith('?')) t = t.slice(0, -1).trim();
    const wrap = MONEY_WRAPPER_RE.exec(t);
    if (wrap) return typeHasMoney(wrap[2]);
    if (MONEY_STRING_N_RE.test(t)) return false;
    return t === 'Money';
  };

  const walk = (node) => {
    if (found || node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'type' && typeHasMoney(value)) {
          found = true;
          return;
        }
        walk(value);
      }
    }
  };

  walk(bcYaml);
  return found;
}

/**
 * Renderiza un único Value Object a su archivo Java. Extraído del bucle principal
 * para poder reutilizarse tanto con VOs declarados como con el Money canónico.
 */
async function renderValueObject(vo, bcYaml, config, voDir) {
  if (!vo.properties || vo.properties.length === 0) {
    throw new Error(
      `[value-object-generator] VO "${vo.name}" has no properties defined. ` +
      `Value Objects must declare at least one property.`
    );
  }

  const bc = bcYaml.bc;
  const imports = new Set();
  imports.add('import java.util.Objects;');

  const fields = [];
  let hasDecimal = false;
  let hasEmail = false;

  for (const prop of vo.properties || []) {
    const isList = isListType(prop.type);
    let javaType;

    if (isList) {
      imports.add('import java.util.List;');
      const innerRaw = getListElementType(prop.type);
      const innerHead = (innerRaw || '').replace(/\(.*\)/, '');
      let innerJavaType;
      if (CANONICAL_TYPES.has(innerHead)) {
        const innerMapped = mapType(innerRaw, prop);
        if (innerMapped.importHint) imports.add(`import ${innerMapped.importHint};`);
        innerJavaType = innerMapped.javaType;
      } else {
        const ref = resolveDomainImport(innerRaw, bcYaml, config);
        if (!ref) {
          throw new Error(
            `[value-object-generator] VO "${vo.name}" property "${prop.name}" element type "${innerRaw}" cannot be resolved. ` +
            `Declare it under enums[] or valueObjects[], or use a canonical type.`
          );
        }
        if (ref.importStmt) imports.add(ref.importStmt);
        innerJavaType = ref.javaType;
      }
      javaType = `List<${innerJavaType}>`;
    } else {
      const head = (prop.type || '').replace(/\(.*\)/, '');
      if (CANONICAL_TYPES.has(head)) {
        const mapped = mapType(prop.type, prop);
        if (mapped.importHint) imports.add(`import ${mapped.importHint};`);
        javaType = mapped.javaType;
      } else {
        const ref = resolveDomainImport(prop.type, bcYaml, config);
        if (!ref) {
          throw new Error(
            `[value-object-generator] VO "${vo.name}" property "${prop.name}" type "${prop.type}" cannot be resolved. ` +
            `Declare it under enums[] or valueObjects[], or use a canonical type.`
          );
        }
        if (ref.importStmt) imports.add(ref.importStmt);
        javaType = ref.javaType;
      }
    }

    const isDecimal = prop.type === 'Decimal';
    const isNumericPrim = NUMERIC_PRIM_TYPES.has(prop.type);
    const isString = !isList && javaType === 'String';
    const isEmailType = prop.type === 'Email';

    if (isDecimal) {
      hasDecimal = true;
      imports.add('import java.math.BigDecimal;');
      imports.add('import java.math.RoundingMode;');
    }
    if (isEmailType) {
      hasEmail = true;
      imports.add('import java.util.regex.Pattern;');
    }

    const vals = extractValidations(prop);
    if (vals.pattern) imports.add('import java.util.regex.Pattern;');

    const guards = buildGuards(prop, {
      name: prop.name,
      isString,
      isDecimal,
      isNumeric: isNumericPrim,
      isLong: prop.type === 'Long',
      isEmailType,
      vals,
      voName: vo.name,
    });

    // Assignment
    let assignment;
    if (isList) {
      assignment = `        this.${prop.name} = (${prop.name} == null) ? List.of() : List.copyOf(${prop.name});`;
    } else if (isDecimal) {
      const scale = prop.scale != null ? prop.scale : 4;
      assignment =
        `        try {\n` +
        `            this.${prop.name} = (${prop.name} == null) ? null : ${prop.name}.setScale(${scale}, RoundingMode.UNNECESSARY);\n` +
        `        } catch (ArithmeticException ex) {\n` +
        `            throw new IllegalArgumentException("VO ${vo.name}.${prop.name}: scale exceeds ${scale}", ex);\n` +
        `        }`;
    } else {
      assignment = `        this.${prop.name} = ${prop.name};`;
    }

    const equalsExpr = isDecimal
      ? `eqDecimal(${prop.name}, that.${prop.name})`
      : `Objects.equals(${prop.name}, that.${prop.name})`;

    fields.push({
      name: prop.name,
      pascalName: pascal(prop.name),
      javaType,
      isList,
      isDecimal,
      guards,
      assignment,
      equalsExpr,
    });
  }

  const isMicrotype = fields.length === 1;

  const context = {
    packageName: config.packageName,
    bc,
    name: vo.name,
    description: vo.description || '',
    traceTag: `valueObject:${vo.name}`,
    imports: [...imports].sort(),
    fields,
    hasDecimal,
    hasEmail,
    isMicrotype,
  };

  const destPath = path.join(voDir, `${vo.name}.java`);
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'domain', 'ValueObject.java.ejs'),
    destPath,
    context
  );
}

async function generateValueObjects(bcYaml, config, outputDir) {
  const valueObjects = bcYaml.valueObjects || [];
  const declaresMoney = valueObjects.some((v) => v && v.name === 'Money');
  const needsCanonicalMoney = !declaresMoney && bcReferencesMoney(bcYaml);

  if (valueObjects.length === 0 && !needsCanonicalMoney) return;

  const bc = bcYaml.bc;
  const packagePath = toPackagePath(config.packageName);
  const voDir = path.join(outputDir, 'src', 'main', 'java', packagePath, bc, 'domain', 'valueobject');

  for (const vo of valueObjects) {
    await renderValueObject(vo, bcYaml, config, voDir);
  }

  // Money es canónico: si el BC lo referencia pero no lo declara, emitimos la clase
  // para que los imports `{bc}.domain.valueobject.Money` (emitidos por otros
  // generators) resuelvan. Si lo declara, gana la declaración explícita (arriba).
  if (needsCanonicalMoney) {
    await renderValueObject(CANONICAL_MONEY_VO, bcYaml, config, voDir);
  }
}

// ─── Event DTO generator ──────────────────────────────────────────────────────

/**
 * Resolves the Java type for a single eventDtos[].properties[] entry.
 * Accumulates necessary import statements into the provided Set.
 *
 * Resolution order:
 *  1. List[T] — recursive
 *  2. Canonical types (via mapType) — Money/isValueObject → domain.valueobject import
 *  3. Enum<X> wrapper or declared enum
 *  4. Other eventDto in this BC (same package — no import)
 *  5. VO from this BC (domain.valueobject import)
 */
function resolveEventDtoPropType(prop, bcYaml, config, imports, dtoName) {
  const type = prop.type || '';
  const pkg = config.packageName;
  const bc = bcYaml.bc;

  // 1. List[T]
  const listMatch = /^List\[(.+)\]$/.exec(type);
  if (listMatch) {
    imports.add('import java.util.List;');
    const inner = resolveEventDtoPropType({ ...prop, type: listMatch[1] }, bcYaml, config, imports, dtoName);
    return `List<${inner}>`;
  }

  // 2. Canonical types
  const head = type.replace(/\(.*\)/, '');
  if (CANONICAL_TYPES.has(head)) {
    const mapped = mapType(type, prop);
    let importHint = mapped.importHint;
    // Money and other VOs that mapType returns with importHint: null
    if (!importHint && mapped.isValueObject) {
      importHint = isCanonicalSharedVo(type)
        ? `${pkg}.shared.domain.valueobject.${mapped.javaType}`
        : `${pkg}.${bc}.domain.valueobject.${mapped.javaType}`;
    }
    if (importHint) imports.add(`import ${importHint};`);
    return mapped.javaType;
  }

  // 3. Enum<X> wrapper
  const enumWrap = /^Enum<(.+)>$/.exec(type);
  if (enumWrap) {
    const enumName = enumWrap[1];
    imports.add(`import ${pkg}.${bc}.domain.enums.${enumName};`);
    return enumName;
  }

  // 3b. Declared enum
  if (isEnumName(type, bcYaml)) {
    imports.add(`import ${pkg}.${bc}.domain.enums.${type};`);
    return type;
  }

  // 4. Other eventDto in this BC — same package, no import needed
  if ((bcYaml.eventDtos || []).some((d) => d.name === type)) {
    return type;
  }

  // 5. VO from this BC
  if (isVoName(type, bcYaml)) {
    imports.add(`import ${pkg}.${bc}.domain.valueobject.${type};`);
    return type;
  }

  throw new Error(
    `[value-object-generator] EventDto "${dtoName}" property "${prop.name}" type "${type}" cannot be resolved. ` +
    `Declare it under enums[], valueObjects[], eventDtos[], or use a canonical type.`
  );
}

/**
 * Generates Java record classes for each entry in bcYaml.eventDtos[].
 * Output: {bc}/application/dtos/incoming/{Name}.java
 */
async function generateEventDtos(bcYaml, config, outputDir) {
  const eventDtos = bcYaml.eventDtos || [];
  if (eventDtos.length === 0) return;

  const bc = bcYaml.bc;
  const packagePath = toPackagePath(config.packageName);
  const dtoDir = path.join(
    outputDir, 'src', 'main', 'java', packagePath, bc, 'application', 'dtos', 'incoming'
  );

  for (const dto of eventDtos) {
    const imports = new Set();
    const fields = [];

    for (const prop of dto.properties || []) {
      const javaType = resolveEventDtoPropType(prop, bcYaml, config, imports, dto.name);
      fields.push({ name: prop.name, javaType });
    }

    const context = {
      packageName: config.packageName,
      bc,
      name: dto.name,
      sourceBc: dto.sourceBc || null,
      traceTag: `eventDto:${dto.name}`,
      imports: [...imports].sort(),
      fields,
    };

    const destPath = path.join(dtoDir, `${dto.name}.java`);
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'application', 'EventDto.java.ejs'),
      destPath,
      context
    );
  }
}

module.exports = { generateValueObjects, generateEventDtos };
