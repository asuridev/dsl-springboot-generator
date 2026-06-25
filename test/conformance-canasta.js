#!/usr/bin/env node
'use strict';

/**
 * GAP-4 — Cross-phase conformance guard.
 *
 * Runs the canonical Phase-1 design example (dsl-design-system/examples/
 * canasta-familiar) through this generator's `build --strict` and asserts it
 * succeeds. The example is the design system's source of truth; running it here
 * turns it into a permanent anti-drift guard: if Phase 1 and Phase 2 diverge on
 * the YAML contract (e.g. a validation rule that one accepts and the other
 * rejects), this test fails.
 *
 * The example lives in the sibling repo `dsl-design-system`. When that repo is
 * not checked out alongside this one (e.g. an isolated CI clone), the test SKIPS
 * with a clear notice rather than failing — the guard is only meaningful when
 * both phases are present.
 *
 * The `arch/review/` directory is never copied or read (CLAUDE.md rule).
 *
 * Usage:
 *   node test/conformance-canasta.js
 *   node test/conformance-canasta.js --verbose
 */

const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const { spawnSync } = require('child_process');

const verbose = process.argv.includes('--verbose');
const generatorRoot = path.join(__dirname, '..');

// Sibling design-system repo holding the canonical example.
const exampleArch = path.join(
  generatorRoot, '..', 'dsl-design-system', 'examples', 'canasta-familiar', 'arch'
);

// Fixed configuration matching the example's declared infrastructure
// (system.yaml: messageBroker, authServer, reliability.consumerIdempotency,
// objectStorage). Technology choices are resolved here, at the generator phase.
const CONFIG = {
  packageName: 'com.canasta',
  javaVersion: '21',
  springBootVersion: '3.4.5',
  database: 'postgresql',
  broker: 'kafka',
  authProvider: 'keycloak',
  storageProvider: 'minio',
  cacheProvider: 'redis',
  systemName: 'canasta-familiar',
};

// Anti-drift spot-checks on the generated output that exercise GAP-6 (mixed
// multipart: a File part + typed form-data parts in UC-CAT-011 AddProductImage).
const OUTPUT_ASSERTIONS = [
  {
    rel: 'src/main/java/com/canasta/catalog/infrastructure/rest/controllers/product/v1/ProductV1Controller.java',
    contains: [
      'consumes = MediaType.MULTIPART_FORM_DATA_VALUE',
      '@RequestPart(value = "image") MultipartFile image',
      '@RequestParam(value = "imageType") ImageType imageType',
    ],
  },
];

async function copyArchExcludingReview(srcArch, destArch) {
  await fs.copy(srcArch, destArch, {
    filter: (src) => {
      // Skip the in-review directory and anything under it.
      const rel = path.relative(srcArch, src);
      const segments = rel.split(path.sep);
      return !segments.includes('review');
    },
  });
}

async function main() {
  if (!(await fs.pathExists(exampleArch))) {
    console.log('');
    console.log('Conformance (canasta-familiar) — SKIPPED');
    console.log(`  Sibling design-system example not found at: ${exampleArch}`);
    console.log('  Check out dsl-design-system alongside this repo to enable the guard.');
    return; // exit 0 — nothing to guard against in isolation.
  }

  console.log('');
  console.log('Conformance (canasta-familiar) — running build --strict on the canonical Phase-1 example');

  let tmpDir = null;
  try {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsl-conformance-canasta-'));
    await copyArchExcludingReview(exampleArch, path.join(tmpDir, 'arch'));

    // Belt-and-suspenders: the review/ dir must never have been copied.
    const leakedReview = await fs.pathExists(path.join(tmpDir, 'arch', 'review'));
    if (leakedReview) {
      console.error('  ✗ FAIL — arch/review/ was copied into the working tree (must be excluded).');
      process.exit(1);
    }

    await fs.writeJson(path.join(tmpDir, 'dsl-springboot.json'), CONFIG, { spaces: 2 });

    const result = spawnSync(
      process.execPath,
      [path.join(generatorRoot, 'bin', 'dsl-springboot.js'), 'build', '--strict'],
      { cwd: tmpDir, encoding: 'utf8', env: { ...process.env } }
    );

    const output = (result.stdout || '') + (result.stderr || '');
    if (verbose) process.stdout.write(output);

    if (result.status !== 0) {
      console.error(`  ✗ FAIL — build --strict exited with code ${result.status}`);
      output
        .split('\n')
        .filter((l) => l.includes('INT-') || l.includes('HTTP-') || l.toLowerCase().includes('error'))
        .slice(0, 12)
        .forEach((l) => console.error(`    ${l.trim()}`));
      process.exit(1);
    }

    // Spot-check the generated output (GAP-6 multipart artifacts).
    const errors = [];
    for (const a of OUTPUT_ASSERTIONS) {
      const filePath = path.join(tmpDir, ...a.rel.split('/'));
      if (!(await fs.pathExists(filePath))) {
        errors.push(`Missing generated file: ${a.rel}`);
        continue;
      }
      const content = await fs.readFile(filePath, 'utf8');
      for (const needle of a.contains) {
        if (!content.includes(needle)) {
          errors.push(`${a.rel}: missing text → "${needle}"`);
        }
      }
    }

    if (errors.length > 0) {
      console.error('  ✗ FAIL — build succeeded but output assertions failed:');
      errors.forEach((e) => console.error(`    • ${e}`));
      process.exit(1);
    }

    console.log('  ✓ PASS — canonical example builds under --strict; multipart artifacts present.');
  } finally {
    if (tmpDir) await fs.remove(tmpDir).catch(() => {});
  }
}

main().catch((err) => {
  console.error(`\nConformance runner error: ${err.message}`);
  process.exit(1);
});
