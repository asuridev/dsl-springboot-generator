'use strict';

/**
 * Helpers para emitir literales de String de Java de forma segura.
 *
 * Cualquier texto proveniente del YAML (mensajes de error, patrones de validación,
 * partName/contentTypes de multipart, etc.) que se interpole en código Java debe
 * escaparse: un `"`, un `\` o un salto de línea sin escapar produce un literal de
 * String sin terminar y el proyecto generado no compila.
 */

/**
 * Escapa el contenido de un String para colocarlo DENTRO de un literal Java ya
 * delimitado por comillas (no añade las comillas). Cubre backslash, comilla doble
 * y los caracteres de control habituales.
 *
 * @param {*} str
 * @returns {string}
 */
function escapeJavaString(str) {
  return String(str == null ? '' : str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Devuelve un literal de String de Java completo (con comillas) a partir de un
 * valor arbitrario, escapando su contenido.
 *
 * @param {*} str
 * @returns {string}
 */
function javaStringLiteral(str) {
  return `"${escapeJavaString(str)}"`;
}

module.exports = { escapeJavaString, javaStringLiteral };
