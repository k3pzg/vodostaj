const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = fs.readFileSync('dashboard.html', 'utf8');
const code = page.slice(page.indexOf('function chartRows('), page.indexOf('function renderCharts('));
const context = vm.createContext({Date});
vm.runInContext(code, context);
test('missing hour breaks both series without inventing values', () => {
  const rows = [{dt: new Date('2026-10-20T07:00:00+02:00'), vodostaj: 12, protok: .09},
                {dt: new Date('2026-10-20T09:00:00+02:00'), vodostaj: 12, protok: .09}];
  const plotted = context.chartRows(rows);
  assert.equal(plotted.length, 3);
  assert.ok(Number.isNaN(plotted[1].vodostaj));
  assert.ok(Number.isNaN(plotted[1].protok));
  assert.equal(rows.length, 2);
});
test('regular hourly observations stay intact', () => {
  const rows = [0,1,2].map(h => ({dt: new Date(Date.UTC(2026,9,22,h)), vodostaj: 11, protok: .08}));
  const plotted = context.chartRows(rows);
  assert.equal(plotted.length, 3);
  plotted.forEach((r, i) => assert.equal(r, rows[i]));
});
