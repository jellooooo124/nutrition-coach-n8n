const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'workflows')).filter(f => f.endsWith('.json'));
assert.equal(files.length, 4);
for (const file of files) {
  const w = JSON.parse(fs.readFileSync(path.join(root, 'workflows', file), 'utf8'));
  assert.equal(w.active, false);
  assert.equal(w.id, undefined);
  assert.equal(w.pinData, undefined);
  for (const n of w.nodes) {
    assert.equal(n.credentials, undefined, `${file}: credentials must be selected after import`);
    if (n.parameters.documentId) assert.equal(n.parameters.documentId.value, 'YOUR_SPREADSHEET_ID');
    if (n.type.endsWith('googleSheetsTrigger')) assert.equal(n.parameters.sheetName.value, 'YOUR_MEAL_INTAKE_GID');
    const code = n.parameters.jsCode || '';
    assert(!/PREVIEW_ONLY\s*=\s*false/.test(code));
  }
}
// Replay a previously observed unsupported goal claim through the current guard.
for (const file of files.filter(f => /^WF0[23]/.test(f))) {
  const w = JSON.parse(fs.readFileSync(path.join(root, 'workflows', file), 'utf8'));
  const node = w.nodes.find(n => (n.parameters.jsCode || '').includes('const unsafe='));
  const original = {report_date:'2026-11-05',recorded_meals:3,expected_meals:3,coverage_pct:'100',verified_goal_yes:0,goal_achievement_pct:'',daily_target_goal_meals:1};
  const ai = {ai_client_draft:'完全符合我們的每日目標！',coach_summary:'需要核實'};
  const output = new Function('$', '$input', node.parameters.jsCode)(
    () => ({all: () => [{json:original}]}),
    {all: () => [{json:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(ai)}]}}]}}]}
  )[0].json;
  assert(!output.ai_client_draft.includes('完全符合'));
  assert.equal(output.review_status, '待教練審核');
  assert.equal(output.allow_write, false);
}
console.log('Release defaults and unsupported-claim regression checks passed.');
