import { activeEntries, bottomFive, calculateScores, type Classroom, type Score } from './classroom';
export type ExportOptions={start:string;end:string;scope:'all'|'top'|'bottom';details:boolean};
export async function makeWorkbook(data:Classroom,options:ExportOptions){
 const {default:ExcelJS}=await import('exceljs');const workbook=new ExcelJS.Workbook();workbook.creator='同班记';workbook.created=new Date();
 const ranked=calculateScores(data.students,data.entries,options.start,options.end);const selected:Score[]=(options.scope==='bottom'?bottomFive(ranked):options.scope==='top'?ranked.slice(0,10):ranked).sort((a,b)=>a.number.localeCompare(b.number,'zh-CN',{numeric:true}));
 const cumulative=new Map(calculateScores(data.students,data.entries,undefined,options.end).map(s=>[s.id,s.total]));const studentMap=new Map(data.students.map(s=>[s.id,s]));
 const title=`${data.name} · 积分周报`;const label=options.scope==='bottom'?'后 5 名（含边界同分）':options.scope==='top'?'前 10 位':'全班';
 const summary=workbook.addWorksheet('积分汇总');summary.columns=[{width:12},{width:16},{width:16},{width:12},{width:12},{width:14},{width:14}];
 summary.addRow([title]);summary.mergeCells('A1:G1');summary.addRow([`${options.start} 至 ${options.end} · ${label}${data.demo?' · 演示数据':''}`]);summary.mergeCells('A2:G2');summary.addRow(['学号','姓名','小组','本周加分','本周扣分','本周累计','学期累计']);
 for(const row of selected)summary.addRow([row.number,row.name,row.group,row.plus,row.minus,row.total,cumulative.get(row.id)||0]);
 summary.views=[{state:'frozen',ySplit:3}];summary.autoFilter={from:'A3',to:`G${3+selected.length}`};
 for(let i=4;i<=7;i++)summary.getColumn(i).numFmt='0;[Red]-0;0';
 if(options.details){
  const detail=workbook.addWorksheet('加减分明细');
  detail.columns=[{width:15},{width:12},{width:16},{width:12},{width:32},{width:14},{width:10},{width:14},{width:18},{width:12},{width:28},{width:28},{width:28}];
  detail.addRow([`${data.name} · 加减分明细`]);detail.mergeCells('A1:M1');
  detail.addRow([`${options.start} 至 ${options.end} · 合计分值 = 单次分值 × 次数；已撤销记录仅供核对，不计入积分`]);detail.mergeCells('A2:M2');
  detail.addRow(['发生日期','学号','姓名','类别','事项','单次分值','次数','合计分值','记录员','状态','登记时间','撤销时间','撤销原因']);
  const ids=new Set(selected.map(s=>s.id));
  const rows=data.entries.filter(e=>e.date>=options.start&&e.date<=options.end&&ids.has(e.studentId)).sort((a,b)=>a.date.localeCompare(b.date)||a.createdAt.localeCompare(b.createdAt));
  for(const entry of rows){
   const student=studentMap.get(entry.studentId);
   detail.addRow([entry.date,student?.number||'',student?.name||'',entry.category,entry.title,entry.unitPoints??entry.points,entry.quantity??1,entry.points,entry.operator,entry.voidedAt?'已撤销':'有效',new Date(entry.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),entry.voidedAt?new Date(entry.voidedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'',entry.voidReason||'']);
  }
  detail.views=[{state:'frozen',ySplit:3}];detail.autoFilter={from:'A3',to:`M${3+rows.length}`};
  detail.getColumn(6).numFmt='0;[Red]-0;0';detail.getColumn(7).numFmt='0';detail.getColumn(8).numFmt='0;[Red]-0;0';
 }
 for(const sheet of workbook.worksheets){sheet.getRow(1).font={name:'微软雅黑',size:17,bold:true,color:{argb:'FF342E47'}};sheet.getRow(1).height=32;sheet.getRow(2).font={name:'微软雅黑',size:11,color:{argb:'FF736982'}};sheet.getRow(2).height=25;sheet.getRow(3).height=27;sheet.getRow(3).eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFC7B0F5'}};cell.font={name:'微软雅黑',bold:true,size:11,color:{argb:'FF342E47'}}});sheet.eachRow((row,index)=>{if(index>3){row.height=24;row.font={name:'微软雅黑',size:11};if(index%2===0)row.eachCell(cell=>cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF5F1FF'}})}row.alignment={vertical:'middle'}});sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};}
 const buffer=await workbook.xlsx.writeBuffer();const filename=`${data.name}_${options.start}_${options.end}_${label}${data.demo?'_演示':''}.xlsx`.replace(/[\\/:*?"<>|]/g,'-');
 return {buffer,filename,studentCount:selected.length,recordCount:activeEntries(data.entries,options.start,options.end).length};
}
export async function downloadWorkbook(data:Classroom,options:ExportOptions){const result=await makeWorkbook(data,options);const blob=new Blob([new Uint8Array(result.buffer)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=result.filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return result;}
