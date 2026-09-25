import { chinaToday, rules as defaultRules, type Classroom } from './classroom';

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

export async function makeRulesWorkbook(data: Classroom) {
 const {default: ExcelJS} = await import('exceljs');
 const workbook = new ExcelJS.Workbook();
 const createdAt = new Date();
 const date = chinaToday(createdAt);
 const currentRules = [...(data.rules === undefined ? defaultRules : data.rules)]
  .sort((a, b) => Number(b.points > 0) - Number(a.points > 0));
 workbook.creator = '同班记';
 workbook.created = createdAt;

 const sheet = workbook.addWorksheet('班级公约');
 sheet.columns = [{width: 8}, {width: 14}, {width: 38}, {width: 10}, {width: 14}, {width: 65}];
 sheet.addRow([`${data.name} · 班级公约`]);
 sheet.mergeCells('A1:F1');
 sheet.addRow([`导出日期：${date} · 共 ${currentRules.length} 项${data.demo ? ' · 演示公约' : ''}`]);
 sheet.mergeCells('A2:F2');
 sheet.addRow(['序号', '类别', '事项', '类型', '单次分值', '说明']);

 currentRules.forEach((rule, index) => {
  const note = rule.note ?? '';
  const row = sheet.addRow([index + 1, rule.category, rule.title, rule.points > 0 ? '加分' : '扣分', rule.points, note]);
  row.font = {name: '微软雅黑', size: 10, color: {argb: 'FF342E47'}};
  row.alignment = {vertical: 'middle', wrapText: true};
  row.height = Math.min(409, Math.max(22, Math.max(wrappedLines(rule.title, 35), wrappedLines(note, 62)) * 14 + 8));
  for (const column of [1, 2, 4, 5]) row.getCell(column).alignment = {vertical: 'middle', horizontal: 'center', wrapText: true};
  if (index % 2 === 0) row.eachCell({includeEmpty: true}, cell => {
   cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FFF5F1FF'}};
  });
  const startsDeductions = index > 0 && currentRules[index - 1].points > 0 && rule.points <= 0;
  row.eachCell({includeEmpty: true}, cell => {
   cell.border = {
    top: {style: startsDeductions ? 'medium' : 'thin', color: {argb: 'FF736982'}},
    bottom: {style: 'thin', color: {argb: 'FF736982'}},
    left: {style: 'thin', color: {argb: 'FF736982'}},
    right: {style: 'thin', color: {argb: 'FF736982'}},
   };
  });
 });

 for (const column of [2, 3, 4, 6]) sheet.getColumn(column).numFmt = '@';
 sheet.getColumn(1).numFmt = '0';
 sheet.getColumn(5).numFmt = '+0;[Red]-0;0';
 sheet.getRow(1).font = {name: '微软雅黑', size: 17, bold: true, color: {argb: 'FF342E47'}};
 sheet.getRow(1).height = 30;
 sheet.getRow(1).alignment = {vertical: 'middle'};
 sheet.getRow(2).font = {name: '微软雅黑', size: 11, color: {argb: 'FF736982'}};
 sheet.getRow(2).height = 22;
 sheet.getRow(2).alignment = {vertical: 'middle'};
 sheet.getRow(3).height = 26;
 sheet.getRow(3).eachCell(cell => {
  cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FFC7B0F5'}};
  cell.font = {name: '微软雅黑', size: 11, bold: true, color: {argb: 'FF342E47'}};
  cell.alignment = {vertical: 'middle', horizontal: 'center'};
 });
 sheet.views = [{state: 'frozen', ySplit: 3}];
 sheet.autoFilter = {from: 'A3', to: `F${3 + currentRules.length}`};
 sheet.pageSetup = {
  paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1,
  horizontalCentered: true, printTitlesRow: '1:3', printArea: `A1:F${3 + currentRules.length}`,
  margins: {left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1},
 };

 const buffer = await workbook.xlsx.writeBuffer();
 const filename = `${safeClassName(data.name)}_班级公约_${date}${data.demo ? '_演示' : ''}.xlsx`;
 return {buffer, filename, ruleCount: currentRules.length};
}

export async function downloadRulesWorkbook(data: Classroom) {
 const result = await makeRulesWorkbook(data);
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
