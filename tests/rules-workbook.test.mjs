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
  assert.deepEqual(sheet.getRow(5).values.slice(1), [2, '早读', '早读认真', '加分', 1, '']);
  assert.deepEqual(sheet.getRow(6).values.slice(1), [3, '卫生', '无故不值日', '扣分', -3, rules[1].note]);
  assert.equal(sheet.getCell('E4').type, ExcelJS.ValueType.Number);
  assert.equal(sheet.getCell('E6').type, ExcelJS.ValueType.Number);
  const values = JSON.stringify(sheet.getSheetValues());
  assert.doesNotMatch(values, /学生隐私不应导出|记录员隐私不应导出|已删除规则只在历史记录中|-98/);
});

test('mixed rules form stable plus/minus groups without mutating the input or inserting data rows', async () => {
  const rules = Object.freeze([
    Object.freeze({ id: 'minus-first', category: '卫生', title: '扣分甲', points: -2, note: '扣分甲说明' }),
    Object.freeze({ id: 'plus-first', category: '上课', title: '加分甲', points: 1, note: '加分甲说明' }),
    Object.freeze({ id: 'minus-second', category: '课间', title: '扣分乙', points: -1, note: '扣分乙说明' }),
    Object.freeze({ id: 'plus-second', category: '作业', title: '加分乙', points: 3, note: '加分乙说明' }),
  ]);
  const before = structuredClone(rules);
  const { result, sheet } = await exported(classroom(rules));
  assert.deepEqual(rules, before);
  assert.equal(result.ruleCount, 4);
  assert.equal(sheet.rowCount, 7);
  assert.equal(sheet.columnCount, 6);
  assert.deepEqual([4, 5, 6, 7].map(row => sheet.getRow(row).values.slice(1)), [
    [1, '上课', '加分甲', '加分', 1, '加分甲说明'],
    [2, '作业', '加分乙', '加分', 3, '加分乙说明'],
    [3, '卫生', '扣分甲', '扣分', -2, '扣分甲说明'],
    [4, '课间', '扣分乙', '扣分', -1, '扣分乙说明'],
  ]);
  assert.equal(sheet.autoFilter, 'A3:F7');
  assert.equal(sheet.pageSetup.printArea, 'A1:F7');
});

test('all-plus and all-minus exports preserve every rule without empty groups', async () => {
  for (const points of [1, -1]) {
    const rules = ['乙', '甲', '丙'].map((title, index) => ({
      id: String(index), category: '其他', title, points: points * (index + 1), note: `说明${title}`,
    }));
    const { result, sheet } = await exported(classroom(rules));
    assert.equal(result.ruleCount, 3);
    assert.equal(sheet.rowCount, 6);
    rules.forEach((rule, index) => {
      assert.deepEqual(sheet.getRow(index + 4).values.slice(1), [
        index + 1, rule.category, rule.title, points > 0 ? '加分' : '扣分', rule.points, rule.note,
      ]);
    });
    assert.equal(sheet.pageSetup.printArea, 'A1:F6');
  }
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
  const groupedDefaults = [...defaultRules.filter(rule => rule.points > 0), ...defaultRules.filter(rule => rule.points < 0)];
  groupedDefaults.forEach((rule, index) => {
    assert.equal(legacy.sheet.getCell(`C${index + 4}`).value, rule.title);
    assert.equal(legacy.sheet.getCell(`E${index + 4}`).value, rule.points);
  });
});

test('all 20 default rules fit one landscape A4 page with a complete print area', async () => {
  const { result, sheet } = await exported(classroom(defaultRules));
  assert.equal(defaultRules.length, 20);
  assert.equal(result.ruleCount, 20);
  assert.equal(sheet.rowCount, 23);
  assert.equal(sheet.columnCount, 6);
  assert.equal(sheet.getRow(1).height, 30);
  assert.equal(sheet.getRow(2).height, 22);
  assert.equal(sheet.getRow(3).height, 26);
  const exportedTitles = [];
  for (let rowNumber = 4; rowNumber <= 23; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    assert.equal(row.height, 22);
    assert.equal(row.font.size, 10);
    assert.equal(row.getCell(1).value, rowNumber - 3);
    exportedTitles.push(row.getCell(3).value);
  }
  assert.deepEqual([...exportedTitles].sort(), defaultRules.map(rule => rule.title).sort());
  assert.equal(new Set(exportedTitles).size, 20);
  assert.equal(sheet.pageSetup.paperSize, 9);
  assert.equal(sheet.pageSetup.orientation, 'landscape');
  assert.equal(sheet.pageSetup.fitToPage, true);
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.equal(sheet.pageSetup.fitToHeight, 1);
  assert.equal(sheet.pageSetup.printArea, 'A1:F23');
  assert.equal(sheet.pageSetup.printTitlesRow, '1:3');
  for (const edge of ['left', 'right', 'top', 'bottom']) {
    assert.equal(sheet.pageSetup.margins[edge], 0.3);
  }
  const printableHeight = 210 / 25.4 * 72 - (sheet.pageSetup.margins.top + sheet.pageSetup.margins.bottom) * 72;
  let contentHeight = 0;
  sheet.eachRow(row => { contentHeight += row.height; });
  assert.ok(contentHeight <= printableHeight, `${contentHeight}pt exceeds landscape A4 height ${printableHeight}pt`);
});

test('formula-looking text stays literal and filename excludes filesystem special characters', async () => {
  const titles = ['=HYPERLINK("https://example.com","原文")', '+SUM(1,2)', '-1+2', '@事项 & <说明>'];
  const notes = ['=1+1', '+2+3', '-3+4', '@SUM(A1:A2)\n原样保留"引号"、&、<、>'];
  const data = classroom(titles.map((title, index) => ({ id: String(index), category: '其他', title, points: index % 2 ? -1 : 1, note: notes[index] })));
  data.name = '=班级/\\:*?"<>|\n\u0000  ';
  const { result, sheet } = await exported(data);
  assert.doesNotMatch(result.filename, /[\\/:*?"<>|\n\r\u0000]/);
  assert.match(result.filename, /_班级公约_\d{4}-\d{2}-\d{2}\.xlsx$/);
  [0, 2, 1, 3].forEach((sourceIndex, rowIndex) => {
    for (const [column, value] of [['C', titles[sourceIndex]], ['F', notes[sourceIndex]]]) {
      const cell = sheet.getCell(`${column}${rowIndex + 4}`);
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
