const fs = require('fs');
const path = require('path');
const [sheetId, intakeGid, gatewayUrl] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{20,}$/.test(sheetId || '') || !/^\d+$/.test(intakeGid || '')) {
  console.error('Usage: npm run configure -- YOUR_SPREADSHEET_ID MEAL_INTAKE_GID HTTPS_GATEWAY_URL');
  process.exit(1);
}
let gateway;
try { gateway = new URL(gatewayUrl); } catch { throw Error('Supply the deployed HTTPS gateway URL as the third argument'); }
const localOnly = gateway.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(gateway.hostname);
if ((!localOnly && gateway.protocol !== 'https:') || gateway.username || gateway.password || gateway.search || gateway.hash || gateway.pathname !== '/' || gateway.hostname.endsWith('.invalid')) throw Error('Use HTTPS (or HTTP loopback for a same-host service), without credentials or paths');
const root = path.resolve(__dirname, '..');
const out = path.join(root, '.local', 'workflows');
fs.mkdirSync(out, { recursive: true });
for (const file of fs.readdirSync(path.join(root, 'workflows'))) {
  if (!file.endsWith('.json')) continue;
  const text = fs.readFileSync(path.join(root, 'workflows', file), 'utf8')
    .replaceAll('YOUR_SPREADSHEET_ID', sheetId)
    .replaceAll('YOUR_MEAL_INTAKE_GID', intakeGid)
    .replaceAll('https://YOUR_GATEWAY_HOST.invalid', gateway.origin);
  fs.writeFileSync(path.join(out, file), text);
}
console.log('Created .local/workflows. Import these copies and select your credentials in n8n.');
console.log('Preview mode is still enabled; schedules are still inactive.');
