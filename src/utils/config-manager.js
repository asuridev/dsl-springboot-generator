'use strict';

const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

const CONFIG_FILE = 'dsl-springboot.json';

/**
 * Returns the absolute path to the config file in CWD.
 */
function getConfigPath() {
  return path.join(process.cwd(), CONFIG_FILE);
}

/**
 * Returns true if dsl-springboot.json exists in CWD.
 */
async function configExists() {
  return fs.pathExists(getConfigPath());
}

/**
 * Reads and parses dsl-springboot.json from CWD.
 * Throws if the file does not exist.
 * @returns {Promise<{packageName: string, javaVersion: string, springBootVersion: string, systemName: string}>}
 */
async function readConfig() {
  const configPath = getConfigPath();
  if (!(await fs.pathExists(configPath))) {
    throw new Error(`Configuration file "${CONFIG_FILE}" not found. Run "dsl-springboot build" to create it.`);
  }
  const raw = await fs.readFile(configPath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Writes the config object to dsl-springboot.json in CWD.
 * @param {{packageName: string, javaVersion: string, springBootVersion: string, systemName: string}} config
 */
async function writeConfig(config) {
  const configPath = getConfigPath();
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  logger.success(`Configuration saved to ${CONFIG_FILE}`);
}

module.exports = { configExists, readConfig, writeConfig };
