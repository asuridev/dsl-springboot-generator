'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toSnakeCase, toKebabCase, toPackagePath } = require('../utils/naming');
const { mapType, mapToPostgres, isListType } = require('../utils/type-mapper');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function isPersistent(p) {
  return !!(p && p.persistent === true);
}

function buildColumnAnnotation(prop) {
  const attrs = [`name = "${toSnakeCase(prop.name)}"`];
  const type = prop.type;
  if (type === 'String' || type === 'Text' || type === 'Url') {
    attrs.push('columnDefinition = "TEXT"');
  } else if (type === 'Email') {
    attrs.push('length = 254');
  } else if (/^String\(\d+\)$/.test(type)) {
    const n = parseInt(type.match(/\d+/)[0], 10);
    attrs.push(`length = ${n}`);
  } else if (type === 'Decimal') {
    const precision = prop.precision || 19;
    const scale = prop.scale || 4;
    attrs.push(`precision = ${precision}, scale = ${scale}`);
  }
  if (prop.required === true) attrs.push('nullable = false');
  return `@Column(${attrs.join(', ')})`;
}

/**
 * Resolve a projection's property type to JPA-compatible info, rejecting types
 * that cannot be persisted as a single column (List[T], domain VOs, enums other
 * than canonical types, etc.).
 */
function resolveJpaField(prop, projectionName, bcName) {
  if (isListType(prop.type)) {
    throw new Error(
      `Persistent projection ${bcName}.${projectionName}: property "${prop.name}" of type ${prop.type} ` +
      `is not supported (List<T> requires a join table — out of scope for Phase 3).`
    );
  }
  let mapped;
  try {
    mapped = mapType(prop.type, prop);
  } catch (err) {
    throw new Error(
      `Persistent projection ${bcName}.${projectionName}: property "${prop.name}" type "${prop.type}" — ${err.message}`
    );
  }
  if (mapped.isDomainType) {
    throw new Error(
      `Persistent projection ${bcName}.${projectionName}: property "${prop.name}" type "${prop.type}" ` +
      `is a domain type. Persistent projections only accept canonical scalar types (Uuid, String(n), Integer, Long, Decimal, Boolean, Date, DateTime, Email, Url).`
    );
  }
  if (prop.type === 'Money') {
    throw new Error(
      `Persistent projection ${bcName}.${projectionName}: property "${prop.name}" of type Money is not supported (would require multi-column expansion).`
    );
  }
  return mapped;
}

/**
 * Returns the queue/topic key used for a persistent projection's updater listener.
 * Distinct from the dispatch listener's queueKey to allow both to coexist.
 */
function projectionQueueKey(bcName, projectionName, sourceEvent) {
  const projKebab = toKebabCase(projectionName);
  const evtKebab = toKebabCase(sourceEvent);
  return `${bcName}-projection-${projKebab}-${evtKebab}`;
}

/**
 * Generates persistent-projection artifacts for every BC.
 *
 * Emits per persistent projection:
 *   - {Name}Jpa.java
 *   - {Name}JpaRepository.java
 *   - {Name}ProjectionUpdater.java (Rabbit or Kafka, depending on broker)
 * Emits once globally if any persistent projection exists:
 *   - src/main/resources/db/migration/V2__projections.sql
 *
 * @param {Array<object>} allBcYamls
 * @param {object} system
 * @param {object} config
 * @param {string} outputDir
 * @returns {Promise<{count: number, persistentProjections: Array<{bcName, projectionName, queueKey, sourceFromBc, sourceEvent}>}>}
 */
async function generateProjectionUpdaters(allBcYamls, system, config, outputDir) {
  const { packageName, broker } = config;
  const packagePath = toPackagePath(packageName);
  const javaMainDir = path.join(outputDir, 'src', 'main', 'java', packagePath);
  const resourcesDir = path.join(outputDir, 'src', 'main', 'resources');

  const persistentProjections = [];
  const sqlEntries = [];

  for (const bcYaml of allBcYamls) {
    const bcName = bcYaml.bc;
    const projections = (bcYaml.projections || []).filter(isPersistent);
    if (projections.length === 0) continue;

    const bcDir = path.join(javaMainDir, bcName);

    for (const proj of projections) {
      // ── Validate required fields ───────────────────────────────────────
      if (!proj.source || proj.source.kind !== 'event' || !proj.source.event || !proj.source.from) {
        throw new Error(
          `Persistent projection ${bcName}.${proj.name}: requires source: { kind: event, event: <Name>, from: <bc> }.`
        );
      }
      if (!proj.keyBy) {
        throw new Error(`Persistent projection ${bcName}.${proj.name}: requires keyBy: <propertyName>.`);
      }
      const upsertStrategy = proj.upsertStrategy || 'lastWriteWins';
      if (upsertStrategy !== 'lastWriteWins' && upsertStrategy !== 'versionGuarded') {
        throw new Error(
          `Persistent projection ${bcName}.${proj.name}: upsertStrategy "${upsertStrategy}" not supported. ` +
          `Use "lastWriteWins" or "versionGuarded".`
        );
      }

      const properties = proj.properties || [];
      const keyProp = properties.find((p) => p.name === proj.keyBy);
      if (!keyProp) {
        throw new Error(
          `Persistent projection ${bcName}.${proj.name}: keyBy "${proj.keyBy}" is not declared in properties[].`
        );
      }

      const keyMapped = resolveJpaField(keyProp, proj.name, bcName);
      const keyJavaType = keyMapped.javaType;
      const keyImport = keyMapped.importHint || null;

      // ── Non-key fields ─────────────────────────────────────────────────
      const imports = new Set();
      imports.add('java.time.Instant');
      if (keyImport) imports.add(keyImport);

      const nonKeyFields = [];
      for (const prop of properties) {
        if (prop.name === proj.keyBy) continue;
        const mapped = resolveJpaField(prop, proj.name, bcName);
        if (mapped.importHint) imports.add(mapped.importHint);
        nonKeyFields.push({
          name: prop.name,
          cap: capitalize(prop.name),
          javaType: mapped.javaType,
          columnAnnotation: buildColumnAnnotation(prop),
        });
      }

      // ── Version field for versionGuarded strategy ──────────────────────
      let versionField = null;
      let versionJavaType = null;
      let versionFieldCap = null;
      if (upsertStrategy === 'versionGuarded') {
        versionField = proj.eventVersionField || (properties.find((p) => p.name === 'version') ? 'version' : null);
        if (!versionField) {
          throw new Error(
            `Persistent projection ${bcName}.${proj.name}: upsertStrategy=versionGuarded requires either ` +
            `eventVersionField: <propertyName> or a property named "version".`
          );
        }
        const vProp = properties.find((p) => p.name === versionField);
        if (!vProp) {
          throw new Error(
            `Persistent projection ${bcName}.${proj.name}: eventVersionField "${versionField}" is not declared in properties[].`
          );
        }
        const vMapped = resolveJpaField(vProp, proj.name, bcName);
        versionJavaType = vMapped.javaType;
        versionFieldCap = capitalize(versionField);
      }

      const tableName = proj.tableName || `proj_${toSnakeCase(proj.name)}`;
      const queueKey = projectionQueueKey(bcName, proj.name, proj.source.event);

      // ── JPA entity ─────────────────────────────────────────────────────
      await renderAndWrite(
        path.join(TEMPLATES_DIR, 'infrastructure', 'projections', 'ProjectionJpa.java.ejs'),
        path.join(bcDir, 'infrastructure', 'persistence', 'projections', `${proj.name}Jpa.java`),
        {
          packageName,
          moduleName: bcName,
          projectionName: proj.name,
          tableName,
          keyByField: proj.keyBy,
          keyColumnName: toSnakeCase(proj.keyBy),
          keyJavaType,
          imports: [...imports].sort(),
          nonKeyFields,
          description: proj.description || null,
          sourceFromBc: proj.source.from,
          sourceEvent: proj.source.event,
          upsertStrategy,
        }
      );

      // ── JPA repository ─────────────────────────────────────────────────
      await renderAndWrite(
        path.join(TEMPLATES_DIR, 'infrastructure', 'projections', 'ProjectionJpaRepository.java.ejs'),
        path.join(bcDir, 'infrastructure', 'persistence', 'projections', `${proj.name}JpaRepository.java`),
        {
          packageName,
          moduleName: bcName,
          projectionName: proj.name,
          keyJavaType,
          keyImport,
        }
      );

      // ── Updater listener ───────────────────────────────────────────────
      const tplName = broker === 'kafka' ? 'ProjectionUpdaterKafka.java.ejs' : 'ProjectionUpdaterRabbit.java.ejs';
      await renderAndWrite(
        path.join(TEMPLATES_DIR, 'infrastructure', 'projections', tplName),
        path.join(bcDir, 'infrastructure', 'projectionUpdaters', `${proj.name}ProjectionUpdater.java`),
        {
          packageName,
          moduleName: bcName,
          projectionName: proj.name,
          queueKey,
          keyByField: proj.keyBy,
          keyByFieldCap: capitalize(proj.keyBy),
          keyJavaType,
          nonKeyFields,
          sourceFromBc: proj.source.from,
          sourceEvent: proj.source.event,
          sourceEventKebab: toKebabCase(proj.source.event),
          upsertStrategy,
          versionField,
          versionJavaType,
          versionFieldCap,
          needsBigDecimal: nonKeyFields.some((f) => f.javaType === 'BigDecimal') || keyJavaType === 'BigDecimal',
          needsLocalDate: nonKeyFields.some((f) => ['LocalDate', 'LocalDateTime'].includes(f.javaType)),
          needsUUID: keyJavaType === 'UUID' || nonKeyFields.some((f) => f.javaType === 'UUID'),
        }
      );

      // ── SQL entry ──────────────────────────────────────────────────────
      const columns = nonKeyFields.map((f) => {
        const orig = properties.find((p) => p.name === f.name);
        return {
          name: toSnakeCase(f.name),
          sqlType: mapToPostgres(orig.type, orig),
          notNull: orig.required === true,
        };
      });
      sqlEntries.push({
        bcName,
        projectionName: proj.name,
        tableName,
        keyColumnName: toSnakeCase(proj.keyBy),
        keySqlType: mapToPostgres(keyProp.type, keyProp),
        columns,
        sourceFromBc: proj.source.from,
        sourceEvent: proj.source.event,
        upsertStrategy,
      });

      persistentProjections.push({
        bcName,
        projectionName: proj.name,
        queueKey,
        sourceFromBc: proj.source.from,
        sourceEvent: proj.source.event,
      });
    }
  }

  if (sqlEntries.length > 0) {
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'base', 'resources', 'db', 'migration', 'V2__projections.sql.ejs'),
      path.join(resourcesDir, 'db', 'migration', 'V2__projections.sql'),
      { projections: sqlEntries }
    );
  }

  return { count: persistentProjections.length, persistentProjections };
}

/**
 * Returns true if any BC declares at least one persistent projection.
 * Used to enable Flyway in base-project-generator without loading bcYamls there.
 */
function hasAnyPersistentProjection(allBcYamls) {
  return allBcYamls.some((bc) => (bc.projections || []).some(isPersistent));
}

module.exports = {
  generateProjectionUpdaters,
  hasAnyPersistentProjection,
  projectionQueueKey,
};
