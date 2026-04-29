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
};
