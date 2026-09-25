import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { rules as defaultRules } from '../lib/classroom.ts';

const sourceUrl = new URL('../lib/rules-workbook.ts', import.meta.url).href;
const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === './classroom' && context.parentURL === sourceUrl ? './classroom.ts' : specifier, context);
  },
});
const { makeRulesWorkbook } = await import('../lib/rules-workbook.ts');
resolver.deregister();

function classroom(rules) {
  return {
    name: '测试班级', demo: false, rules,
    students: [{ id: 'student-1', number: '01', name: '学生隐私不应导出', group: '第一组' }],
    entries: [{ id: 'entry-1', batchId: 'batch-1', studentId: 'student-1', title: '已删除规则只在历史记录中', category: '作业', points: -98, date: '2026-09-25', createdAt: '2026-09-25T01:00:00.000Z', operator: '记录员隐私不应导出', voidedAt: null }],
  };
}

async function exported(data) {
  const result = await makeRulesWorkbook(data);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.buffer);
  return { result, workbook, sheet: workbook.getWorksheet('班级公约') };
}

test('rules workbook exports only current rules with numeric signed points and intact notes', async () => {
  const rules = [
    { id: 'plus', category: '上课', title: '主动举手回答问题', points: 2, note: '每次回答计一次\n由老师确认' },
    { id: 'minus', category: '卫生', title: '无故不值日', points: -3, note: '请核对值日名单。' },
    { id: 'no-note', category: '早读', title: '早读认真', points: 1 },
  ];
  const { result, workbook, sheet } = await exported(classroom(rules));
  assert.equal(result.ruleCount, 3);
  assert.deepEqual(workbook.worksheets.map(worksheet => worksheet.name), ['班级公约']);
  assert.equal(sheet.getCell('A1').value, '测试班级 · 班级公约');
  assert.match(sheet.getCell('A2').value, /^导出日期：\d{4}-\d{2}-\d{2} · 共 3 项$/);
  assert.deepEqual(sheet.getRow(3).values.slice(1), ['序号', '类别', '事项', '类型', '单次分值', '说明']);
  assert.deepEqual(sheet.getRow(4).values.slice(1), [1, '上课', '主动举手回答问题', '加分', 2, rules[0].note]);
  assert.deepEqual(sheet.getRow(5).values.slice(1), [2, '卫生', '无故不值日', '扣分', -3, rules[1].note]);
  assert.equal(sheet.getCell('F6').value, '');
  assert.equal(sheet.getCell('E4').type, ExcelJS.ValueType.Number);
  assert.equal(sheet.getCell('E5').type, ExcelJS.ValueType.Number);
  const values = JSON.stringify(sheet.getSheetValues());
  assert.doesNotMatch(values, /学生隐私不应导出|记录员隐私不应导出|已删除规则只在历史记录中|-98/);
});

test('an empty rules array stays empty while an undefined legacy array uses default rules', async () => {
  const empty = await exported(classroom([]));
  assert.equal(empty.result.ruleCount, 0);
  assert.equal(empty.sheet.rowCount, 3);
  assert.equal(empty.sheet.autoFilter, 'A3:F3');
  assert.match(empty.sheet.getCell('A2').value, /共 0 项/);
  const legacy = await exported(classroom(undefined));
  assert.equal(legacy.result.ruleCount, defaultRules.length);
  assert.equal(legacy.sheet.rowCount, defaultRules.length + 3);
  defaultRules.forEach((rule, index) => {
    assert.equal(legacy.sheet.getCell(`C${index + 4}`).value, rule.title);
    assert.equal(legacy.sheet.getCell(`E${index + 4}`).value, rule.points);
  });
});

test('formula-looking text stays literal and filename excludes filesystem special characters', async () => {
  const titles = ['=HYPERLINK("https://example.com","原文")', '+SUM(1,2)', '-1+2', '@事项 & <说明>'];
  const notes = ['=1+1', '+2+3', '-3+4', '@SUM(A1:A2)\n原样保留"引号"、&、<、>'];
  const data = classroom(titles.map((title, index) => ({ id: String(index), category: '其他', title, points: index % 2 ? -1 : 1, note: notes[index] })));
  data.name = '=班级/\\:*?"<>|\n\u0000  ';
  const { result, sheet } = await exported(data);
  assert.doesNotMatch(result.filename, /[\\/:*?"<>|\n\r\u0000]/);
  assert.match(result.filename, /_班级公约_\d{4}-\d{2}-\d{2}\.xlsx$/);
  titles.forEach((title, index) => {
    for (const [column, value] of [['C', title], ['F', notes[index]]]) {
      const cell = sheet.getCell(`${column}${index + 4}`);
      assert.equal(cell.value, value);
      assert.equal(cell.type, ExcelJS.ValueType.String);
      assert.equal(cell.formula, undefined);
      assert.equal(cell.numFmt, '@');
    }
  });
});

test('headers, filter, wrapping and row heights remain readable for long notes', async () => {
  const note = '需要老师确认后记录，说明分值和次数的依据。'.repeat(15);
  const { sheet } = await exported(classroom([{ id: 'long', category: '其他', title: '较长说明的公约', points: -2, note }]));
  assert.deepEqual(sheet.model.merges, ['A1:F1', 'A2:F2']);
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].ySplit, 3);
  assert.equal(sheet.autoFilter, 'A3:F4');
  assert.equal(sheet.getColumn(6).width, 65);
  assert.equal(sheet.getCell('F4').alignment.wrapText, true);
  assert.ok(sheet.getRow(4).height > 100);
  assert.equal(sheet.getCell('F4').value, note);
  assert.equal(sheet.getCell('E4').numFmt, '+0;[Red]-0;0');
  assert.equal(sheet.getCell('F3').fill.fgColor.argb, 'FFC7B0F5');
  assert.equal(sheet.pageSetup.orientation, 'landscape');
});
