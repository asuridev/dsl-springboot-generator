'use strict';

/**
 * Resilience + auth resolver (Phase 5).
 *
 * Looks up the resilience/auth configuration for a given outbound HTTP
 * integration. Precedence (highest first):
 *
 *   1. bc.yaml#/integrations/outbound[name=target]            (override)
 *   2. system.yaml#/integrations[from=bc, to=target, channel=http]   (BC→BC)
 *      system.yaml#/externalSystems[name=target]              (external)
 *
 * All resolved values are optional: when absent the caller must skip the
 * resilience / auth wiring entirely (no-op behaviour preserved).
 */

function pickFirst(...candidates) {
  for (const c of candidates) {
    if (c && typeof c === 'object' && Object.keys(c).length > 0) return c;
  }
  return null;
}

/**
 * Find the system.yaml integration entry matching (fromBc → targetBc, channel=http).
 */
function findSystemHttpIntegration(system, fromBc, targetBc) {
  return ((system && system.integrations) || []).find(
    (i) => i && i.from === fromBc && i.to === targetBc && i.channel === 'http'
  ) || null;
}

/**
 * Find the system.yaml externalSystems entry matching the target name.
 */
function findExternalSystem(system, targetName) {
  return ((system && system.externalSystems) || []).find(
    (e) => e && e.name === targetName
  ) || null;
}

/**
 * Find the bc.yaml outbound entry matching the target name.
 */
function findBcOutbound(bcYaml, targetName) {
  return (((bcYaml && bcYaml.integrations) || {}).outbound || []).find(
    (ob) => ob && ob.name === targetName
  ) || null;
}

/**
 * Resolve resilience for a BC→BC HTTP integration.
 * @returns {object|null}
 */
function resolveResilienceForBcHttp(system, bcYaml, targetBc) {
  const ob = findBcOutbound(bcYaml, targetBc);
  const integ = findSystemHttpIntegration(system, bcYaml.bc, targetBc);
  return pickFirst(ob && ob.resilience, integ && integ.resilience);
}

/**
 * Resolve auth for a BC→BC HTTP integration.
 * @returns {object|null}
 */
function resolveAuthForBcHttp(system, bcYaml, targetBc) {
  const ob = findBcOutbound(bcYaml, targetBc);
  const integ = findSystemHttpIntegration(system, bcYaml.bc, targetBc);
  return pickFirst(ob && ob.auth, integ && integ.auth);
}

/**
 * Resolve resilience for an external system from a given BC.
 * @returns {object|null}
 */
function resolveResilienceForExternal(system, bcYaml, externalName) {
  const ob = findBcOutbound(bcYaml, externalName);
  const ext = findExternalSystem(system, externalName);
  return pickFirst(ob && ob.resilience, ext && ext.resilience);
}

/**
 * Resolve auth for an external system from a given BC.
 * @returns {object|null}
 */
function resolveAuthForExternal(system, bcYaml, externalName) {
  const ob = findBcOutbound(bcYaml, externalName);
  const ext = findExternalSystem(system, externalName);
  return pickFirst(ob && ob.auth, ext && ext.auth);
}

/**
 * @returns {boolean} true if any HTTP integration in system+BCs declares resilience.
 */
function hasAnyResilience(system, allBcYamls) {
  for (const integ of (system.integrations || [])) {
    if (integ && integ.channel === 'http' && integ.resilience) return true;
  }
  for (const ext of (system.externalSystems || [])) {
    if (ext && ext.resilience) return true;
  }
  for (const bc of (allBcYamls || [])) {
    for (const ob of (((bc.integrations || {}).outbound) || [])) {
      if (ob && ob.resilience) return true;
    }
  }
  return false;
}

/**
 * Builds the list of named Resilience4j instances that need an explicit
 * per-instance block in resilience.yaml.
 *
 * An instance is included when its resolved resilience object contains at
 * least one sub-field inside `circuitBreaker` or `retries` with a concrete
 * value (beyond bare existence).
 *
 * Supported sub-fields (all optional):
 *   circuitBreaker:
 *     failureRateThreshold        integer 1-100
 *     waitDurationInOpenState     string with unit (e.g. "60s")
 *     slidingWindowSize           integer
 *     minimumNumberOfCalls        integer
 *     permittedNumberOfCallsInHalfOpenState  integer
 *   retries:
 *     maxAttempts                 integer
 *     waitDuration                string with unit (e.g. "1000ms")
 *
 * Precedence for each target follows resolveResilienceForBcHttp /
 * resolveResilienceForExternal (bc.yaml outbound overrides system.yaml).
 *
 * @param {object} system      — parsed system.yaml
 * @param {Array}  allBcYamls  — all parsed bc.yaml objects
 * @returns {Array<{name, circuitBreaker?, retries?}>}
 */
function buildResilienceInstances(system, allBcYamls) {
  const CB_FIELDS  = ['failureRateThreshold', 'waitDurationInOpenState', 'slidingWindowSize',
                      'minimumNumberOfCalls', 'permittedNumberOfCallsInHalfOpenState'];
  const RET_FIELDS = ['maxAttempts', 'waitDuration'];

  function extractCb(res) {
    if (!res || !res.circuitBreaker || typeof res.circuitBreaker !== 'object') return null;
    const out = {};
    for (const f of CB_FIELDS) {
      if (res.circuitBreaker[f] != null) out[f] = res.circuitBreaker[f];
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  function extractRetries(res) {
    if (!res || !res.retries || typeof res.retries !== 'object') return null;
    const out = {};
    for (const f of RET_FIELDS) {
      if (res.retries[f] != null) out[f] = res.retries[f];
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  const seen = new Set();
  const instances = [];

  // Collect all unique (target, resolved-resilience) pairs.
  // We need to iterate per-bc because resolveResilienceForBcHttp requires bcYaml.
  // For external systems we use resolveResilienceForExternal per bc.
  // To avoid duplicates we deduplicate by target name, keeping the first encounter
  // (system.yaml order is the canonical order).

  // 1. BC→BC integrations (customer-supplier, channel=http)
  for (const integ of (system.integrations || [])) {
    if (integ.channel !== 'http' || !integ.resilience) continue;
    const name = integ.to;
    if (seen.has(name)) continue;
    // Use the bc.yaml outbound override if available (check all bc yamls)
    const bcYaml = (allBcYamls || []).find((b) => b && b.bc === integ.from) || null;
    const resolved = bcYaml
      ? resolveResilienceForBcHttp(system, bcYaml, name)
      : integ.resilience;
    const cb  = extractCb(resolved);
    const ret = extractRetries(resolved);
    if (cb || ret) {
      seen.add(name);
      instances.push({ name, ...(cb  && { circuitBreaker: cb }),
                               ...(ret && { retries: ret }) });
    }
  }

  // 2. External system integrations (acl, channel=http)
  for (const ext of (system.externalSystems || [])) {
    if (!ext || !ext.resilience) continue;
    const name = ext.name;
    if (seen.has(name)) continue;
    // Check if any bc.yaml has an outbound override for this external
    let resolved = ext.resilience;
    for (const bcYaml of (allBcYamls || [])) {
      const ob = findBcOutbound(bcYaml, name);
      if (ob && ob.resilience) { resolved = pickFirst(ob.resilience, ext.resilience); break; }
    }
    const cb  = extractCb(resolved);
    const ret = extractRetries(resolved);
    if (cb || ret) {
      seen.add(name);
      instances.push({ name, ...(cb  && { circuitBreaker: cb }),
                               ...(ret && { retries: ret }) });
    }
  }

  // 3. bc.yaml outbound overrides that declare resilience with sub-fields
  //    but whose target isn't in system.yaml integrations/externalSystems
  for (const bcYaml of (allBcYamls || [])) {
    for (const ob of (((bcYaml && bcYaml.integrations) || {}).outbound || [])) {
      if (!ob || !ob.resilience) continue;
      const name = ob.name;
      if (seen.has(name)) continue;
      const cb  = extractCb(ob.resilience);
      const ret = extractRetries(ob.resilience);
      if (cb || ret) {
        seen.add(name);
        instances.push({ name, ...(cb  && { circuitBreaker: cb }),
                                 ...(ret && { retries: ret }) });
      }
    }
  }

  return instances;
}

/**
 * @returns {boolean} true if any HTTP integration uses auth.type === 'oauth2-cc'.
 */
function hasAnyOAuth2Cc(system, allBcYamls) {
  const isCc = (a) => a && a.type === 'oauth2-cc';
  for (const integ of (system.integrations || [])) if (isCc(integ.auth)) return true;
  for (const ext of (system.externalSystems || [])) if (isCc(ext.auth)) return true;
  for (const bc of (allBcYamls || [])) {
    for (const ob of (((bc.integrations || {}).outbound) || [])) {
      if (isCc(ob.auth)) return true;
    }
  }
  return false;
}

module.exports = {
  resolveResilienceForBcHttp,
  resolveAuthForBcHttp,
  resolveResilienceForExternal,
  resolveAuthForExternal,
  hasAnyResilience,
  hasAnyOAuth2Cc,
  buildResilienceInstances,
};
