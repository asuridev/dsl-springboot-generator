'use strict';

const path = require('path');
const fs = require('fs-extra');
const { renderTemplate } = require('../utils/template-engine');
const logger = require('../utils/logger');

const KEYCLOAK_TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates', 'base', 'keycloak');

// ─── Data extraction ──────────────────────────────────────────────────────────

/**
 * Scans all BC YAMLs and collects:
 *   - realmRoles   : unique values from authorization.rolesAnyOf
 *   - clientRoles  : unique values from authorization.permissionsAnyOf
 *   - clientScopes : unique values from authorization.scopesAnyOf
 *   - actorRolesMap        : Map<actor, Set<realmRole>>
 *   - actorClientRolesMap  : Map<actor, Set<clientRole>>
 *
 * @param {object[]} allBcYamls
 * @returns {{ realmRoles: string[], clientRoles: string[], clientScopes: string[],
 *             actorRolesMap: Map, actorClientRolesMap: Map }}
 */
function collectAuthData(allBcYamls) {
  const realmRolesSet = new Set();
  const clientRolesSet = new Set();
  const clientScopesSet = new Set();
  const actorRolesMap = new Map();
  const actorClientRolesMap = new Map();

  // Realm roles must be emitted WITHOUT the ROLE_ prefix: the controller strips it
  // for @PreAuthorize (hasAnyRole('ADMIN')) and JwtAuthConverter re-adds it
  // ("ROLE_" + role). Emitting ROLE_ADMIN here would make Keycloak put ROLE_ADMIN in
  // the token → converter yields ROLE_ROLE_ADMIN → never matches → 403 everywhere.
  const stripRolePrefix = (r) => r.replace(/^ROLE_/, '');

  for (const bcYaml of allBcYamls) {
    const useCases = (bcYaml && bcYaml.useCases) || [];
    for (const uc of useCases) {
      if (!uc) continue;

      const actor = uc.actor || null;
      const authz = uc.authorization || null;

      if (authz) {
        // Realm roles
        for (const rawRole of (authz.rolesAnyOf || [])) {
          const role = stripRolePrefix(rawRole);
          realmRolesSet.add(role);
          if (actor) {
            if (!actorRolesMap.has(actor)) actorRolesMap.set(actor, new Set());
            actorRolesMap.get(actor).add(role);
          }
        }

        // Client roles (permissions)
        for (const perm of (authz.permissionsAnyOf || [])) {
          clientRolesSet.add(perm);
          if (actor) {
            if (!actorClientRolesMap.has(actor)) actorClientRolesMap.set(actor, new Set());
            actorClientRolesMap.get(actor).add(perm);
          }
        }

        // Client scopes
        for (const scope of (authz.scopesAnyOf || [])) {
          clientScopesSet.add(scope);
        }
      }

      // Register actor even if it has no authorization block, so it gets a test user
      if (actor && !actorRolesMap.has(actor)) {
        actorRolesMap.set(actor, new Set());
      }
    }
  }

  return {
    realmRoles: [...realmRolesSet].sort(),
    clientRoles: [...clientRolesSet].sort(),
    clientScopes: [...clientScopesSet].sort(),
    actorRolesMap,
    actorClientRolesMap,
  };
}

/**
 * Builds the test users array — one user per unique actor.
 *
 * @param {Map} actorRolesMap        actor → Set<realmRole>
 * @param {Map} actorClientRolesMap  actor → Set<clientRole>
 * @returns {{ username: string, password: string, realmRoles: string[], clientRoles: string[] }[]}
 */
function buildTestUsers(actorRolesMap, actorClientRolesMap) {
  const users = [];
  for (const [actor, roles] of actorRolesMap.entries()) {
    users.push({
      username: actor,
      password: `${actor}123`,
      realmRoles: [...roles].sort(),
      clientRoles: [...(actorClientRolesMap.get(actor) || new Set())].sort(),
    });
  }
  return users;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Generates keycloak/realm-export.json at the root of the output directory.
 * Skips silently if authProvider is not 'keycloak'.
 *
 * @param {object[]} allBcYamls
 * @param {object}   resolvedConfig  - dsl-springboot.json (packageName, systemName, authProvider)
 * @param {string}   outputDir
 */
async function generateKeycloakRealm(allBcYamls, resolvedConfig, outputDir) {
  if (resolvedConfig.authProvider !== 'keycloak') return;

  const systemName = resolvedConfig.systemName;
  const realmName = systemName.toLowerCase().replace(/[_\s]/g, '-');
  const publicClientId = `${realmName}-app`;
  const confidentialClientId = `${realmName}-service`;
  const confidentialClientSecret = `${realmName}-secret`;

  const { realmRoles, clientRoles, clientScopes, actorRolesMap, actorClientRolesMap } =
    collectAuthData(allBcYamls);

  const testUsers = buildTestUsers(actorRolesMap, actorClientRolesMap);

  const ctx = {
    realmName,
    publicClientId,
    confidentialClientId,
    confidentialClientSecret,
    realmRoles,
    clientRoles,
    clientScopes,
    testUsers,
  };

  const templateSrc = path.join(KEYCLOAK_TEMPLATES_DIR, 'realm-export.json.ejs');
  const content = await renderTemplate(templateSrc, ctx);

  const outputPath = path.join(outputDir, 'keycloak', 'realm-export.json');
  await fs.outputFile(outputPath, content, 'utf-8');
  logger.success(`Keycloak realm export generated → keycloak/realm-export.json (realm: ${realmName}, users: ${testUsers.map((u) => u.username).join(', ') || 'none'})`);
}

module.exports = { generateKeycloakRealm };
