'use strict';

const chalk = require('chalk');

const logger = {
  info: (message) => console.log(chalk.blue('ℹ'), message),
  success: (message) => console.log(chalk.green('✔'), message),
  warn: (message) => console.log(chalk.yellow('⚠'), message),
  error: (message) => console.error(chalk.red('✖'), message),
};

module.exports = logger;
