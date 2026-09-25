import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import ExcelJS from 'exceljs';

// Next.js resolves this extensionless import; Node's type-strip test runner needs .ts.
const sourceUrl = new URL('../lib/export-workbook.ts', import.meta.url).href;
const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === './classroom' && context.parentURL === sourceUrl ? './classroom.ts' : specifier, context);
  },
});
const { makeWorkbook } = await import('../lib/export-workbook.ts');
resolver.deregister();

const options = { start: '2026-09-21', end: '2026-09-27', scope: 'all', details: true };
function entry(id, points, extra = {}) {
  return { id, batchId: id, studentId: 'student-1', title: id, category: '作业', points, date: '2026-09-25', createdAt: '2026-09-25T01:00:00.000Z', operator: '记录员', voidedAt: null, ...extra };
}
function fixture() {
  return {
    name: '测试班级', demo: false,
    students: [{ id: 'student-1', number: '01', name: '同学甲', group: '第一组' }, { id: 'student-2', number: '02', name: '同学乙', group: '第一组' }],
    entries: [
      entry('期初', 4, { date: '2026-09-20' }),
      entry('加分三次', 3, { unitPoints: 1, quantity: 3 }),
      entry('扣分三次', -6, { unitPoints: -2, quantity: 3 }),
      entry('旧扣分', -1),
      entry('旧加分', 2),
      entry('已撤销多次扣分', -8, { unitPoints: -2, quantity: 4, voidedAt: '2026-09-25T02:00:00.000Z', voidReason: '选择错误' }),
      entry('下期', 9, { date: '2026-09-28' }),
    ],
  };
}
async function exported(data = fixture(), overrides = {}) {
  const result = await makeWorkbook(data, { ...options, ...overrides });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.buffer);
  return { result, workbook };
}

test('XLSX details retain signed unit scores, quantities, totals and old records as one occurrence', async () => {
  const { result, workbook } = await exported();
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['积分汇总', '加减分明细']);
  assert.equal(result.studentCount, 2);
  assert.equal(result.recordCount, 4);
  const detail = workbook.getWorksheet('加减分明细');
  assert.deepEqual(detail.getRow(3).values.slice(1), ['发生日期','学号','姓名','类别','事项','单次分值','次数','合计分值','记录员','状态','登记时间','撤销时间','撤销原因']);
  const details = new Map();
  detail.eachRow((row, index) => { if (index > 3) details.set(row.getCell(5).value, row.values.slice(1)); });
  assert.equal(details.size, 5);
  assert.deepEqual(details.get('加分三次').slice(5, 8), [1, 3, 3]);
  assert.deepEqual(details.get('扣分三次').slice(5, 8), [-2, 3, -6]);
  assert.deepEqual(details.get('旧扣分').slice(5, 8), [-1, 1, -1]);
  assert.deepEqual(details.get('旧加分').slice(5, 8), [2, 1, 2]);
  assert.deepEqual(details.get('已撤销多次扣分').slice(5, 10), [-2, 4, -8, '记录员', '已撤销']);
  assert.equal(details.get('已撤销多次扣分')[12], '选择错误');
});

test('summary uses the requested seven columns and sums weekly and semester totals once', async () => {
  const { workbook } = await exported();
  const summary = workbook.getWorksheet('积分汇总');
  assert.deepEqual(summary.getRow(3).values.slice(1), ['学号', '姓名', '小组', '本周加分', '本周扣分', '本周累计', '学期累计']);
  assert.deepEqual(summary.model.merges, ['A1:G1', 'A2:G2']);
  assert.equal(summary.autoFilter, 'A3:G5');
  const rows = new Map();
  summary.eachRow((row, index) => { if (index > 3) rows.set(row.getCell(1).value, row.values.slice(1)); });
  assert.deepEqual([...rows.keys()], ['01', '02']);
  assert.deepEqual(rows.get('01'), ['01', '同学甲', '第一组', 5, 7, -2, 2]);
  assert.deepEqual(rows.get('02'), ['02', '同学乙', '第一组', 0, 0, 0, 0]);
  for (const column of ['D', 'E', 'F', 'G']) assert.equal(summary.getCell(`${column}4`).type, ExcelJS.ValueType.Number);
  const { workbook: summaryOnly } = await exported(fixture(), { details: false });
  assert.deepEqual(summaryOnly.worksheets.map(sheet => sheet.name), ['积分汇总']);
});

function rankingFixture() {
  const numbers = [10, 2, 12, 1, 11, 3, 9, 6, 4, 8, 5, 7];
  const weeklyScores = [-10, -9, -1, 0, 1, 1, 3, 4, 5, 6, 7, 8];
  return {
    name: '学号排序测试班级', demo: false,
    students: numbers.map(number => ({ id: `student-${number}`, number: String(number), name: `同学${number}`, group: '第一组' })),
    entries: [
      ...numbers.filter(number => weeklyScores[number - 1] !== 0).map(number => entry(`本周-${number}`, weeklyScores[number - 1], { studentId: `student-${number}` })),
      entry('以往高分', 100, { date: '2026-09-20', studentId: 'student-1' }),
      entry('以往低分', -100, { date: '2026-09-20', studentId: 'student-12' }),
    ],
  };
}

function summaryNumbers(workbook) {
  const numbers = [];
  workbook.getWorksheet('积分汇总').eachRow((row, index) => { if (index > 3) numbers.push(row.getCell(1).value); });
  return numbers;
}

test('all-student summary sorts numeric student numbers rather than weekly scores or lexical order', async () => {
  const { result, workbook } = await exported(rankingFixture());
  assert.equal(result.studentCount, 12);
  assert.deepEqual(summaryNumbers(workbook), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
});

test('top and bottom scopes select weekly ranks before sorting selected students by number', async () => {
  for (const [scope, expected] of [
    ['top', ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12']],
    ['bottom', ['1', '2', '3', '4', '5', '6']],
  ]) {
    const { result, workbook } = await exported(rankingFixture(), { scope });
    assert.equal(result.studentCount, expected.length);
    assert.deepEqual(summaryNumbers(workbook), expected);
    const detailNumbers = new Set();
    workbook.getWorksheet('加减分明细').eachRow((row, index) => { if (index > 3) detailNumbers.add(row.getCell(2).value); });
    // Number 4 has zero points and must still appear in the summary despite having no entries.
    assert.deepEqual([...detailNumbers].sort((a, b) => Number(a) - Number(b)), expected.filter(number => number !== '4'));
  }
});

test('semester total stops at the selected week end and excludes future and revoked entries', async () => {
  const data = fixture();
  data.entries = [
    entry('历史加分', 5, { date: '2026-09-01' }),
    entry('上周扣分', -2, { date: '2026-09-20' }),
    entry('周首加分', 4, { date: options.start }),
    entry('周中扣分', -2),
    entry('周末扣分', -3, { date: options.end }),
    entry('未来加分', 99, { date: '2026-09-28' }),
    entry('已撤销历史加分', 30, { date: '2026-09-19', voidedAt: '2026-09-25T02:00:00.000Z', voidReason: '登记错误' }),
    entry('已撤销本周扣分', -40, { date: options.end, voidedAt: '2026-09-27T02:00:00.000Z', voidReason: '登记错误' }),
  ];
  const { workbook } = await exported(data);
  const summary = workbook.getWorksheet('积分汇总');
  assert.deepEqual(summary.getRow(4).values.slice(1), ['01', '同学甲', '第一组', 4, 5, -1, 2]);
  assert.deepEqual(summary.getRow(5).values.slice(1), ['02', '同学乙', '第一组', 0, 0, 0, 0]);
  const titles = [];
  workbook.getWorksheet('加减分明细').eachRow((row, index) => { if (index > 3) titles.push(row.getCell(5).value); });
  assert.deepEqual(titles, ['周首加分', '周中扣分', '周末扣分', '已撤销本周扣分']);
});

test('expanded detail layout includes all 13 columns in merges, filter, styles and frozen headers', async () => {
  const { workbook } = await exported();
  const detail = workbook.getWorksheet('加减分明细');
  assert.deepEqual(detail.model.merges, ['A1:M1', 'A2:M2']);
  assert.equal(detail.autoFilter, 'A3:M8');
  assert.equal(detail.views[0].state, 'frozen');
  assert.equal(detail.views[0].ySplit, 3);
  assert.equal(detail.getColumn(6).width, 14);
  assert.equal(detail.getColumn(7).width, 10);
  assert.equal(detail.getColumn(8).width, 14);
  assert.equal(detail.getColumn(13).width, 28);
  assert.equal(detail.getCell('F5').numFmt, '0;[Red]-0;0');
  assert.equal(detail.getCell('G5').numFmt, '0');
  assert.equal(detail.getCell('H5').numFmt, '0;[Red]-0;0');
  assert.equal(detail.getCell('M3').fill.fgColor.argb, 'FFC7B0F5');
  assert.equal(detail.pageSetup.orientation, 'landscape');
});
