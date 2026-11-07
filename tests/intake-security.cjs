const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), ctx);
let written;
const sheet = {
  getLastColumn: () => 4,
  getRange: () => ({ getValues: () => [['meal_text', 'notes', 'count', 'missing']] }),
  appendRow: values => { written = Array.from(values); },
};
ctx.appendByHeader_(sheet, { meal_text: '=1+1', notes: 'Synthetic meal', count: 0 });
assert.deepEqual(written, ["'=1+1", 'Synthetic meal', 0, '']);
assert.equal(ctx.literalCell_('  =1+1'), "'  =1+1");
assert.equal(ctx.literalCell_('Normal = comparison'), 'Normal = comparison');
assert.equal(ctx.literalCell_(false), false);
assert.equal(ctx.literalCell_(-1), -1);
console.log('Intake literal-cell regression checks passed (mocked Sheets; no cloud calls).');
