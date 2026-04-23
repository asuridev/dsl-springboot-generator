'use strict';

const pluralize = require('pluralize');

function toPascalCase(str) {
  return str
    .replace(/[-_\s]+(.)?/g, (_, char) => (char ? char.toUpperCase() : ''))
    .replace(/^(.)/, (char) => char.toUpperCase());
}

function toCamelCase(str) {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toSnakeCase(str) {
  return str
    .replace(/([A-Z])/g, '_$1')
    .replace(/[-\s]+/g, '_')
    .replace(/^_/, '')
    .toLowerCase();
}

function toKebabCase(str) {
  return str
    .replace(/([A-Z])/g, '-$1')
    .replace(/[\s_]+/g, '-')
    .replace(/^-/, '')
    .toLowerCase();
}

function toScreamingSnakeCase(str) {
  return toSnakeCase(str).toUpperCase();
}

function pluralizeWord(word) {
  return pluralize(word);
}

function singularizeWord(word) {
  return pluralize.singular(word);
}

function toPackagePath(packageName) {
  return packageName.replace(/\./g, '/');
}

/**
 * Get base JPA entity class based on aggregate flags.
 * Matches the shared infrastructure classes generated in SP-2.
 */
function getBaseEntity(hasSoftDelete, hasAudit) {
  if (hasSoftDelete || hasAudit) {
    return 'FullAuditableEntity';
  }
  return 'BaseEntity';
}

function artifactIdToPackageName(artifactId) {
  return artifactId
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function getApplicationClassName(artifactId) {
  return toPascalCase(artifactId) + 'Application';
}

function getFullPackageName(groupId, artifactId) {
  const packagePart = artifactIdToPackageName(artifactId);
  return `${groupId}.${packagePart}`;
}

function isAllTypeQuery(usecaseName) {
  const allPatterns = ['FindAll', 'GetAll', 'ListAll', 'SearchAll', 'RetrieveAll'];
  return allPatterns.some((pattern) => usecaseName.startsWith(pattern));
}

module.exports = {
  toPascalCase,
  toCamelCase,
  toSnakeCase,
  toKebabCase,
  toScreamingSnakeCase,
  pluralizeWord,
  singularizeWord,
  toPackagePath,
  getBaseEntity,
  artifactIdToPackageName,
  getApplicationClassName,
  getFullPackageName,
  isAllTypeQuery,
};
