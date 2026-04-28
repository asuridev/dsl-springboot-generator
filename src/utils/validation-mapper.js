'use strict';

/**
 * Translates DSL validations[] from bc-yaml property definitions into
 * Jakarta Validation annotation strings and their required imports.
 *
 * Usage:
 *   const { annotations, imports } = mapDslValidations(prop.validations, prop.type);
 *
 * @Size merge:
 *   When minLength is declared on a String(n) type, the type-mapper produces
 *   @Size(max=n) and this mapper produces @Size(min=N). Call mergeAnnotations()
 *   afterwards to combine them into a single @Size(min=N, max=n).
 */

const JAKARTA = 'jakarta.validation.constraints';

/**
 * Maps a single DSL validations[] array to Jakarta annotation strings.
 *
 * @param {Array<Object>} validations - Array of one-key constraint objects,
 *   e.g. [{ minLength: 2 }, { pattern: "^[A-Z0-9\\-]+$" }]
 * @param {string} type - Canonical YAML type of the property (e.g. "String(200)", "Decimal")
 * @returns {{ annotations: string[], imports: string[] }}
 */
function mapDslValidations(validations, type) {
  const annotations = [];
  const imports = new Set();

  if (!validations || validations.length === 0) {
    return { annotations, imports: [] };
  }

  const isDecimal = type === 'Decimal';

  for (const constraint of validations) {
    const key = Object.keys(constraint)[0];
    const value = constraint[key];

    switch (key) {
      case 'minLength':
        // Will be merged with @Size(max=n) from String(n) by mergeAnnotations()
        annotations.push(`@Size(min = ${value})`);
        imports.add(`${JAKARTA}.Size`);
        break;

      case 'notEmpty':
        if (value === true) {
          annotations.push('@NotEmpty');
          imports.add(`${JAKARTA}.NotEmpty`);
        }
        break;

      case 'pattern':
        annotations.push(`@Pattern(regexp = "${value}")`);
        imports.add(`${JAKARTA}.Pattern`);
        break;

      case 'min':
        if (isDecimal) {
          annotations.push(`@DecimalMin("${value}")`);
          imports.add(`${JAKARTA}.DecimalMin`);
        } else {
          annotations.push(`@Min(${value})`);
          imports.add(`${JAKARTA}.Min`);
        }
        break;

      case 'max':
        if (isDecimal) {
          annotations.push(`@DecimalMax("${value}")`);
          imports.add(`${JAKARTA}.DecimalMax`);
        } else {
          annotations.push(`@Max(${value})`);
          imports.add(`${JAKARTA}.Max`);
        }
        break;

      case 'positive':
        if (value === true) {
          annotations.push('@Positive');
          imports.add(`${JAKARTA}.Positive`);
        }
        break;

      case 'positiveOrZero':
        if (value === true) {
          annotations.push('@PositiveOrZero');
          imports.add(`${JAKARTA}.PositiveOrZero`);
        }
        break;

      case 'negative':
        if (value === true) {
          annotations.push('@Negative');
          imports.add(`${JAKARTA}.Negative`);
        }
        break;

      case 'negativeOrZero':
        if (value === true) {
          annotations.push('@NegativeOrZero');
          imports.add(`${JAKARTA}.NegativeOrZero`);
        }
        break;

      case 'future':
        if (value === true) {
          annotations.push('@Future');
          imports.add(`${JAKARTA}.Future`);
        }
        break;

      case 'futureOrPresent':
        if (value === true) {
          annotations.push('@FutureOrPresent');
          imports.add(`${JAKARTA}.FutureOrPresent`);
        }
        break;

      case 'past':
        if (value === true) {
          annotations.push('@Past');
          imports.add(`${JAKARTA}.Past`);
        }
        break;

      case 'pastOrPresent':
        if (value === true) {
          annotations.push('@PastOrPresent');
          imports.add(`${JAKARTA}.PastOrPresent`);
        }
        break;

      case 'minSize':
        annotations.push(`@Size(min = ${value})`);
        imports.add(`${JAKARTA}.Size`);
        break;

      case 'maxSize':
        annotations.push(`@Size(max = ${value})`);
        imports.add(`${JAKARTA}.Size`);
        break;

      default:
        // Unknown constraint key — ignored (bc-yaml-reader should have caught this)
        break;
    }
  }

  return { annotations, imports: [...imports] };
}

/**
 * Merges type-based @Size and DSL-based @Size annotations into a single
 * @Size(min = N, max = M) when both min and max are present separately.
 *
 * Example:
 *   typeAnnotations: ['@Size(max = 200)']
 *   dslAnnotations:  ['@Size(min = 2)']
 *   result:          ['@Size(min = 2, max = 200)']
 *
 * If only one side has @Size the annotation passes through unchanged.
 * Non-@Size annotations from both arrays are preserved in their original order.
 *
 * @param {string[]} typeAnnotations - Annotations from getTypeValidationAnnotations()
 * @param {string[]} dslAnnotations  - Annotations from mapDslValidations()
 * @returns {string[]}
 */
function mergeAnnotations(typeAnnotations, dslAnnotations) {
  const combined = [...typeAnnotations, ...dslAnnotations];

  const sizeMinEntry = combined.find((a) => /^@Size\(min = \d+\)$/.test(a));
  const sizeMaxEntry = combined.find((a) => /^@Size\(max = \d+\)$/.test(a));

  if (sizeMinEntry && sizeMaxEntry) {
    const minVal = sizeMinEntry.match(/min = (\d+)/)[1];
    const maxVal = sizeMaxEntry.match(/max = (\d+)/)[1];
    const merged = `@Size(min = ${minVal}, max = ${maxVal})`;
    return combined
      .filter((a) => a !== sizeMinEntry && a !== sizeMaxEntry)
      .concat(merged);
  }

  return combined;
}

module.exports = { mapDslValidations, mergeAnnotations };
