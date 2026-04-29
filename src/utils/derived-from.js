'use strict';

/**
 * Trazabilidad: produce un comentario `// derived_from: <pointer>` que se
 * inyecta como header de los artefactos generados, vinculando el código a
 * la sección del YAML que lo originó.
 *
 * Ejemplos de pointer:
 *   - "system.yaml#/integrations[2]"
 *   - "catalog.yaml#/domainEvents/published/0"
 *   - "system.yaml#/externalSystems/payment-gateway/operations/chargeCard"
 *
 * @param {string} pointer
 * @returns {string} línea de comentario lista para emitir en Java
 */
function derivedFrom(pointer) {
  if (!pointer || typeof pointer !== 'string') return '';
  return `// derived_from: ${pointer}`;
}

/**
 * Variante para JavaDoc / bloques `/* … *​/`.
 * @param {string} pointer
 */
function derivedFromBlock(pointer) {
  if (!pointer || typeof pointer !== 'string') return '';
  return ` * derived_from: ${pointer}`;
}

module.exports = { derivedFrom, derivedFromBlock };
