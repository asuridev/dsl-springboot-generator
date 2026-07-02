'use strict';

/**
 * Java identifier validation helpers.
 *
 * The generator emits many YAML names *verbatim* as Java identifiers: aggregate /
 * value-object / entity names become class names, property names become field
 * declarations and getters, enum values become constants, error args become method
 * parameters. None of these are transformed (no camel/pascal-casing) before they
 * reach the templates, so a name that is not a valid Java identifier — or that is a
 * reserved word — produces Java that does not compile.
 *
 * This module centralises the fail-fast guard for those positions.
 */

// 53 Java keywords + the three boolean/null literals + the restricted/contextual
// identifiers introduced since Java 9 (var, record, yield, sealed, permits).
// A class/field/constant cannot use any of these as its name.
const JAVA_RESERVED = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
  'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
  'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
  'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package',
  'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient',
  'try', 'void', 'volatile', 'while',
  // literals
  'true', 'false', 'null',
  // restricted / contextual keywords (illegal as type/var names in modern Java)
  'var', 'record', 'yield', 'sealed', 'permits', 'non-sealed',
]);

const JAVA_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Throw via the supplied `fail` function if `name` is not a usable Java identifier.
 *
 * @param {string}   name    the raw YAML name
 * @param {string}   context human-readable location, e.g. `Aggregate "Order" property`
 * @param {Function} fail    error thrower (kept injectable so callers reuse their prefix)
 */
function assertJavaIdentifier(name, context, fail) {
  if (typeof name !== 'string' || name.length === 0) {
    fail(`${context}: name is missing or not a string.`);
    return;
  }
  if (!JAVA_IDENTIFIER_RE.test(name)) {
    fail(
      `${context} "${name}" is not a valid Java identifier. ` +
      `It is emitted verbatim as a Java class/field/constant name, so it must contain only ` +
      `letters, digits, '_' or '$' and must not start with a digit (no hyphens, spaces or dots).`
    );
    return;
  }
  if (JAVA_RESERVED.has(name)) {
    fail(
      `${context} "${name}" is a Java reserved word and cannot be used as a class/field/constant name. ` +
      `Rename it in the design.`
    );
  }
}

// Mirror naming.js toPascalCase (kept local to avoid a circular require).
function toPascalCaseLocal(str) {
  return String(str)
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^(.)/, (c) => c.toUpperCase());
}

/**
 * Throw via `fail` if `name`, once PascalCased, is not a usable Java identifier.
 *
 * Unlike assertJavaIdentifier this is for names the generator TRANSFORMS before
 * emitting — a use case name becomes `${PascalCase(name)}CommandHandler` /
 * `…QueryHandler`, DTO and Result class names, etc. Spaces/hyphens/underscores are
 * stripped by PascalCasing, so only the resulting token is validated (no
 * reserved-word check: the emitted name is always suffixed). Catches e.g.
 * "Search Products (Public)" → "SearchProducts(Public)".
 */
function assertDerivedJavaIdentifier(name, context, fail) {
  if (typeof name !== 'string' || name.length === 0) return; // presence handled by caller
  const derived = toPascalCaseLocal(name);
  if (!JAVA_IDENTIFIER_RE.test(derived)) {
    fail(
      `${context} "${name}" does not yield a valid Java class name (it PascalCases to "${derived}"). ` +
      `Use only letters, digits, spaces, hyphens or underscores and start with a letter — the generator ` +
      `derives class names such as "${derived}CommandHandler"/"${derived}QueryHandler" from it.`
    );
  }
}

module.exports = { JAVA_RESERVED, JAVA_IDENTIFIER_RE, assertJavaIdentifier, assertDerivedJavaIdentifier };
