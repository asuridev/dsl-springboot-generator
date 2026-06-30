'use strict';

const path = require('path');
const fs = require('fs-extra');

const TOOL_MAP = {
  read: 'read',
  edit: 'edit',
  search: 'grep',
  execute: 'bash',
  glob: 'glob',
  write: 'write',
  // 'todo' is not a real tool — dropped
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
 * Source agents reference AGENTS.md (which OpenCode uses natively — no rewrite needed)
 * and .agents/skills/ paths (which must be rewritten to .opencode/skills/).
 */
function rewriteForOpenCode(content) {
  return content.replace(/\.agents\/skills\//g, '.opencode/skills/');
}

/**
 * Recursively applies rewriteForOpenCode to every Markdown file under dir.
 * Used after copying skills into .opencode/skills/.
 */
async function rewriteConventionRefsInDir(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await rewriteConventionRefsInDir(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const content = await fs.readFile(fullPath, 'utf8');
      const rewritten = rewriteForOpenCode(content);
      if (rewritten !== content) await fs.writeFile(fullPath, rewritten);
    }
  }
}

/**
 * Builds OpenCode agent frontmatter from a source agent's frontmatter.
 * OpenCode agents use:
 *   - name: (from source)
 *   - description: (from source)
 *   - mode: subagent (for kind=specialist) | primary (default)
 *   - model: anthropic/model-id
 *   - tools: YAML block list of lowercase names
 * Dropped: kind, argument-hint (not supported by OpenCode)
 */
function buildAgentFrontmatter(fm, slug) {
  const tools = mapTools(fm.tools);
  const description = fm.description || '';
  const mode = fm.kind === 'specialist' ? 'subagent' : 'primary';

  let yaml = '---\n';
  yaml += `name: ${fm.name || slug}\n`;
  yaml += `description: >\n  ${description.replace(/\n/g, '\n  ')}\n`;
  yaml += `mode: ${mode}\n`;
  if (tools.length) {
    yaml += 'tools:\n';
    for (const t of tools) yaml += `  ${t}: true\n`;
  }
  yaml += '---\n';
  return yaml;
}

/**
 * Transforms a .agent.md file into an OpenCode agent and writes it to
 * destDir/<slug>.md. All source agents are kind:specialist so they all
 * deploy as mode:subagent, invoked via @agent-name by the orchestrator skill.
 */
async function transformAndWriteAgent(srcFile, destDir) {
  const content = await fs.readFile(srcFile, 'utf8');
  const { frontmatter, body } = parseFrontmatter(content);

  const slug = toKebabSlug(frontmatter.name || path.basename(srcFile, '.agent.md'));
  const newFrontmatter = buildAgentFrontmatter(frontmatter, slug);

  const destFile = path.join(destDir, `${slug}.md`);
  await fs.outputFile(destFile, newFrontmatter + '\n' + rewriteForOpenCode(body));
  return slug;
}

/**
 * Deploys Phase 3 skills and agents to the project's .opencode/ directory.
 * Non-blocking: logs a warning on failure rather than throwing.
 *
 * @param {string} agentsSrcDir - absolute path to src/agents/ in the generator
 * @param {string} skillsSrcDir - absolute path to src/skills/ in the generator
 * @param {string} outputDir    - the project root being generated (process.cwd())
 * @param {object} logger       - project logger (info/success/warn)
 */
async function deployToOpenCode(agentsSrcDir, skillsSrcDir, outputDir, logger) {
  const opencodeDir = path.join(outputDir, '.opencode');

  try {
    await fs.ensureDir(opencodeDir);
  } catch (err) {
    logger.warn(`OpenCode deploy skipped: .opencode/ not accessible (${err.message})`);
    return;
  }

  // ── Deploy skills ──────────────────────────────────────────────────────────
  if (await fs.pathExists(skillsSrcDir)) {
    const skillsDestDir = path.join(opencodeDir, 'skills');
    try {
      await fs.emptyDir(skillsDestDir);
      await fs.copy(skillsSrcDir, skillsDestDir, { overwrite: true });
      await rewriteConventionRefsInDir(skillsDestDir);
      logger.success('Phase 3 skills deployed to .opencode/skills/');
    } catch (err) {
      logger.warn(`OpenCode skills deploy failed: ${err.message}`);
    }
  }

  // ── Deploy agents ──────────────────────────────────────────────────────────
  if (await fs.pathExists(agentsSrcDir)) {
    const agentsDestDir = path.join(opencodeDir, 'agents');
    try {
      await fs.ensureDir(agentsDestDir);
      const entries = await fs.readdir(agentsSrcDir);
      const agentFiles = entries.filter((f) => f.endsWith('.agent.md') || f.endsWith('.md'));

      for (const file of agentFiles) {
        const srcFile = path.join(agentsSrcDir, file);
        const slug = await transformAndWriteAgent(srcFile, agentsDestDir);
        logger.success(`OpenCode agent "${slug}" deployed to .opencode/agents/${slug}.md`);
      }
    } catch (err) {
      logger.warn(`OpenCode agents deploy failed: ${err.message}`);
    }
  }
}

module.exports = { deployToOpenCode };
