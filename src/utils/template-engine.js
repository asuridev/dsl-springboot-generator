'use strict';

const ejs = require('ejs');
const fs = require('fs-extra');
const path = require('path');
const prettier = require('prettier');
const javaPlugin = require('prettier-plugin-java').default;
const chalk = require('chalk');

const PRETTIER_JAVA_OPTIONS = {
  parser: 'java',
  plugins: [javaPlugin],
  tabWidth: 4,
  printWidth: 120,
  trailingComma: 'none',
  endOfLine: 'lf',
};

/**
 * Render an EJS template file with the given context.
 * @param {string} templatePath
 * @param {object} context
 * @returns {Promise<string>}
 */
async function renderTemplate(templatePath, context) {
  const templateContent = await fs.readFile(templatePath, 'utf-8');
  return ejs.render(templateContent, context, { filename: templatePath });
}

/**
 * Render an EJS template and write the result to destPath.
 * Java files are formatted with Prettier before writing.
 * @param {string} templatePath
 * @param {string} destPath
 * @param {object} context
 * @returns {Promise<void>}
 */
async function renderAndWrite(templatePath, destPath, context) {
  let content = await renderTemplate(templatePath, context);

  if (destPath.endsWith('.java')) {
    try {
      content = await prettier.format(content, PRETTIER_JAVA_OPTIONS);
    } catch (e) {
      console.warn(chalk.yellow(`[prettier] Could not format ${path.basename(destPath)}: ${e.message}`));
    }
  }

  await fs.ensureDir(path.dirname(destPath));
  await fs.writeFile(destPath, content, 'utf-8');

  const rel = path.relative(process.cwd(), destPath);
  console.log(chalk.green('  write') + '  ' + rel);
}

/**
 * Get all .ejs template file paths recursively under dir.
 * @param {string} dir
 * @param {Array<string>} [fileList]
 * @returns {Promise<Array<string>>}
 */
async function getTemplateFiles(dir, fileList = []) {
  const files = await fs.readdir(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      await getTemplateFiles(filePath, fileList);
    } else if (file.endsWith('.ejs')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

module.exports = { renderTemplate, renderAndWrite, getTemplateFiles };
