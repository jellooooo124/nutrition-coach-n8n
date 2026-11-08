const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const validate = new Function(fs.readFileSync(path.join(root,'workflow-code/validate-response.js'),'utf8') + '; return validateGeminiResponse;')();
const response = obj => ({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(obj)}]}}]});
const summary = {coach_summary:'Synthetic coach summary',ai_client_draft:'Synthetic draft'};
const meal = {observed_foods:'Synthetic vegetables',goal_alignment:'資料不足',ai_coach_assessment:'Needs review',missing_info:'',ai_client_draft:'Synthetic draft',issue_flags:''};
for(const [name, value] of Object.entries({null:null,array:[],missing:{coach_summary:'x'},extra:{...summary,approved_text:'yes'},wrongType:{...summary,ai_client_draft:{text:'x'}},empty:{...summary,ai_client_draft:' '},tooLong:{...summary,ai_client_draft:'x'.repeat(4001)},control:{...summary,ai_client_draft:'x\u0000'}})) {
 test('reject schema '+name,()=>assert.throws(()=>validate(response(value),'summary'),/AI_RESPONSE_REJECTED/));
}
test('valid meal and summary',()=>{assert.deepEqual(validate(response(meal),'meal'),meal);assert.deepEqual(validate(response(summary),'summary'),summary);});
for(const reason of ['MAX_TOKENS','SAFETY','RECITATION',undefined])test('reject incomplete '+reason,()=>{
 const r=response(summary);r.candidates[0].finishReason=reason;assert.throws(()=>validate(r,'summary'),/INCOMPLETE_RESPONSE/);
});
test('blocked/error/multiple candidates/invalid JSON have safe errors',()=>{
 const cases=[{promptFeedback:{blockReason:'SAFETY'}},{error:{message:'private provider error'}},{candidates:[]},response(summary)];
 cases[3].candidates[0].content.parts[0].text='private invalid JSON';
 for(const r of cases)assert.throws(()=>validate(r,'summary'),e=>!e.message.includes('private'));
});
const flows = Object.fromEntries(fs.readdirSync(path.join(root,'workflows')).filter(f=>f.endsWith('.json')).map(f=>[f.slice(0,4),JSON.parse(fs.readFileSync(path.join(root,'workflows',f)))]));
function run(key,clients,existing=[],now='2026-11-07T10:00:00Z'){
 const node=flows[key].nodes.find(n=>n.name.startsWith('建構'));
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
 return vm.runInNewContext('(function(){'+node.parameters.jsCode+'})()', {Date:Clock,$:name=>({all:()=>name.includes('Clients')?clients.map(json=>({json})):[]}),$input:{all:()=>existing.map(summary_id=>({json:{summary_id}}))}},{timeout:1000}).map(i=>i.json);
}
const client={client_id:'TEST-001',active:'是',course_start:'2026-10-01',course_end:'2026-11-25',daily_expected_meals:3,daily_target_goal_meals:1};
test('daily catches gaps, skips written IDs and caps model calls',()=>{
 const rows=run('WF02',[client],['DAY|TEST-001|2026-11-06']);
 assert.equal(rows.length,5);assert.equal(rows[0].report_date,'2026-11-05');assert.ok(rows.every(r=>r.report_date>='2026-10-31'));
});
test('backlog drains on repeated runs without recreating outputs',()=>{
 const first=run('WF02',[client]);const second=run('WF02',[client],first.map(r=>r.summary_id));
 assert.equal(first.length,5);assert.equal(second.length,2);
 assert.equal(run('WF02',[client],[...first,...second].map(r=>r.summary_id)).length,0);
});
test('weekly recovers missed boundary and never emits incomplete week or week 9',()=>{
 const rows=run('WF03',[client]);assert.ok(rows.length>0);
 assert.ok(rows.every(r=>Number(r.week_no)<=8&&r.week_end<'2026-11-07'));
 assert.equal(rows[0].week_no,'5');
 assert.equal(run('WF03',[client],[],'2027-01-01T10:00:00Z').length,0);
});
test('invalid course dates and duplicate clients cannot generate duplicate jobs',()=>{
 assert.equal(run('WF02',[{...client,course_start:'2026-02-31'}]).length,0);
 for(const key of ['WF02','WF03']){const rows=run(key,[client,client]);assert.equal(new Set(rows.map(r=>r.summary_id)).size,rows.length);assert.ok(rows.length<=5);}
});
test('all writes use gateway; no direct Sheets append remains',()=>{
 for(const w of Object.values(flows)){
  assert.ok(!w.nodes.some(n=>n.type.endsWith('.googleSheets')&&['append','appendOrUpdate','update'].includes(n.parameters.operation)));
  const writes=w.nodes.filter(n=>(n.parameters.url||'').includes('/v1/drafts/'));
  assert.equal(writes.length,1);assert.equal(writes[0].parameters.genericAuthType,'httpHeaderAuth');
 }
});

// Exercise the real configurator in an isolated temporary checkout.
test('configuration binds HTTPS gateway and sheet IDs without activating workflows', () => {
  const os = require('node:os');
  const cp = require('node:child_process');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrition-config-'));
  try {
    fs.cpSync(path.join(__dirname, '../scripts'), path.join(temp, 'scripts'), {recursive:true});
    fs.cpSync(path.join(__dirname, '../workflows'), path.join(temp, 'workflows'), {recursive:true});
    const script = path.join(temp, 'scripts/configure.cjs');
    const args = [script, 'SYNTHETIC_SPREADSHEET_12345', '123456', 'https://gateway.example.com'];
    assert.equal(cp.spawnSync(process.execPath, args).status, 0);
    for (const file of fs.readdirSync(path.join(temp, '.local/workflows'))) {
      const raw = fs.readFileSync(path.join(temp, '.local/workflows', file), 'utf8');
      assert.ok(!raw.includes('YOUR_GATEWAY_HOST') && !raw.includes('YOUR_SPREADSHEET_ID') && !raw.includes('YOUR_MEAL_INTAKE_GID'));
      assert.equal(JSON.parse(raw).active, false);
      assert.ok(raw.includes('https://gateway.example.com/v1/drafts/'));
    }
    assert.equal(cp.spawnSync(process.execPath, [...args.slice(0,3), 'http://127.0.0.1:8787']).status, 0);
    for (const url of ['http://gateway.example.com', 'https://user:secret@gateway.example.com', 'https://gateway.example.com/path', 'http://192.168.1.2:8787', 'http://127.0.0.1.evil.example']) {
      assert.notEqual(cp.spawnSync(process.execPath, [...args.slice(0,3),url]).status, 0);
    }
  } finally { fs.rmSync(temp, {recursive:true, force:true}); }
});
