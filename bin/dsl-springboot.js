#!/usr/bin/env node

'use strict';

const { Command } = require('commander');
const chalk = require('chalk');
const packageJson = require('../package.json');

const program = new Command();

program
  .name('dsl-springboot')
  .description(chalk.blue('CLI for generating Spring Boot projects with modular hexagonal architecture'))
  .version(packageJson.version, '-v, --version', 'Output the current version');

// Commands will be registered here as they are implemented

program.parse(process.argv);
