#!/usr/bin/env node
'use strict';

/**
 * Test scenario runner for dsl-springboot-generator.
 *
 * Usage:
 *   node test/runner.js                        # run all scenarios
 *   node test/runner.js --scenario ext-full    # run one scenario
 *   node test/runner.js --accept               # accept generated output as golden files
 *   node test/runner.js --verbose              # print build output
 *   node test/runner.js --compile              # compile generated Java for successful scenarios
 *
 * Workflow:
 *   1. First run with --accept creates expected/ golden files from generated output.
 *   2. You inspect expected/ manually to confirm correctness.
 *   3. Subsequent runs without --accept compare against expected/ and run assertions.
 */

const path = require('path');
const fs = require('fs-extra');
const { runScenario } = require('./utils/scenario-runner');

const args = process.argv.slice(2);
const acceptMode = args.includes('--accept');
const verboseMode = args.includes('--verbose');
const compileMode = args.includes('--compile');

const scenarioIdx = args.indexOf('--scenario');
const targetScenario = scenarioIdx >= 0 ? args[scenarioIdx + 1] : null;

const scenariosDir = path.join(__dirname, 'scenarios');
const generatorRoot = path.join(__dirname, '..');

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!(await fs.pathExists(scenariosDir))) {
    console.error(`No scenarios directory found at: ${scenariosDir}`);
    process.exit(1);
  }

  const entries = await fs.readdir(scenariosDir, { withFileTypes: true });
  const scenarios = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !targetScenario || name === targetScenario)
    .sort();

  if (scenarios.length === 0) {
    const msg = targetScenario
      ? `Scenario "${targetScenario}" not found in test/scenarios/`
      : 'No scenario directories found in test/scenarios/';
    console.error(msg);
    process.exit(1);
  }

  console.log('');
  console.log(`DSL Springboot Generator — Scenario Tests`);
  if (acceptMode) console.log('Mode: ACCEPT (generating golden files)');
  if (compileMode) console.log('Mode: COMPILE (forcing generated Java compilation)');
  console.log(`Scenarios: ${scenarios.join(', ')}`);

  const results = [];
  const startAll = Date.now();

  for (const name of scenarios) {
    const scenarioDir = path.join(scenariosDir, name);
    const divider = '─'.repeat(58);

    console.log(`\n${divider}`);
    console.log(`  ${name}${acceptMode ? '  [ACCEPT]' : ''}`);
    console.log(divider);

    const start = Date.now();
    let result;

    try {
      result = await runScenario({
        name,
        scenarioDir,
        generatorRoot,
        accept: acceptMode,
        verbose: verboseMode,
        forceCompile: compileMode,
      });
    } catch (err) {
      result = { passed: false, errors: [`Unexpected runner error: ${err.message}`], accepted: 0 };
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    results.push({ name, ...result, elapsed });

    if (result.passed) {
      if (acceptMode && result.accepted > 0) {
        console.log(`  ✓ ACCEPTED  (${result.accepted} files → expected/)  ${elapsed}s`);
      } else {
        console.log(`  ✓ PASS  ${elapsed}s`);
      }
    } else {
      console.log(`  ✗ FAIL  ${elapsed}s`);
      for (const msg of result.errors) {
        console.log(`    • ${msg}`);
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalElapsed = ((Date.now() - startAll) / 1000).toFixed(1);
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  console.log(`\n${'═'.repeat(58)}`);
  console.log(`  ${passed}/${results.length} passed  (${totalElapsed}s)`);
  if (failed > 0) {
    console.log(`  Failed: ${results.filter((r) => !r.passed).map((r) => r.name).join(', ')}`);
  }
  console.log(`${'═'.repeat(58)}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nFatal runner error: ${err.message}`);
  process.exit(1);
});
