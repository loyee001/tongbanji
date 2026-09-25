import { validDate, type Classroom } from './classroom';

export const BLANK_REGISTER_PAGE_SIZE = 21;

type BlankRegisterData = Pick<Classroom, 'name' | 'students' | 'demo'>;
type BlankRegisterOptions = {date: string};

function wrappedLines(text: string, width: number) {
 return text.split(/\r\n|\r|\n/).reduce((lines, part) => {
  const units = Array.from(part).reduce((total, character) => total + (character.codePointAt(0)! > 255 ? 2 : 1), 0);
  return lines + Math.max(1, Math.ceil(units / width));
 }, 0);
}

function safeClassName(name: string) {
 return Array.from(name).filter(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
  .join('').replace(/[\\/:*?"<>|]/g, '-').trim().replace(/[ .]+$/g, '').slice(0, 80) || '班级';
}

export async function makeBlankRegisterWorkbook(data: BlankRegisterData, options: BlankRegisterOptions) {
 if (typeof options.date !== 'string' || (options.date !== '' && !validDate(options.date))) {
  throw new Error('请选择有效的登记日期，或将日期留空。');
 }
 if (!data.students.length) throw new Error('请先添加学生名单，再导出登记空表。');

 const {default: ExcelJS} = await import('exceljs');
 const workbook = new ExcelJS.Workbook();
 workbook.creator = '同班记';
 workbook.created = new Date();
 const students = [...data.students].sort((a, b) => a.number.localeCompare(b.number, 'zh-CN', {numeric: true}));
 const pageCount = Math.ceil(students.length / BLANK_REGISTER_PAGE_SIZE);
 const title = `${data.name} · 每日加减分登记空表${data.demo ? '（演示）' : ''}`;
 const dateLabel = options.date || '________ 年 ____ 月 ____ 日';

 for (let page = 0; page < pageCount; page++) {
  const pageStudents = students.slice(page * BLANK_REGISTER_PAGE_SIZE, (page + 1) * BLANK_REGISTER_PAGE_SIZE);
  const sheet = workbook.addWorksheet(`登记空表 ${page + 1}`);
  sheet.columns = [{width: 10}, {width: 24}, {width: 55}, {width: 55}];
  for (const column of sheet.columns) column.numFmt = '@';
  sheet.addRow([title]);
  sheet.mergeCells('A1:D1');
  sheet.getRow(1).font = {name: '微软雅黑', size: 16, bold: true, color: {argb: 'FF000000'}};
  sheet.getRow(1).height = Math.max(26, wrappedLines(title, 92) * 20 + 6);
  sheet.getRow(1).alignment = {vertical: 'middle', horizontal: 'center', wrapText: true};
  sheet.addRow([`日期：${dateLabel}    记录员：________________`]);
  sheet.mergeCells('A2:D2');
  sheet.getRow(2).font = {name: '微软雅黑', size: 10, color: {argb: 'FF000000'}};
  sheet.getRow(2).height = 20;
  sheet.getRow(2).alignment = {vertical: 'middle', wrapText: true};
  sheet.addRow(['学号', '姓名', '加分事项及次数\n如：举手 × 3 次', '扣分事项及次数\n如：课间违纪 × 3 次']);
  sheet.getRow(3).height = 34;
  sheet.getRow(3).font = {name: '微软雅黑', size: 10, bold: true, color: {argb: 'FF000000'}};
  sheet.getRow(3).alignment = {vertical: 'middle', horizontal: 'center', wrapText: true};

  for (const student of pageStudents) {
   const row = sheet.addRow([student.number, student.name, null, null]);
   row.font = {name: '微软雅黑', size: 11, color: {argb: 'FF000000'}};
   row.alignment = {vertical: 'middle', horizontal: 'center', wrapText: true};
   // Normal rows plus the title, metadata, header and footer fit A4 landscape at 22 pt per student.
   row.height = Math.max(22, Math.max(wrappedLines(student.number, 8), wrappedLines(student.name, 21)) * 14 + 6);
   row.getCell(3).alignment = row.getCell(4).alignment = {vertical: 'middle', wrapText: true};
  }
  for (let rowNumber = 3; rowNumber <= 3 + pageStudents.length; rowNumber++) {
   for (let column = 1; column <= 4; column++) {
    sheet.getCell(rowNumber, column).border = {
     top: {style: 'thin', color: {argb: 'FF000000'}},
     bottom: {style: 'thin', color: {argb: 'FF000000'}},
     left: {style: 'thin', color: {argb: 'FF000000'}},
     right: {style: 'thin', color: {argb: 'FF000000'}},
    };
   }
  }
  const footer = sheet.addRow([`第 ${page + 1} / ${pageCount} 页 · 本页 ${pageStudents.length} 人`]);
  sheet.mergeCells(`A${footer.number}:D${footer.number}`);
  footer.font = {name: '微软雅黑', size: 9, color: {argb: 'FF000000'}};
  footer.alignment = {vertical: 'middle', horizontal: 'right'};
  footer.height = 16;
  sheet.views = [{state: 'frozen', ySplit: 3, showGridLines: false}];
  sheet.pageSetup = {
   paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1,
   blackAndWhite: true, showGridLines: false, horizontalCentered: true,
   margins: {left: 0.3, right: 0.3, top: 0.25, bottom: 0.25, header: 0.1, footer: 0.1},
   printArea: `A1:D${footer.number}`,
  };
 }

 const buffer = await workbook.xlsx.writeBuffer();
 const filename = `${safeClassName(data.name)}_登记空表_${options.date || '日期留空'}${data.demo ? '_演示' : ''}.xlsx`;
 return {buffer, filename, studentCount: students.length, pageCount};
}

export async function downloadBlankRegisterWorkbook(data: BlankRegisterData, options: BlankRegisterOptions) {
 const result = await makeBlankRegisterWorkbook(data, options);
 const blob = new Blob([new Uint8Array(result.buffer)], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 const url = URL.createObjectURL(blob);
 const anchor = document.createElement('a');
 try {
  anchor.href = url;
  anchor.download = result.filename;
  document.body.appendChild(anchor);
  anchor.click();
 } finally {
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
 }
 return result;
}
