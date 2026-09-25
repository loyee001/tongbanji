import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import ExcelJS from 'exceljs';

const sourceUrl = new URL('../lib/blank-register-workbook.ts', import.meta.url).href;
const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === './classroom' && context.parentURL === sourceUrl ? './classroom.ts' : specifier, context);
  },
});
const { makeBlankRegisterWorkbook, BLANK_REGISTER_PAGE_SIZE } = await import('../lib/blank-register-workbook.ts');
resolver.deregister();

function classroom(count = 1) {
  return {
    name: '测试班级', demo: false,
    students: Array.from({ length: count }, (_, index) => ({ id: `student-${index + 1}`, number: String(index + 1), name: `测试${index + 1}`, group: '不应导出的小组' })).reverse(),
    entries: [{ title: '不应导出的历史事项', points: -9876, quantity: 8, operator: '不应导出的记录员' }],
  };
}

async function exported(data, date = '2026-09-25') {
  const result = await makeBlankRegisterWorkbook(data, { date });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.buffer);
  return { result, workbook };
}

const headers = ['学号', '姓名', '加分事项及次数\n如：举手 × 3 次', '扣分事项及次数\n如：课间违纪 × 3 次'];

test('blank register sorts the complete roster naturally without mutation and leaves recording cells truly empty', async () => {
  const data = classroom(10);
  data.students.find(student => student.number === '1').number = '001';
  Object.defineProperty(data, 'entries', { get() { throw new Error('Blank register must not read score history'); } });
  const initialOrder = data.students.map(student => student.number);
  const { result, workbook } = await exported(data);
  const sheet = workbook.worksheets[0];
  assert.equal(result.studentCount, 10);
  assert.equal(result.pageCount, 1);
  assert.deepEqual(data.students.map(student => student.number), initialOrder);
  assert.deepEqual(sheet.getColumn(1).values.slice(4, 14), ['001', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  assert.deepEqual(sheet.getRow(3).values.slice(1), headers);
  assert.equal(sheet.columnCount, 4);
  assert.equal(sheet.getCell('A4').type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('A4').numFmt, '@');
  for (let row = 4; row < 14; row++) {
    for (const column of [3, 4]) {
      const cell = sheet.getCell(row, column);
      assert.equal(cell.value, null);
      assert.equal(cell.type, ExcelJS.ValueType.Null);
      assert.equal(cell.formula, undefined);
    }
    for (let column = 1; column <= 4; column++) {
      const cell = sheet.getCell(row, column);
      for (const side of ['top', 'bottom', 'left', 'right']) {
        assert.equal(cell.border[side].style, 'thin');
        assert.equal(cell.border[side].color.argb, 'FF000000');
      }
    }
  }
  const values = JSON.stringify(sheet.getSheetValues());
  assert.doesNotMatch(values, /不应导出|9876|积分|名次|排名|小组|合计/);
});

test('42 students fit one A4 portrait page and 43 paginate without losing or duplicating students', async () => {
  assert.equal(BLANK_REGISTER_PAGE_SIZE, 42);
  for (const count of [42, 43]) {
    const { result, workbook } = await exported({ ...classroom(count), demo: true });
    const expectedPageCount = count === 42 ? 1 : 2;
    assert.equal(result.pageCount, expectedPageCount);
    assert.equal(result.studentCount, count);
    assert.equal(workbook.worksheets.length, expectedPageCount);
    assert.match(result.filename, /_演示\.xlsx$/);
    const exportedNumbers = [];
    workbook.worksheets.forEach((sheet, page) => {
      const pageSize = Math.min(42, count - page * 42);
      assert.equal(sheet.name, `登记空表 ${page + 1}`);
      assert.equal(sheet.rowCount, pageSize + 4);
      assert.equal(sheet.getCell('A1').value, '测试班级 · 每日加减分登记空表（演示）');
      assert.equal(sheet.getCell('A2').value, '日期：2026-09-25    记录员：________________');
      assert.deepEqual(sheet.getRow(3).values.slice(1), headers);
      assert.equal(sheet.getCell(`A${sheet.rowCount}`).value, `第 ${page + 1} / ${expectedPageCount} 页 · 本页 ${pageSize} 人`);
      assert.equal(sheet.columnCount, 4);
      assert.equal(sheet.pageSetup.paperSize, 9);
      assert.equal(sheet.pageSetup.orientation, 'portrait');
      assert.equal(sheet.pageSetup.fitToPage, true);
      assert.equal(sheet.pageSetup.fitToWidth, 1);
      assert.equal(sheet.pageSetup.fitToHeight, 1);
      assert.equal(sheet.pageSetup.blackAndWhite, true);
      assert.equal(sheet.pageSetup.printArea, `A1:D${pageSize + 4}`);
      for (let row = 4; row < sheet.rowCount; row++) {
        assert.equal(sheet.getRow(row).height, 16);
        assert.equal(sheet.getRow(row).font.size, 10);
        exportedNumbers.push(sheet.getCell(row, 1).value);
        assert.equal(sheet.getCell(row, 3).value, null);
        assert.equal(sheet.getCell(row, 4).value, null);
      }
      let contentHeight = 0;
      sheet.eachRow(row => { contentHeight += row.height; });
      const printableHeight = 297 / 25.4 * 72 - (sheet.pageSetup.margins.top + sheet.pageSetup.margins.bottom) * 72;
      assert.ok(contentHeight <= printableHeight, 'Standard rows fit the available A4 portrait height');
    });
    assert.equal(workbook.worksheets[0].getCell('A45').value, '42');
    assert.equal(workbook.worksheets[0].getCell('B45').value, '测试42');
    assert.equal(workbook.worksheets[0].pageSetup.printArea, 'A1:D46');
    assert.deepEqual(exportedNumbers, Array.from({ length: count }, (_, index) => String(index + 1)));
  }
});

test('blank dates remain hand-fillable, valid leap dates survive and invalid dates or an empty roster reject', async () => {
  const blank = await exported(classroom(), '');
  assert.equal(blank.workbook.worksheets[0].getCell('A2').value, '日期：________ 年 ____ 月 ____ 日    记录员：________________');
  assert.match(blank.result.filename, /_日期留空\.xlsx$/);
  const leap = await exported(classroom(), '2028-02-29');
  assert.match(leap.workbook.worksheets[0].getCell('A2').value, /2028-02-29/);
  assert.match(leap.result.filename, /_2028-02-29\.xlsx$/);
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-9-25', ' ', '=TODAY()']) {
    await assert.rejects(makeBlankRegisterWorkbook(classroom(), { date }), /有效的登记日期/);
  }
  await assert.rejects(makeBlankRegisterWorkbook(classroom(0), { date: '' }), /请先添加学生名单/);
});

test('formula-looking roster text remains literal and long names wrap without exposing other class data', async () => {
  const data = classroom(4);
  data.name = '=班级/\\:*?"<>|\n\u0000  ' + '长班级名称'.repeat(12);
  const names = ['=1+1', '+SUM(1,2)', '@姓名 & <原文>', '长姓名'.repeat(10)];
  const numbers = ['001', '002', '=1+2', '-1+2'];
  data.students = names.map((name, index) => ({ id: String(index), number: numbers[index], name, group: '不应导出的小组' }));
  const { result, workbook } = await exported(data);
  const sheet = workbook.worksheets[0];
  assert.doesNotMatch(result.filename, /[\\/:*?"<>|\n\r\u0000]/);
  assert.match(result.filename, /_登记空表_2026-09-25\.xlsx$/);
  assert.equal(sheet.getCell('A1').type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('A1').formula, undefined);
  assert.equal(sheet.getCell('A1').alignment.wrapText, true);
  assert.ok(sheet.getRow(1).height > 26);
  for (const student of data.students) {
    const row = [4, 5, 6, 7].find(row => sheet.getCell(row, 1).value === student.number);
    assert.ok(row);
    for (const [column, value] of [[1, student.number], [2, student.name]]) {
      const cell = sheet.getCell(row, column);
      assert.equal(cell.value, value);
      assert.equal(cell.type, ExcelJS.ValueType.String);
      assert.equal(cell.formula, undefined);
      assert.equal(cell.numFmt, '@');
      assert.equal(cell.alignment.wrapText, true);
    }
    if (student.name === names[3]) assert.ok(sheet.getRow(row).height > 16);
  }
  assert.doesNotMatch(JSON.stringify(sheet.getSheetValues()), /不应导出|9876/);
});
