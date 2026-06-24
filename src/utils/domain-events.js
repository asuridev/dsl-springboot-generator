'use strict';

/**
 * Domain-event attribution helpers, shared across generators so they agree on
 * which aggregate publishes which event.
 *
 * Published events may omit the `aggregate` field. When they do, an aggregate is
 * only the owner if it actually emits the event. The aggregate-generator detects
 * this by scanning the generated method bodies for `new <Name>Event(`; the
 * repository-generator (which does not generate those bodies) must derive the
 * same fact straight from the YAML. This helper provides that YAML-based view:
 * the set of event names an aggregate emits.
 */

/** Push event name(s) from an `emits` value (string | string[] | null) into a Set. */
function collectEmits(emits, target) {
  if (!emits) return;
  if (Array.isArray(emits)) {
    for (const e of emits) {
      if (e) target.add(e);
    }
    return;
  }
  target.add(emits);
}

/**
 * Returns the set of domain-event names emitted by the given aggregate, derived
 * from the YAML. Sources of `emits`:
 *   - aggregate.methods[].emits
 *   - enum transitions of enums used as a property type by the aggregate
 *   - useCases[].emits for use cases targeting this aggregate (defensive)
 *
 * @param {object} aggregate - aggregate node from bcYaml.aggregates[]
 * @param {object} bcYaml - the bounded-context YAML
 * @returns {Set<string>} emitted event names
 */
function aggregateEmittedEventNames(aggregate, bcYaml) {
  const emitted = new Set();
  if (!aggregate) return emitted;

  // 1. Business-method signatures declared on the aggregate.
  for (const m of (aggregate.methods || [])) {
    collectEmits(m.emits, emitted);
  }

  // 2. Enum transitions, but only for enums that are a property type of this aggregate.
  const aggEnumTypes = new Set((aggregate.properties || []).map((p) => p.type));
  for (const en of ((bcYaml && bcYaml.enums) || [])) {
    if (!aggEnumTypes.has(en.name)) continue;
    for (const v of (en.values || [])) {
      for (const t of (v.transitions || [])) {
        collectEmits(t.emits, emitted);
      }
    }
  }

  // 3. Use cases targeting this aggregate (defensive — emits usually live on methods/transitions).
  for (const uc of ((bcYaml && bcYaml.useCases) || [])) {
    if (uc.aggregate === aggregate.name) {
      collectEmits(uc.emits, emitted);
    }
  }

  return emitted;
}

module.exports = { aggregateEmittedEventNames, collectEmits };
