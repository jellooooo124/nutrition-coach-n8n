const fs = require('fs');
const path = require('path');
const [sheetId, intakeGid] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{20,}$/.test(sheetId || '') || !/^\d+$/.test(intakeGid || '')) {
  console.error('Usage: npm run configure -- YOUR_SPREADSHEET_ID MEAL_INTAKE_GID');
  process.exit(1);
}
const root = path.resolve(__dirname, '..');
const out = path.join(root, '.local', 'workflows');
fs.mkdirSync(out, { recursive: true });
for (const file of fs.readdirSync(path.join(root, 'workflows'))) {
  if (!file.endsWith('.json')) continue;
  const text = fs.readFileSync(path.join(root, 'workflows', file), 'utf8')
    .replaceAll('YOUR_SPREADSHEET_ID', sheetId)
    .replaceAll('YOUR_MEAL_INTAKE_GID', intakeGid);
  fs.writeFileSync(path.join(out, file), text);
}
console.log('Created .local/workflows. Import these copies and select your credentials in n8n.');
console.log('Preview mode is still enabled; schedules are still inactive.');
