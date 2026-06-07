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

// Project-level Claude Code agents only accept the model *family* alias —
// not a versioned model id. Valid values: sonnet, opus, haiku, inherit.
const MODEL_PATTERNS = [
  { pattern: /sonnet/i, id: 'sonnet' },
  { pattern: /opus/i,   id: 'opus' },
  { pattern: /haiku/i,  id: 'haiku' },
];

const DEFAULT_MODEL = 'inherit';

function toKebabSlug(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeModel(raw) {
  if (!raw) return DEFAULT_MODEL;
  for (const { pattern, id } of MODEL_PATTERNS) {
    if (pattern.test(raw)) return id;
  }
  return DEFAULT_MODEL;
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

function buildClaudeCodeFrontmatter(fm) {
  const slug = toKebabSlug(fm.name || 'agent');
  const model = normalizeModel(fm.model);
  const tools = mapTools(fm.tools);
  const description = fm.description || '';

  let yaml = '---\n';
  yaml += `name: ${slug}\n`;
  yaml += `description: >\n  ${description.replace(/\n/g, '\n  ')}\n`;
  if (model) yaml += `model: ${model}\n`;
  if (tools.length > 0) {
    yaml += 'tools:\n';
    for (const t of tools) yaml += `  - ${t}\n`;
  }
  yaml += '---\n';
  return yaml;
}

/**
 * Transforms a .agent.md file into Claude Code agent format and writes it
 * to destDir/<slug>.md.
 */
async function transformAndWriteAgent(srcFile, destDir) {
  const content = await fs.readFile(srcFile, 'utf8');
  const { frontmatter, body } = parseFrontmatter(content);

  const slug = toKebabSlug(frontmatter.name || path.basename(srcFile, '.agent.md'));
  const newFrontmatter = buildClaudeCodeFrontmatter(frontmatter);

  let preamble = '';
  if (frontmatter['argument-hint']) {
    preamble = `<!-- argument-hint: ${frontmatter['argument-hint']} -->\n\n`;
  }

  const destFile = path.join(destDir, `${slug}.md`);
  await fs.outputFile(destFile, newFrontmatter + preamble + rewriteForClaudeCode(body));
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

  // ── Deploy agents ──────────────────────────────────────────────────────────
  if (await fs.pathExists(agentsSrcDir)) {
    const agentsDestDir = path.join(claudeDir, 'agents');
    try {
      await fs.ensureDir(agentsDestDir);
      const entries = await fs.readdir(agentsSrcDir);
      const agentFiles = entries.filter((f) => f.endsWith('.agent.md') || f.endsWith('.md'));

      for (const file of agentFiles) {
        const srcFile = path.join(agentsSrcDir, file);
        const slug = await transformAndWriteAgent(srcFile, agentsDestDir);
        logger.success(`Agent "${slug}" deployed to .claude/agents/${slug}.md`);
      }
    } catch (err) {
      logger.warn(`Claude Code agents deploy failed: ${err.message}`);
    }
  }
}

module.exports = { deployToClaudeCode };
