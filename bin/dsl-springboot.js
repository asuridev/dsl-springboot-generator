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

// ── Commands ──────────────────────────────────────────────────────────────────
const { buildCommand } = require('../src/commands/build');

program
  .command('build')
  .description('Generate a complete Spring Boot project from arch/ YAML artifacts')
  .action(buildCommand);

program.parse(process.argv);
