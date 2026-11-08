// Deterministic insertion of the shared validator; verifies drift without cloud access.
const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..');
const validator = fs.readFileSync(path.join(root, 'workflow-code/validate-response.js'), 'utf8').trim();
for (const file of fs.readdirSync(path.join(root, 'workflows')).filter(f => /^WF0[123].*json$/.test(f))) {
  const loc = path.join(root, 'workflows', file); const workflow = JSON.parse(fs.readFileSync(loc, 'utf8'));
  const node = workflow.nodes.find(n => n.type.endsWith('.code') && n.name.startsWith('整理'));
  const marker = '// END SHARED RESPONSE VALIDATOR\n';
  let code = node.parameters.jsCode;
  if (code.includes(marker)) code = code.split(marker)[1];
  node.parameters.jsCode = validator + '\n' + marker + code;
  const text = JSON.stringify(workflow, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (text !== fs.readFileSync(loc, 'utf8')) throw Error('Validator drift: ' + file);
  } else fs.writeFileSync(loc, text);
}
