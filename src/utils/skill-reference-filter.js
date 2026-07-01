'use strict';

/**
 * Skill reference filter — condiciona el contenido de las referencias de las skills
 * de Fase 3 al stack realmente seleccionado por el usuario en el `build`.
 *
 * Las referencias `.md` marcan los bloques específicos de tecnología con comentarios
 * HTML (invisibles al render markdown):
 *
 *   <!-- stack:database=postgresql -->
 *   ### PostgreSQL
 *   ...
 *   <!-- /stack -->
 *
 * Al deployar, `filterStackMarkers` conserva el interior de un bloque solo si el valor
 * seleccionado para esa dimensión está en la lista del marcador; en caso contrario
 * elimina el bloque completo. El texto fuera de cualquier bloque pasa intacto.
 *
 * Determinístico y sin inferencia: si un marcador está mal formado, anidado o usa una
 * dimensión desconocida, se lanza un error (fail-fast) en vez de producir salida
 * silenciosamente incorrecta.
 */

const fs = require('fs-extra');
const path = require('path');

// Mapeo dimensión del marcador → campo de resolvedConfig.
const DIMENSION_TO_CONFIG_FIELD = {
  database: 'database',
  broker: 'broker',
  auth: 'authProvider',
  storage: 'storageProvider',
  cache: 'cacheProvider',
};

const OPEN_RE = /^\s*<!--\s*stack:([a-zA-Z]+)=([a-zA-Z0-9,_-]+)\s*-->\s*$/;
const CLOSE_RE = /^\s*<!--\s*\/stack\s*-->\s*$/;

/**
 * Filtra los bloques `<!-- stack:dim=val -->` de un contenido markdown según la config.
 *
 * @param {string} content - contenido markdown original
 * @param {object} config - resolvedConfig con database/broker/authProvider/storageProvider/cacheProvider
 * @returns {string} contenido filtrado
 * @throws {Error} si hay marcadores mal formados, anidados o de dimensión desconocida
 */
function filterStackMarkers(content, config) {
  const lines = content.split('\n');
  const out = [];
  let block = null; // { dimension, values: [], keep: bool, lineNo }

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const openMatch = line.match(OPEN_RE);
    const closeMatch = CLOSE_RE.test(line);

    if (openMatch) {
      if (block) {
        throw new Error(
          `skill-reference-filter: marcador stack anidado en línea ${lineNo} ` +
            `(bloque abierto en línea ${block.lineNo} sin cerrar)`
        );
      }
      const dimension = openMatch[1];
      const field = DIMENSION_TO_CONFIG_FIELD[dimension];
      if (!field) {
        throw new Error(
          `skill-reference-filter: dimensión desconocida "${dimension}" en línea ${lineNo}. ` +
            `Dimensiones válidas: ${Object.keys(DIMENSION_TO_CONFIG_FIELD).join(', ')}`
        );
      }
      const values = openMatch[2].split(',').map((v) => v.trim()).filter(Boolean);
      const selected = config ? config[field] : undefined;
      const keep = selected != null && values.includes(String(selected));
      block = { dimension, values, keep, lineNo };
      return; // no emitir la línea del marcador de apertura
    }

    if (closeMatch) {
      if (!block) {
        throw new Error(
          `skill-reference-filter: marcador de cierre </stack> sin apertura en línea ${lineNo}`
        );
      }
      block = null;
      return; // no emitir la línea del marcador de cierre
    }

    if (block) {
      if (block.keep) out.push(line);
      return; // bloque descartado: se omite la línea
    }

    out.push(line);
  });

  if (block) {
    throw new Error(
      `skill-reference-filter: bloque stack abierto en línea ${block.lineNo} sin marcador de cierre`
    );
  }

  // Colapsa runs de 3+ saltos de línea (que quedan al eliminar un bloque entre
  // líneas en blanco) a un máximo de 2, para no acumular espacios en blanco.
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Aplica filterStackMarkers a todos los `.md` bajo un directorio (recursivo),
 * reescribiendo cada archivo in-place. Sigue el patrón de rewriteConventionRefsInDir.
 *
 * @param {string} dir - directorio raíz a recorrer
 * @param {object} config - resolvedConfig
 */
async function filterStackMarkersInDir(dir, config) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await filterStackMarkersInDir(full, config);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const original = await fs.readFile(full, 'utf8');
      const filtered = filterStackMarkers(original, config);
      if (filtered !== original) {
        await fs.writeFile(full, filtered, 'utf8');
      }
    }
  }
}

module.exports = { filterStackMarkers, filterStackMarkersInDir, DIMENSION_TO_CONFIG_FIELD };
