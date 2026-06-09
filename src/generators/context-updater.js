const ejs = require('ejs');
const fs = require('fs-extra');
const path = require('path');

const BEGIN_MARKER = '<!-- dsl:generated:begin -->';
const END_MARKER = '<!-- dsl:generated:end -->';

async function updateContextFiles(outputDir, resolvedConfig, system, allBcYamls) {
  const templatePath = path.join(__dirname, '../../templates/docs/phase3-claude.md.ejs');
  const generatedBlock = ejs.render(await fs.readFile(templatePath, 'utf8'), {
    resolvedConfig,
    system,
    allBcYamls,
  });
  const marked = `${BEGIN_MARKER}\n${generatedBlock}\n${END_MARKER}`;

  for (const filename of ['CLAUDE.md', 'AGENTS.md']) {
    const filePath = path.join(outputDir, filename);
    if (await fs.pathExists(filePath)) {
      let existing = await fs.readFile(filePath, 'utf8');
      const start = existing.indexOf(BEGIN_MARKER);
      const end = existing.indexOf(END_MARKER);
      if (start !== -1 && end !== -1) {
        existing = existing.slice(0, start) + marked + existing.slice(end + END_MARKER.length);
      } else {
        existing = existing + '\n\n' + marked;
      }
      await fs.writeFile(filePath, existing, 'utf8');
    } else {
      await fs.writeFile(filePath, marked, 'utf8');
    }
  }
}

module.exports = { updateContextFiles };
