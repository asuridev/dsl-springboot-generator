'use strict';

const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { spawnSync } = require('child_process');

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Runs a single test scenario.
 *
 * @param {object} opts
 * @param {string} opts.name          - scenario directory name
 * @param {string} opts.scenarioDir   - absolute path to the scenario directory
 * @param {string} opts.generatorRoot - absolute path to the generator root
 * @param {boolean} opts.accept       - if true, copy generated output to expected/
 * @param {boolean} opts.verbose      - if true, print build stdout/stderr
 * @param {boolean} opts.forceCompile - if true, compile generated Java even when scenario config does not opt in
 * @returns {Promise<{passed: boolean, errors: string[], accepted: number}>}
 */
async function runScenario({ name, scenarioDir, generatorRoot, accept, verbose, forceCompile = false }) {
  const errors = [];
  let tmpDir = null;

  // ── Load optional scenario config ─────────────────────────────────────────
  const scenarioConfigPath = path.join(scenarioDir, 'scenario.json');
  const scenarioConfig = (await fs.pathExists(scenarioConfigPath))
    ? await fs.readJson(scenarioConfigPath)
    : {};

  const expectFailure = !!scenarioConfig.expectFailure;
  const expectedErrorPattern = scenarioConfig.expectedErrorPattern || null;

  try {
    // ── Build temp working directory ─────────────────────────────────────────
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `dsl-test-${name}-`));

    await fs.copy(path.join(scenarioDir, 'arch'), path.join(tmpDir, 'arch'));
    const configSrc = path.join(scenarioDir, 'dsl-springboot.json');
    if (await fs.pathExists(configSrc)) {
      await fs.copy(configSrc, path.join(tmpDir, 'dsl-springboot.json'));
    }

    // ── Execute build ─────────────────────────────────────────────────────────
    const result = spawnSync(
      process.execPath,
      [path.join(generatorRoot, 'bin', 'dsl-springboot.js'), 'build', '--strict'],
      { cwd: tmpDir, encoding: 'utf8', env: { ...process.env } }
    );

    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const exitCode = result.status;

    if (verbose) {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    }

    // ── Evaluate result ────────────────────────────────────────────────────────
    if (expectFailure) {
      if (exitCode === 0) {
        errors.push('Expected build to fail but it succeeded');
      } else if (expectedErrorPattern) {
        const output = stdout + stderr;
        if (!output.includes(expectedErrorPattern)) {
          errors.push(`Expected error pattern "${expectedErrorPattern}" not found in output`);
          const relevant = (stdout + stderr)
            .split('\n')
            .filter((l) => l.includes('INT-') || l.includes('HTTP-') || l.toLowerCase().includes('error'))
            .slice(0, 4);
          relevant.forEach((l) => errors.push(`  ${l.trim()}`));
        }
      }
      return { passed: errors.length === 0, errors, accepted: 0 };
    }

    if (exitCode !== 0) {
      errors.push(`Build failed with exit code ${exitCode}`);
      const relevant = (stdout + stderr)
        .split('\n')
        .filter((l) => l.includes('INT-') || l.includes('HTTP-') || l.toLowerCase().includes('error'))
        .slice(0, 6);
      relevant.forEach((l) => errors.push(`  ${l.trim()}`));
      return { passed: false, errors, accepted: 0 };
    }

    // ── Assertions ─────────────────────────────────────────────────────────────
    const assertionsPath = path.join(scenarioDir, 'assertions.json');
    if (await fs.pathExists(assertionsPath)) {
      const assertions = await fs.readJson(assertionsPath);
      const assertionErrors = await checkAssertions(tmpDir, assertions);
      errors.push(...assertionErrors);
    }

    // ── Accept or Diff ─────────────────────────────────────────────────────────
    let accepted = 0;
    const expectedDir = path.join(scenarioDir, 'expected');

    if (accept) {
      accepted = await acceptScenario(tmpDir, expectedDir);
    } else if (await fs.pathExists(expectedDir)) {
      const diffErrors = await diffDirectories(
        path.join(tmpDir, 'src', 'main', 'java'),
        path.join(expectedDir, 'src', 'main', 'java')
      );
      errors.push(...diffErrors);

      const expectedResourcesDir = path.join(expectedDir, 'src', 'main', 'resources');
      if (await fs.pathExists(expectedResourcesDir)) {
        const resourcesDiffErrors = await diffDirectories(
          path.join(tmpDir, 'src', 'main', 'resources'),
          expectedResourcesDir
        );
        errors.push(...resourcesDiffErrors);
      }
    } else if (scenarioConfig.allowNoExpected === true) {
      console.log(`    ℹ  No expected/ directory — scenario.json allowNoExpected=true`);
    } else {
      errors.push('[diff] Missing expected/ directory for successful scenario. Run with --accept to create golden files, or set scenario.json allowNoExpected=true for intentional smoke scenarios.');
    }

    // ── Generated Java compilation ───────────────────────────────────────────
    const shouldCompile = !expectFailure && (forceCompile || scenarioConfig.compileGeneratedJava === true);
    if (shouldCompile) {
      const compileTask = scenarioConfig.gradleTask || 'compileJava';
      const compileErrors = await compileGeneratedJava(tmpDir, {
        task: compileTask,
        javaHome: scenarioConfig.javaHome || null,
        verbose,
      });
      errors.push(...compileErrors);
    }

    return { passed: errors.length === 0, errors, accepted };
  } finally {
    if (tmpDir) {
      await fs.remove(tmpDir).catch(() => {});
    }
  }
}

// ─── Generated Java compilation ──────────────────────────────────────────────

async function compileGeneratedJava(generatedDir, { task, javaHome, verbose }) {
  const errors = [];
  const wrapperName = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
  const wrapperPath = path.join(generatedDir, wrapperName);

  if (!(await fs.pathExists(wrapperPath))) {
    return [`[compile] Gradle wrapper not found: ${wrapperName}`];
  }

  const resolvedJavaHome = await resolveJavaHome(javaHome);
  const env = { ...process.env };
  if (resolvedJavaHome) {
    env.JAVA_HOME = resolvedJavaHome;
    env.PATH = path.join(resolvedJavaHome, 'bin') + path.delimiter + (env.PATH || '');
  }

  const result = spawnSync(wrapperPath, [task, '--no-daemon'], {
    cwd: generatedDir,
    encoding: 'utf8',
    env,
    shell: process.platform === 'win32',
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const exitCode = result.status;

  if (verbose) {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  }

  if (result.error) {
    errors.push(`[compile] Failed to run Gradle wrapper: ${result.error.message}`);
    return errors;
  }

  if (exitCode !== 0) {
    errors.push(`[compile] Gradle ${task} failed with exit code ${exitCode}`);
    summarizeCompileOutput(stdout + stderr).forEach((line) => errors.push(`  ${line}`));
  }

  return errors;
}

async function resolveJavaHome(configuredJavaHome) {
  if (configuredJavaHome) return configuredJavaHome;
  if (process.env.DSL_TEST_JAVA_HOME) return process.env.DSL_TEST_JAVA_HOME;
  if (process.env.JAVA_HOME && await isUsableJavaHome(process.env.JAVA_HOME)) return process.env.JAVA_HOME;

  const windowsDefault = 'C:\\java\\jdk-17';
  if (process.platform === 'win32' && await isUsableJavaHome(windowsDefault)) {
    return windowsDefault;
  }

  return null;
}

async function isUsableJavaHome(javaHome) {
  const javaExecutable = process.platform === 'win32' ? 'java.exe' : 'java';
  return fs.pathExists(path.join(javaHome, 'bin', javaExecutable));
}

function summarizeCompileOutput(output) {
  const lines = output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const relevant = lines.filter((line) => {
    const lower = line.toLowerCase();
    return lower.includes('error:')
      || lower.includes('cannot find symbol')
      || lower.includes('location:')
      || lower.includes('build failed')
      || lower.includes('compilation failed')
      || lower.includes('execution failed')
      || lower.includes('java_home');
  });

  return (relevant.length > 0 ? relevant : lines.slice(-12)).slice(0, 12);
}

// ─── Assertions ───────────────────────────────────────────────────────────────

/**
 * Verifies text patterns in generated files.
 *
 * assertions.json format:
 * {
 *   "src/main/java/com/test/.../Foo.java": {
 *     "contains": ["pattern1", "pattern2"],
 *     "notContains": ["bad1"]
 *   }
 * }
 *
 * @param {string}  generatedDir - temp dir where files were generated
 * @param {object}  assertions   - map of relative path → { contains, notContains }
 * @returns {Promise<string[]>}  - list of failure messages
 */
async function checkAssertions(generatedDir, assertions) {
  const errors = [];

  for (const [relPath, spec] of Object.entries(assertions)) {
    const filePath = path.join(generatedDir, ...relPath.split('/'));

    if (!(await fs.pathExists(filePath))) {
      errors.push(`[assertion] Missing expected file: ${relPath}`);
      continue;
    }

    const content = await fs.readFile(filePath, 'utf8');

    for (const pattern of spec.contains || []) {
      if (!content.includes(pattern)) {
        errors.push(`[assertion] ${relPath}: missing text → "${pattern}"`);
      }
    }

    for (const pattern of spec.notContains || []) {
      if (content.includes(pattern)) {
        errors.push(`[assertion] ${relPath}: unexpected text found → "${pattern}"`);
      }
    }
  }

  return errors;
}

// ─── Directory diff ───────────────────────────────────────────────────────────

/**
 * Compares the generated Java tree against the golden files in expected/.
 * Only files present in expected/ are compared — extra generated files are ignored.
 *
 * @param {string} actualDir   - generated src/main/java/ directory
 * @param {string} expectedDir - golden src/main/java/ directory
 * @returns {Promise<string[]>}
 */
async function diffDirectories(actualDir, expectedDir) {
  const errors = [];

  if (!(await fs.pathExists(actualDir))) {
    return ['[diff] Generated src/main/java/ directory not found'];
  }
  if (!(await fs.pathExists(expectedDir))) {
    return [];
  }

  const expectedFiles = await collectFiles(expectedDir);

  for (const relFile of expectedFiles) {
    const actualPath = path.join(actualDir, ...relFile.split('/'));
    const expectedPath = path.join(expectedDir, ...relFile.split('/'));

    if (!(await fs.pathExists(actualPath))) {
      errors.push(`[diff] File in expected/ but not generated: ${relFile}`);
      continue;
    }

    const actualContent = await fs.readFile(actualPath, 'utf8');
    const expectedContent = await fs.readFile(expectedPath, 'utf8');

    if (normalizeContent(actualContent) !== normalizeContent(expectedContent)) {
      errors.push(`[diff] Content differs from golden file: ${relFile}`);
    }
  }

  return errors;
}

// ─── Accept ───────────────────────────────────────────────────────────────────

/**
 * Copies src/main/java/ from the generated output into expected/.
 * @returns {Promise<number>} number of accepted files
 */
async function acceptScenario(tmpDir, scenarioExpectedDir) {
  const srcJavaDir = path.join(tmpDir, 'src', 'main', 'java');

  if (!(await fs.pathExists(srcJavaDir))) {
    throw new Error('Accept failed: no src/main/java/ directory in generated output');
  }

  const targetJavaDir = path.join(scenarioExpectedDir, 'src', 'main', 'java');
  await fs.ensureDir(targetJavaDir);
  await fs.emptyDir(targetJavaDir);
  await fs.copy(srcJavaDir, targetJavaDir);

  const srcResourcesDir = path.join(tmpDir, 'src', 'main', 'resources');
  let resourcesCount = 0;
  if (await fs.pathExists(srcResourcesDir)) {
    const targetResourcesDir = path.join(scenarioExpectedDir, 'src', 'main', 'resources');
    await fs.ensureDir(targetResourcesDir);
    await fs.emptyDir(targetResourcesDir);
    await fs.copy(srcResourcesDir, targetResourcesDir);
    const resourceFiles = await collectFiles(targetResourcesDir);
    resourcesCount = resourceFiles.length;
  }

  const javaFiles = await collectFiles(targetJavaDir);
  return javaFiles.length + resourcesCount;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function collectFiles(dir) {
  if (!(await fs.pathExists(dir))) return [];
  const result = [];

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        result.push(path.relative(dir, fullPath).replace(/\\/g, '/'));
      }
    }
  }

  await walk(dir);
  return result.sort();
}

function normalizeContent(content) {
  return content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();
}

module.exports = { runScenario, checkAssertions, diffDirectories, acceptScenario, compileGeneratedJava };
