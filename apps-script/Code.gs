/**
 * NUTRITION 8-week SEMI-AUTOMATION TEST KIT
 * 貼到現有測試 Google 試算表：擴充功能 > Apps Script。
 * 先執行 setupNutritionTestSystem。會建立新分頁與兩張 Google 表單，不會刪除原有 Coach_Review / Meal_Records。
 * 注意：僅使用虛構資料；此示範不應收集真實客戶健康資料，直到隱私和授權確認。
 */
const NUTRITION_TABS = {
  Clients: ['client_id','client_label','course_start','course_end','active','goal_text','goal_type','goal_rule','daily_expected_meals','daily_target_goal_meals','notes','created_at'],
  Meal_Intake: ['submission_id','submitted_at','client_id','meal_date','meal_type','meal_text','photo_drive_url','ate_all','portion_notes','source'],
  Meals: ['submission_id','client_id','meal_date','meal_type','meal_text','photo_drive_url','ate_all','portion_notes','client_goal','observed_foods','goal_alignment','ai_coach_assessment','missing_info','ai_client_draft','coach_approved_text','coach_goal_met','review_status','manually_replied_at','processing_status','issue_flags','created_at'],
  Daily_Summaries: ['summary_id','client_id','report_date','course_week','goal_text','expected_meals','recorded_meals','coverage_pct','daily_target_goal_meals','verified_goal_yes','verified_goal_no','goal_achievement_pct','metric_note','coach_summary','ai_client_draft','approved_text','review_status','manually_replied_at','created_at'],
  Weekly_Summaries: ['summary_id','client_id','week_no','week_start','week_end','goal_text','expected_meals','recorded_meals','coverage_pct','goal_target_total','verified_goal_yes','verified_goal_no','goal_achievement_pct','metric_note','coach_summary','ai_client_draft','approved_text','review_status','manually_replied_at','created_at'],
  Reminders: ['reminder_id','client_id','reminder_date','goal_text','reason','ai_draft','approved_text','review_status','manually_sent_at','created_at']
};
function setupNutritionTestSystem(){
  const ss=SpreadsheetApp.openById(nutritionSpreadsheetId_());
  if(ss.getId()!==nutritionSpreadsheetId_())throw new Error('只能在獨立虛構測試表執行');
  Object.keys(NUTRITION_TABS).forEach(name=>{
    const cols=NUTRITION_TABS[name];let sh=ss.getSheetByName(name);
    if(!sh) sh=ss.insertSheet(name);
    const existing=sh.getLastRow()>0?sh.getRange(1,1,1,cols.length).getValues()[0]:[];
    if(existing.every(v=>String(v).trim()==='')) sh.getRange(1,1,1,cols.length).setValues([cols]);
    else if(cols.some((c,i)=>String(existing[i])!==c)) throw new Error('分頁 '+name+' 的欄名不同；為避免覆寫，已停止。請先檢查。');
    sh.setFrozenRows(1);
    sh.getRange(1,1,1,cols.length).setBackground('#155e75').setFontColor('#ffffff').setFontWeight('bold');
    sh.setRowHeight(1,36);sh.setColumnWidths(1,cols.length,130);
    if(name==='Clients') sh.setColumnWidth(6,350);
    if(['Meals','Daily_Summaries','Weekly_Summaries'].includes(name)) sh.setColumnWidths(Math.max(1,cols.indexOf('ai_client_draft')+1),1,430);
    let approveCol=cols.indexOf('review_status')+1;
    if(approveCol){const rule=SpreadsheetApp.newDataValidation().requireValueInList(['待教練審核','退回修改','已核准','已手動回覆'],true).build();sh.getRange(2,approveCol,sh.getMaxRows()-1,1).setDataValidation(rule);}
    if(name==='Meals'){
      const rule=SpreadsheetApp.newDataValidation().requireValueInList(['是','否','待確認'],true).build();sh.getRange(2,cols.indexOf('coach_goal_met')+1,sh.getMaxRows()-1,1).setDataValidation(rule);
    }
  });
  const props=PropertiesService.getScriptProperties();
  let onboardId=props.getProperty('nutrition_onboarding_form_id');
  if(!onboardId){
    const f=FormApp.create('Nutrition 測試｜8週課程目標建檔（虛構資料）');f.setDescription('僅供測試，不要輸入真實客戶個資或醫療資料。');
    f.addTextItem().setTitle('client_id').setRequired(true);f.addTextItem().setTitle('client_label');
    f.addDateItem().setTitle('course_start').setRequired(true);
    f.addParagraphTextItem().setTitle('goal_text').setRequired(true);
    f.addListItem().setTitle('goal_type').setChoiceValues(['減重減脂的飲食習慣','學習正確飲食觀念','增加蔬菜攝取','維持肌肉與蛋白質','其他']).setRequired(true);
    f.addParagraphTextItem().setTitle('goal_rule').setHelpText('請寫可觀察指標，例如「每日至少1餐自述有蔬菜」，不代表體重或健康結果。');
    f.addTextItem().setTitle('daily_expected_meals').setHelpText('每日預期記錄幾餐，例如 3；不清楚可填0。');
    f.addTextItem().setTitle('daily_target_goal_meals').setHelpText('每日希望幾餐符合可確認的習慣目標，例如1；不是減脂結果。');
    f.addParagraphTextItem().setTitle('notes');f.setDestination(FormApp.DestinationType.SPREADSHEET,ss.getId());
    onboardId=f.getId();props.setProperty('nutrition_onboarding_form_id',onboardId);
  }
  let mealId=props.getProperty('nutrition_meal_form_id');
  if(!mealId){
    const f=FormApp.create('Nutrition 測試｜每日每餐紀錄（由教練手動從原平台轉填）');f.setDescription('沒有 Nutrition API：教練手動把客戶在原平台的文字及照片轉入此表單。僅供虛構測試。照片請放在私人 Google Drive，使用具有授權可讀取的連結。');
    f.addTextItem().setTitle('client_id').setRequired(true);
    f.addDateItem().setTitle('meal_date').setRequired(true);
    f.addListItem().setTitle('meal_type').setChoiceValues(['早餐','午餐','晚餐','點心','其他']).setRequired(true);
    f.addParagraphTextItem().setTitle('meal_text').setHelpText('請貼原平台的文字描述（沒有可留空）');
    f.addTextItem().setTitle('photo_drive_url').setHelpText('把照片上傳到有權限的 Google Drive 後貼入檔案連結；如新增表單檔案上傳題，也支援欄名 photo_upload。');
    f.addListItem().setTitle('ate_all').setChoiceValues(['已吃完','吃了一部分','未確認']).setRequired(true);
    f.addParagraphTextItem().setTitle('portion_notes');f.setDestination(FormApp.DestinationType.SPREADSHEET,ss.getId());
    mealId=f.getId();props.setProperty('nutrition_meal_form_id',mealId);
  }
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='nutritionOnFormSubmit').forEach(t=>ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('nutritionOnFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  Logger.log('建立完成！兩個 Google Forms 編輯網址：\n課程目標：'+FormApp.openById(onboardId).getEditUrl()+'\n每日餐點：'+FormApp.openById(mealId).getEditUrl()+'\n\n請把網址保留。Google Drive 相片需另設定權限；不要公開真實健康資料。');
}
function nutritionOnFormSubmit(e){
 const lock=LockService.getScriptLock();lock.waitLock(30000);
 try{return nutritionProcessFormSubmit_(e);}finally{lock.releaseLock();}
}
function nutritionProcessFormSubmit_(e){
  if(!e||!e.namedValues||!e.range) return;
  const named=e.namedValues,ss=e.source;
  if(ss.getId()!==nutritionSpreadsheetId_())throw new Error('錯誤的試算表');
  const val=k=>String((named[k]||[])[0]||'').trim();
  const has=k=>Object.prototype.hasOwnProperty.call(named,k);
  const now=Utilities.formatDate(new Date(),'Asia/Taipei','yyyy-MM-dd HH:mm:ss');
  const row=e.range.getRow();
  if(!val('client_id').startsWith('TEST-'))throw new Error('僅限 TEST- 開頭的虛構客戶');
  if(has('goal_text')){
    const sh=ss.getSheetByName('Clients');const id=val('client_id');if(!id)return;
    if(findRow_(sh,1,id)>0)return;
    const start=formDate_(e,'course_start');
    const endDate=new Date(start+'T12:00:00+08:00');endDate.setDate(endDate.getDate()+55);
    const end=Utilities.formatDate(endDate,'Asia/Taipei','yyyy-MM-dd');
    appendByHeader_(sh,{client_id:id,client_label:val('client_label'),course_start:start,course_end:end,active:'是',goal_text:val('goal_text'),goal_type:val('goal_type'),goal_rule:val('goal_rule'),daily_expected_meals:Math.max(0,Number(val('daily_expected_meals'))||0),daily_target_goal_meals:Math.max(0,Number(val('daily_target_goal_meals'))||0),notes:val('notes'),created_at:now});
  }else if(has('meal_type')){
    const sh=ss.getSheetByName('Meal_Intake'),id='FORM-'+e.range.getSheet().getSheetId()+'-'+row;
    if(findRow_(sh,1,id)>0)return;
    appendByHeader_(sh,{submission_id:id,submitted_at:now,client_id:val('client_id'),meal_date:formDate_(e,'meal_date'),meal_type:val('meal_type'),meal_text:val('meal_text'),photo_drive_url:val('photo_drive_url')||val('photo_upload'),ate_all:val('ate_all'),portion_notes:val('portion_notes'),source:'google_form_manual_transfer'});
  }
}
function date_(s){
  const m=String(s).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if(m)return [m[1],('0'+m[2]).slice(-2),('0'+m[3]).slice(-2)].join('-');
  return Utilities.formatDate(new Date(s),'Asia/Taipei','yyyy-MM-dd');
}
function findRow_(sh,col,target){if(!sh||sh.getLastRow()<2)return -1;const vs=sh.getRange(2,col,sh.getLastRow()-1,1).getValues();for(let i=0;i<vs.length;i++)if(String(vs[i][0])===String(target))return i+2;return -1;}
function appendByHeader_(sh,o){const cols=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];sh.appendRow(cols.map(c=>Object.prototype.hasOwnProperty.call(o,c)?o[c]:''));}
function seedNutritionDemo(){
  const ss=SpreadsheetApp.openById(nutritionSpreadsheetId_());
  if(ss.getId()!==nutritionSpreadsheetId_())throw new Error('只能在獨立虛構測試表執行');
  const today=new Date();const tz='Asia/Taipei';const ymd=d=>Utilities.formatDate(d,tz,'yyyy-MM-dd');
  const shift=n=>{const d=new Date(today);d.setDate(d.getDate()+n);return d;};
  const c=ss.getSheetByName('Clients'),m=ss.getSheetByName('Meal_Intake'),meals=ss.getSheetByName('Meals');
  if(!c||!m||!meals)throw new Error('請先執行 setupNutritionTestSystem');
  if(findRow_(c,1,'TEST-8WK-001')<0)appendByHeader_(c,{client_id:'TEST-8WK-001',client_label:'虛構學員 A',course_start:ymd(shift(-7)),course_end:ymd(shift(48)),active:'是',goal_text:'八週內練習每天至少有一餐搭配蔬菜、學會描述份量',goal_type:'學習正確飲食觀念',goal_rule:'每日至少一餐自述有蔬菜並經教練確認',daily_expected_meals:3,daily_target_goal_meals:1,notes:'完全虛構，僅供測試',created_at:ymd(today)});
  for(let i=1;i<=7;i++){
    const day=ymd(shift(-i)),id='DEMO-MEAL-'+day;
    if(findRow_(meals,1,id)<0)appendByHeader_(meals,{submission_id:id,client_id:'TEST-8WK-001',meal_date:day,meal_type:'午餐',meal_text:'便當：米飯、豆腐、青菜（虛構）',photo_drive_url:'',ate_all:'未確認',portion_notes:'未提供',client_goal:'練習每日一餐有蔬菜',observed_foods:'米飯、豆腐、青菜（僅虛構文字）',goal_alignment:'可觀察支持',ai_coach_assessment:'需要核實實際攝取狀況',missing_info:'是否吃完、實際份量',ai_client_draft:'可以試著記錄實際份量與蔬菜搭配。',coach_approved_text:'',coach_goal_met:i%2===0?'是':'待確認',review_status:'待教練審核',manually_replied_at:'',processing_status:'demo',issue_flags:'',created_at:ymd(today)});
  }
  Logger.log('已加入虛構學員 TEST-8WK-001 和過去7天的測試餐點；不含任何真實個資。');
}
function formDate_(e,key){
 const sh=e.range.getSheet();const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
 const col=headers.indexOf(key);if(col<0)throw new Error('缺少日期欄位');
 const value=sh.getRange(e.range.getRow(),col+1).getValue();
 if(value instanceof Date&&!isNaN(value.getTime()))return Utilities.formatDate(value,'Asia/Taipei','yyyy-MM-dd');
 const text=String(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(text))throw new Error('日期須為 YYYY-MM-DD');
 const d=new Date(text+'T00:00:00Z');if(isNaN(d.getTime())||d.toISOString().slice(0,10)!==text)throw new Error('無效日期');return text;
}

function nutritionSpreadsheetId_(){
 const id=PropertiesService.getScriptProperties().getProperty('NUTRITION_SPREADSHEET_ID');
 if(!id)throw new Error('Set NUTRITION_SPREADSHEET_ID in Script Properties first');
 return id;
}
