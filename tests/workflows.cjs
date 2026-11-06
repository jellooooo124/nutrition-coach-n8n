const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'workflows');
const flows = Object.fromEntries(fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => [f.slice(0,4), JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))]));
const results = [];
function check(name, fn) { try { if (!fn()) throw Error('Assertion failed'); results.push({name,passed:true}); } catch(e) { results.push({name,passed:false,error:e.message}); } }
function run(wf, name, data={}, input=[], now='2026-11-05T10:00:00Z') {
 const code=flows[wf].nodes.find(n=>n.name===name).parameters.jsCode;
 const items=rows=>rows.map(json=>({json}));
 class Clock extends Date { constructor(...a){super(...(a.length?a:[now]));} static now(){return new Date(now).getTime();} }
 return vm.runInNewContext('(function(){'+code+'})()', {Date:Clock,$:name=>({all:()=>items(data[name]||[]),first:()=>items(data[name]||[{}])[0]}),$input:{all:()=>items(input),first:()=>items(input)[0]}},{timeout:1000});
}
for(const [key,w] of Object.entries(flows)) {
 check(key+' inactive',()=>w.active===false);
 for(const n of w.nodes.filter(n=>n.type.endsWith('.code'))) check(key+' syntax: '+n.name,()=>{new Function(n.parameters.jsCode);return true;});
 const names=new Set(w.nodes.map(n=>n.name));
 check(key+' connection targets',()=>Object.entries(w.connections).every(([from,branches])=>names.has(from)&&Object.values(branches).flat(2).every(x=>names.has(x.node))));
}
check('Apps Script syntax',()=>{new Function(fs.readFileSync(path.join(root,'apps-script','Code.gs'),'utf8'));return true;});
const client={client_id:'TEST-8WK-001',active:'是',course_start:'2026-10-29',course_end:'2026-12-23',daily_expected_meals:3,daily_target_goal_meals:1,goal_text:'虛構蔬菜習慣',goal_rule:'一餐有蔬菜'};
const data={'讀取所有 Clients':[client],'讀取所有 Meals':[]};
check('Daily missing records: 0 coverage and unknown goal',()=>{const j=run('WF02','建構日總結分析素材',data)[0].json;return j.coverage_pct==='0'&&j.goal_achievement_pct==='';});
check('Daily repeat skips existing report',()=>run('WF02','建構日總結分析素材',data,[{summary_id:'DAY|TEST-8WK-001|2026-11-04'}]).length===0);
for(let week=1;week<=8;week++) {
 const now=new Date(Date.parse('2026-10-29T10:00:00Z')+week*7*86400000).toISOString();
 check('Weekly course boundary '+week,()=>run('WF03','建構週總結分析素材',data,[],now)[0].json.week_no===String(week));
}
check('No week 9',()=>run('WF03','建構週總結分析素材',data,[],'2026-12-31T10:00:00Z').length===0);
check('Sandbox reminder remains unapproved draft',()=>{const r=run('WF04','找出今天尚未上傳的客戶',{'讀取追蹤中 Clients':[client],'讀取 Meals':[]});return r.length===1&&r[0].json.allow_write===false&&r[0].json.approved_text==='';});
check('Reminder skips uploaded analyzed meal',()=>run('WF04','找出今天尚未上傳的客戶',{'讀取追蹤中 Clients':[client],'讀取 Meals':[{client_id:client.client_id,meal_date:'2026-11-05'}]}).length===0);
check('Regression: 0 percent must remain 0 in AI prompt',()=>run('WF02','建構日總結分析素材',data)[0].json.requestBody.contents[0].parts[0].text.includes('記錄覆蓋率：0%'));
const sample={submission_id:'TEST-MEAL-001',client_id:client.client_id,meal_date:'2026-11-04',meal_type:'午餐',meal_text:'虛構米飯青菜'};
check('Regression: all intake items preserved',()=>run('WF01','檢查輸入資料',{},[sample,{...sample,submission_id:'TEST-MEAL-002'}]).length===2);
check('Regression: invalid calendar date rejected',()=>run('WF01','檢查輸入資料',{},[{...sample,meal_date:'2026-02-31'}])[0].json.valid===false);
check('Pending intake suppresses reminder before AI finishes',()=>run('WF04','找出今天尚未上傳的客戶',{'讀取追蹤中 Clients':[client],'讀取 Meals':[],'讀取尚待分析的 Meal_Intake':[{client_id:client.client_id,meal_date:'2026-11-05'}]}).length===0);
check('Sandbox rejects non-test client',()=>run('WF01','檢查輸入資料',{},[{...sample,client_id:'CLIENT-001'}])[0].json.valid===false);
check('Valid leap day accepted',()=>run('WF01','檢查輸入資料',{},[{...sample,meal_date:'2024-02-29'}])[0].json.valid===true);
check('Weekly 0 percent preserved in prompt',()=>run('WF03','建構週總結分析素材',data)[0].json.requestBody.contents[0].parts[0].text.includes('：0%'));
check('Sandbox references only isolated spreadsheet',()=>Object.values(flows).every(w=>w.nodes.every(n=>!n.parameters.documentId||n.parameters.documentId.value==='YOUR_SPREADSHEET_ID')));
check('Meal writes append without updating coach edits',()=>flows.WF01.nodes.find(n=>n.name==='新增或更新 Meals 草稿').parameters.operation==='append');
const report={scope:'Offline JavaScript only; mocked n8n inputs; no Google, Gemini, n8n runtime or real customer data accessed',passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};

console.log(JSON.stringify(report,null,2));

if(report.failed) process.exitCode=1;
