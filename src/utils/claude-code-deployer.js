'use strict';

const path = require('path');
const fs = require('fs-extra');

const TOOL_MAP = {
  read: 'Read',
  edit: 'Edit',
  search: 'Grep',
  execute: 'Bash',
  glob: 'Glob',
  write: 'Write',
  // 'todo' is not a Claude Code tool — dropped
};

function toKebabSlug(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function mapTools(toolsField) {
  if (!toolsField) return [];
  const list = Array.isArray(toolsField)
    ? toolsField
    : String(toolsField).replace(/[\[\]]/g, '').split(',').map((t) => t.trim());
  return list
    .map((t) => TOOL_MAP[t.toLowerCase()])
    .filter(Boolean);
}

/**
 * Parses the YAML frontmatter block from a Markdown file.
 * Returns { frontmatter: object, body: string }.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const rawYaml = match[1];
  const body = match[2] || '';

  const fm = {};
  const lines = rawYaml.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const kv = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (!kv) { i++; continue; }
    const key = kv[1];
    let val = kv[2].trim();

    if (val === '>') {
      const parts = [];
      i++;
      while (i < lines.length && (lines[i].startsWith('  ') || lines[i].trim() === '')) {
        parts.push(lines[i].trim());
        i++;
      }
      fm[key] = parts.join(' ').trim();
    } else if (val.startsWith('[') && val.endsWith(']')) {
      fm[key] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
      i++;
    } else {
      fm[key] = val.replace(/^["']|["']$/g, '');
      i++;
    }
  }

  return { frontmatter: fm, body };
}

/**
 * The source agent/skill content is shared verbatim with the .agents/ and
 * .github/ deployments (which target other tools' conventions: AGENTS.md as
 * the project convention file, and .agents/skills/ as the skill location).
 * Claude Code instead expects CLAUDE.md and .claude/skills/. Rewrite both
 * references — but only in content destined for .claude/.
 */
function rewriteForClaudeCode(content) {
  return content
    .replace(/AGENTS\.md/g, 'CLAUDE.md')
    .replace(/\.agents\/skills\//g, '.claude/skills/');
}

/**
 * Recursively applies rewriteForClaudeCode to every Markdown file under dir.
 * Used after copying skills into .claude/skills/.
 */
async function rewriteConventionRefsInDir(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await rewriteConventionRefsInDir(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const content = await fs.readFile(fullPath, 'utf8');
      const rewritten = rewriteForClaudeCode(content);
      if (rewritten !== content) await fs.writeFile(fullPath, rewritten);
    }
  }
}

/**
 * Builds Claude Code *slash command* frontmatter from a source agent's
 * frontmatter. Commands differ from subagents:
 *   - no `name:`  (the command name derives from the file name)
 *   - no `model:` (commands run in the main thread, inheriting the session model)
 *   - keep `description:` and `argument-hint:` (both supported by Claude Code)
 *   - `tools:` → `allowed-tools:` (mapped Copilot → Claude Code names)
 * `AskUserQuestion` is always added: these flows run in the main thread and
 * declare human-in-the-loop behaviour ("detente y notifica al usuario"), so the
 * command must be able to pause and ask the user.
 */
function buildCommandFrontmatter(fm) {
  const tools = mapTools(fm.tools);
  if (!tools.includes('AskUserQuestion')) tools.push('AskUserQuestion');
  const description = fm.description || '';

  let yaml = '---\n';
  yaml += `description: >\n  ${description.replace(/\n/g, '\n  ')}\n`;
  if (fm['argument-hint']) yaml += `argument-hint: ${fm['argument-hint']}\n`;
  yaml += `allowed-tools: ${tools.join(', ')}\n`;
  yaml += '---\n';
  return yaml;
}

/**
 * Transforms a .agent.md file into a Claude Code slash command and writes it
 * to destDir/<slug>.md. Slash commands run in the main conversation thread,
 * where AskUserQuestion can pause for user input and $ARGUMENTS carries the
 * caller's request — which is why Claude Code responds better to them than to
 * autonomous subagents for human-in-the-loop flows.
 */
async function transformAndWriteCommand(srcFile, destDir) {
  const content = await fs.readFile(srcFile, 'utf8');
  const { frontmatter, body } = parseFrontmatter(content);

  const slug = toKebabSlug(frontmatter.name || path.basename(srcFile, '.agent.md'));
  const newFrontmatter = buildCommandFrontmatter(frontmatter);

  // Inject the caller's request right after the frontmatter via $ARGUMENTS.
  const argsBlock = '\n> **Petición:** $ARGUMENTS\n\n';

  const destFile = path.join(destDir, `${slug}.md`);
  await fs.outputFile(destFile, newFrontmatter + argsBlock + rewriteForClaudeCode(body));
  return slug;
}

/**
 * Deploys Phase 3 skills and agents to the project's .claude/ directory.
 * Non-blocking: logs a warning on failure rather than throwing.
 *
 * @param {string} agentsSrcDir - absolute path to src/agents/ in the generator
 * @param {string} skillsSrcDir - absolute path to src/skills/ in the generator
 * @param {string} outputDir    - the project root being generated (process.cwd())
 * @param {object} logger       - project logger (info/success/warn)
 */
async function deployToClaudeCode(agentsSrcDir, skillsSrcDir, outputDir, logger) {
  const claudeDir = path.join(outputDir, '.claude');

  try {
    await fs.ensureDir(claudeDir);
  } catch (err) {
    logger.warn(`Claude Code deploy skipped: .claude/ not accessible (${err.message})`);
    return;
  }

  // ── Deploy skills ──────────────────────────────────────────────────────────
  if (await fs.pathExists(skillsSrcDir)) {
    const skillsDestDir = path.join(claudeDir, 'skills');
    try {
      await fs.copy(skillsSrcDir, skillsDestDir, { overwrite: true });
      await rewriteConventionRefsInDir(skillsDestDir);
      logger.success('Phase 3 skills deployed to .claude/skills/');
    } catch (err) {
      logger.warn(`Claude Code skills deploy failed: ${err.message}`);
    }
  }

  // ── Deploy agents as slash commands ─────────────────────────────────────────
  // Claude Code responds better to slash commands than to subagents for these
  // human-in-the-loop flows: commands run in the main thread (AskUserQuestion
  // works) and receive the caller's request via $ARGUMENTS.
  if (await fs.pathExists(agentsSrcDir)) {
    const commandsDestDir = path.join(claudeDir, 'commands');
    try {
      await fs.ensureDir(commandsDestDir);
      const entries = await fs.readdir(agentsSrcDir);
      const agentFiles = entries.filter((f) => f.endsWith('.agent.md') || f.endsWith('.md'));

      for (const file of agentFiles) {
        const srcFile = path.join(agentsSrcDir, file);
        const slug = await transformAndWriteCommand(srcFile, commandsDestDir);
        logger.success(`Command "${slug}" deployed to .claude/commands/${slug}.md`);
      }
    } catch (err) {
      logger.warn(`Claude Code commands deploy failed: ${err.message}`);
    }
  }

  // ── Deploy settings.json ─────────────────────────────────────────────────────
  try {
    const settings = {
      permissions: {
        allow: [
          // Gradle — compilar, testear, empaquetar, ejecutar
          'Bash(./gradlew build)',
          'Bash(./gradlew compileJava)',
          'Bash(./gradlew test)',
          'Bash(./gradlew clean)',
          'Bash(./gradlew bootRun)',
          'Bash(./gradlew bootJar)',
          'PowerShell(.\\gradlew.bat build)',
          'PowerShell(.\\gradlew.bat compileJava)',
          'PowerShell(.\\gradlew.bat test)',
          'PowerShell(.\\gradlew.bat clean)',
          'PowerShell(.\\gradlew.bat bootRun)',
          'PowerShell(.\\gradlew.bat bootJar)',
          // Java — ejecutar JAR construido y verificar versión del JDK
          'Bash(java -jar *)',
          'Bash(java --version)',
          'Bash(java -version)',
          'PowerShell(java -jar *)',
          'PowerShell(java --version)',
          'PowerShell(java -version)',
        ],
      },
    };
    const settingsPath = path.join(claudeDir, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    logger.success('Claude Code settings deployed to .claude/settings.json');
  } catch (err) {
    logger.warn(`Claude Code settings deploy failed: ${err.message}`);
  }
}

module.exports = { deployToClaudeCode };
