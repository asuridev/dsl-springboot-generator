'use strict';

/**
 * SQL dialect abstraction for the generated Flyway migrations.
 *
 * The reliability/outbox/idempotency/async-job migration templates (V1–V4) ship
 * a fixed set of columns whose physical SQL types and DDL guard syntax differ per
 * database engine. This module is the single source of truth for those tokens so
 * the EJS templates stay engine-agnostic: they reference `sql.<token>` and
 * `sql.createTable(...)` / `sql.createIndex(...)` instead of hardcoded literals.
 *
 * Canonical-type → SQL mapping for *dynamic* projection columns lives in
 * `type-mapper.js` (`mapToSqlType`); this module only covers the static tables.
 */

const DIALECTS = {
  postgresql: {
    uuid: 'UUID',
    text: 'TEXT',
    bytea: 'BYTEA',
    timestamp: 'TIMESTAMP',
    integer: 'INTEGER',
    bigint: 'BIGINT',
    boolean: 'BOOLEAN',
    varchar: (n) => `VARCHAR(${n})`,
    createTable: (name) => `CREATE TABLE IF NOT EXISTS ${name}`,
    createIndex: (idx, table, cols) => `CREATE INDEX IF NOT EXISTS ${idx} ON ${table} (${cols})`,
  },
  mysql: {
    uuid: 'CHAR(36)',
    text: 'LONGTEXT',
    bytea: 'LONGBLOB',
    timestamp: 'DATETIME',
    integer: 'INT',
    bigint: 'BIGINT',
    boolean: 'TINYINT(1)',
    varchar: (n) => `VARCHAR(${n})`,
    createTable: (name) => `CREATE TABLE IF NOT EXISTS ${name}`,
    // MySQL has no portable `CREATE INDEX IF NOT EXISTS`; Flyway versioning makes
    // a plain CREATE INDEX safe (each migration runs exactly once).
    createIndex: (idx, table, cols) => `CREATE INDEX ${idx} ON ${table} (${cols})`,
  },
  sqlserver: {
    uuid: 'UNIQUEIDENTIFIER',
    text: 'NVARCHAR(MAX)',
    bytea: 'VARBINARY(MAX)',
    timestamp: 'DATETIME2',
    integer: 'INT',
    bigint: 'BIGINT',
    boolean: 'BIT',
    varchar: (n) => `NVARCHAR(${n})`,
    createTable: (name) => `IF OBJECT_ID(N'${name}', N'U') IS NULL\nCREATE TABLE ${name}`,
    createIndex: (idx, table, cols) =>
      `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${idx}' AND object_id = OBJECT_ID('${table}'))\n    CREATE INDEX ${idx} ON ${table} (${cols})`,
  },
  oracle: {
    uuid: 'RAW(16)',
    text: 'CLOB',
    bytea: 'BLOB',
    timestamp: 'TIMESTAMP',
    integer: 'NUMBER(10)',
    bigint: 'NUMBER(19)',
    boolean: 'NUMBER(1)',
    varchar: (n) => `VARCHAR2(${n})`,
    // Oracle has no `IF NOT EXISTS`; Flyway versioning guarantees once-only DDL.
    createTable: (name) => `CREATE TABLE ${name}`,
    createIndex: (idx, table, cols) => `CREATE INDEX ${idx} ON ${table} (${cols})`,
  },
};

/**
 * Returns the dialect token bundle for a database id.
 * H2 runs in PostgreSQL compatibility mode (MODE=PostgreSQL), so it reuses the
 * PostgreSQL tokens. Unknown ids fall back to PostgreSQL.
 *
 * @param {string} dbId
 * @returns {object}
 */
function getSqlDialect(dbId) {
  if (dbId === 'h2') return DIALECTS.postgresql;
  return DIALECTS[dbId] || DIALECTS.postgresql;
}

/**
 * Physical column types used inside JPA `@Column(columnDefinition = ...)` of the
 * *generated entities* (not the Flyway migrations). Hibernate emits these verbatim
 * in ddl-auto, so they must be engine-valid.
 *
 *  - `text`: the large-text type for unbounded String/Text/Url fields.
 *  - `uuid`: type for UUID ids; `null` means OMIT columnDefinition entirely so
 *    Hibernate's dialect default applies (uniqueidentifier on SQL Server,
 *    raw(16) on Oracle, binary on MySQL) — safer than forcing a type that could
 *    disagree with Hibernate's JDBC binding.
 *
 * PostgreSQL values are kept byte-identical to the pre-existing generator output
 * (`TEXT` / `uuid`) so existing golden snapshots do not churn.
 *
 * @param {string} dbId
 * @returns {{text: string, uuid: (string|null)}}
 */
const JPA_COLUMN_TYPES = {
  postgresql: { text: 'TEXT', uuid: 'uuid' },
  mysql: { text: 'LONGTEXT', uuid: null },
  sqlserver: { text: 'NVARCHAR(MAX)', uuid: null },
  oracle: { text: 'CLOB', uuid: null },
};

function getJpaColumnTypes(dbId) {
  if (dbId === 'h2') return JPA_COLUMN_TYPES.postgresql;
  return JPA_COLUMN_TYPES[dbId] || JPA_COLUMN_TYPES.postgresql;
}

/**
 * FK-safe TRUNCATE/DELETE statements for the generated `reset-db.sh`, which wipes
 * the domain (and idempotency/outbox) tables between flow-validation runs so the
 * `Given` preconditions hold again. `flyway_schema_history` is never listed, so the
 * schema survives.
 *
 * `tables` must be ordered child→parent (collection/child tables before aggregate
 * roots). Only the Oracle branch relies on that ordering; PostgreSQL cascades and
 * MySQL/SQL Server disable FK enforcement, so they are order-independent. H2 reuses
 * the PostgreSQL form (PostgreSQL compatibility mode).
 *
 * @param {string} dbId
 * @param {string[]} tables  physical table names, child→parent order
 * @returns {string[]} SQL statements to pipe to the engine CLI (empty when no tables)
 */
function getTruncateStatements(dbId, tables) {
  if (!Array.isArray(tables) || tables.length === 0) return [];
  const id = dbId === 'h2' ? 'postgresql' : dbId;
  switch (id) {
    case 'mysql':
      return [
        'SET FOREIGN_KEY_CHECKS = 0;',
        ...tables.map((t) => `TRUNCATE TABLE ${t};`),
        'SET FOREIGN_KEY_CHECKS = 1;',
      ];
    case 'sqlserver':
      // TRUNCATE is rejected on FK-referenced tables → DELETE with constraints
      // disabled, then re-enable. Order-independent thanks to NOCHECK.
      return [
        ...tables.map((t) => `ALTER TABLE ${t} NOCHECK CONSTRAINT ALL;`),
        ...tables.map((t) => `DELETE FROM ${t};`),
        ...tables.map((t) => `ALTER TABLE ${t} WITH CHECK CHECK CONSTRAINT ALL;`),
      ];
    case 'oracle':
      // Oracle has no portable session-wide FK toggle; delete child→parent
      // (tables arrive in that order) so FK constraints stay satisfied.
      return tables.map((t) => `DELETE FROM ${t};`);
    case 'postgresql':
    default:
      return [`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE;`];
  }
}

module.exports = { getSqlDialect, getJpaColumnTypes, getTruncateStatements };
