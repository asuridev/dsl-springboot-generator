'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPascalCase, toPackagePath } = require('../utils/naming');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

/**
 * Generate object-storage artifacts (Fase 2): for each declared store, a
 * provider-agnostic output port (in the owning BC's application/ports) and a
 * MinIO (S3-compatible) adapter implementing it (in infrastructure/adapters/storage).
 *
 * The shared StoredObject VO and StorageConfig (S3Client/S3Presigner beans) are
 * emitted by the base-project generator; this generator only emits per-store code.
 *
 * @param {object} system  - parsed system.yaml (system.objectStorage[])
 * @param {object} config  - resolved dsl-springboot.json config (config.storageProvider)
 * @param {string} outputDir
 * @returns {Promise<{count: number}>} number of stores wired
 */
async function generateStorageArtifacts(system, config, outputDir) {
  const stores = Array.isArray(system.objectStorage) ? system.objectStorage : [];
  if (stores.length === 0) return { count: 0 };

  // Only MinIO is supported as the storage provider today.
  const provider = config.storageProvider || null;
  if (provider && provider !== 'minio') {
    throw new Error(
      `[storage-generator] storageProvider "${provider}" is not supported. ` +
        'Only "minio" is implemented in this version.'
    );
  }

  const packagePath = toPackagePath(config.packageName);

  for (const store of stores) {
    const bc = store.ownedBy;
    if (!bc) {
      throw new Error(
        `[storage-generator] objectStorage "${store.name}" has no "ownedBy" BC; ` +
          'cannot place its port/adapter deterministically.'
      );
    }

    const storePascal = toPascalCase(store.name);
    const portName = `${storePascal}StoragePort`;
    const adapterName = `${storePascal}MinioStorageAdapter`;

    const ctx = {
      packageName: config.packageName,
      bc,
      storeName: store.name,
      visibility: store.visibility,
      urlAccess: store.urlAccess,
      signedUrlTtl: store.signedUrlTtl,
      portName,
      adapterName,
    };

    // Output port — application/ports of the owning BC
    const portDir = path.join(
      outputDir, 'src', 'main', 'java', packagePath, bc, 'application', 'ports'
    );
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'application', 'StoragePort.java.ejs'),
      path.join(portDir, `${portName}.java`),
      ctx
    );

    // MinIO adapter — infrastructure/adapters/storage of the owning BC
    const adapterDir = path.join(
      outputDir, 'src', 'main', 'java', packagePath, bc, 'infrastructure', 'adapters', 'storage'
    );
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'infrastructure', 'adapters', 'storage', 'MinioStorageAdapter.java.ejs'),
      path.join(adapterDir, `${adapterName}.java`),
      ctx
    );
  }

  return { count: stores.length };
}

module.exports = { generateStorageArtifacts };
