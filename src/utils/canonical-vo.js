'use strict';

/**
 * Canonical value objects that the generator auto-emits when a design uses them
 * by name (e.g. `type: Money`) without declaring them in `valueObjects[]`.
 *
 * Single source of truth so every consumer (value-object-generator, JPA column
 * expansion, command/DTO interposition) agrees on the exact shape. See
 * [[money-and-derived-generator-fixes]].
 */
const CANONICAL_MONEY_VO = {
  name: 'Money',
  description: 'Monetary amount with currency (canonical value object).',
  properties: [
    { name: 'amount', type: 'Decimal', precision: 19, scale: 4, required: true },
    { name: 'currency', type: 'String(3)', required: true },
  ],
};

/**
 * Resolve a value-object definition by type name: prefer the one the design
 * declared in `valueObjects[]`, else fall back to a known canonical VO. Returns
 * null for non-VO types.
 *
 * This lets the canonical Money ride the same DTO-interposition path as declared
 * multi-property VOs (R3): a `type: Money` body input becomes a `MoneyRequest`
 * DTO instead of binding the domain VO directly to the wire.
 */
function resolveVoDefinition(typeName, bcYaml) {
  const declared = ((bcYaml && bcYaml.valueObjects) || []).find((v) => v.name === typeName);
  if (declared) return declared;
  if (typeName === 'Money') return CANONICAL_MONEY_VO;
  return null;
}

module.exports = { CANONICAL_MONEY_VO, resolveVoDefinition };
