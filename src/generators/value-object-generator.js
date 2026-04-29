'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPackagePath } = require('../utils/naming');
const { mapType, isListType, getListElementType } = require('../utils/type-mapper');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

const CANONICAL_TYPES = new Set([
  'Uuid', 'String', 'Text', 'Integer', 'Long', 'Decimal', 'Boolean',
  'Date', 'DateTime', 'Duration', 'Email', 'Url', 'Money', 'PageRequest',
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
  const { name, isString, isDecimal, isNumeric, isEmailType, vals, voName } = ctx;
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
      stmts.push(`        if (${name} != null && ${name} ${op} ${vals.numericMin}) {`);
      stmts.push(`            throw new IllegalArgumentException("${errPrefix}: must be ${cmp}");`);
      stmts.push(`        }`);
    }
    if (vals.numericMax != null) {
      const op = vals.maxStrict ? '>=' : '>';
      const cmp = vals.maxStrict ? `< 0` : `<= ${vals.numericMax}`;
      stmts.push(`        if (${name} != null && ${name} ${op} ${vals.numericMax}) {`);
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

async function generateValueObjects(bcYaml, config, outputDir) {
  const valueObjects = bcYaml.valueObjects || [];
  if (valueObjects.length === 0) return;

  const bc = bcYaml.bc;
  const packagePath = toPackagePath(config.packageName);
  const voDir = path.join(outputDir, 'src', 'main', 'java', packagePath, bc, 'domain', 'valueobject');

  for (const vo of valueObjects) {
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
}

module.exports = { generateValueObjects };
