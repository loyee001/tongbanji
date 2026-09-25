'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { chinaToday, validDate, type Classroom } from '@/lib/classroom';
import { BLANK_REGISTER_PAGE_SIZE, downloadBlankRegisterWorkbook } from '@/lib/blank-register-workbook';

type Props = { data: Classroom; onClose: () => void };

export default function BlankRegisterDialog({ data, onClose }: Props) {
  const [date, setDate] = useState(chinaToday);
  const [blankDate, setBlankDate] = useState(false);
  const [exporting, setExporting] = useState(false);
  const pageCount = Math.ceil(data.students.length / BLANK_REGISTER_PAGE_SIZE);
  const previewStudents = [...data.students]
    .sort((a, b) => a.number.localeCompare(b.number, 'zh-CN', { numeric: true }))
    .slice(0, 3);

  async function exportBlankRegister() {
    if (exporting) return;
    if (!blankDate && !validDate(date)) {
      toast.error('请选择有效日期，或勾选“日期留空”。');
      return;
    }
    setExporting(true);
    try {
      const result = await downloadBlankRegisterWorkbook(data, { date: blankDate ? '' : date });
      toast.success(`已导出 ${result.studentCount} 位同学的登记空表，共 ${result.pageCount} 页。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '空表生成失败，请重试。');
    } finally {
      setExporting(false);
    }
  }

  return <Dialog open onOpenChange={open => { if (!open && !exporting) onClose(); }}>
    <DialogContent className="app-dialog blank-register-dialog">
      <DialogHeader>
        <DialogTitle>导出每日登记空表</DialogTitle>
        <DialogDescription>{data.name} · 全班 {data.students.length} 人 · 按学号排列{data.demo ? ' · 演示名单' : ''}</DialogDescription>
      </DialogHeader>
      <div className="form-section">
        <label htmlFor="blank-register-date">登记日期
          <Input id="blank-register-date" type="date" value={date} disabled={blankDate || exporting} onChange={event => setDate(event.target.value)} />
        </label>
        <label className="checkbox-label blank-date-option">
          <Checkbox checked={blankDate} disabled={exporting} onCheckedChange={checked => setBlankDate(checked === true)} />
          日期留空，打印后手填
        </label>
      </div>
      <figure className="blank-register-preview">
        <figcaption>表格预览 · 加减分栏留空手写</figcaption>
        <div className="blank-register-table-wrap">
          <table>
            <thead><tr>
              <th scope="col">学号</th><th scope="col">姓名</th>
              <th scope="col">加分事项及次数<small>如：举手 × 3 次</small></th>
              <th scope="col">扣分事项及次数<small>如：课间违纪 × 3 次</small></th>
            </tr></thead>
            <tbody>{previewStudents.map(student => <tr key={student.id}><td>{student.number}</td><td>{student.name}</td><td /><td /></tr>)}</tbody>
          </table>
        </div>
        {data.students.length > previewStudents.length && <p>导出包含全部 {data.students.length} 位同学。</p>}
      </figure>
      {data.students.length ? <p className="form-note">A4 竖向黑白打印，每页最多 {BLANK_REGISTER_PAGE_SIZE} 人，全班共 {pageCount} 页。每页都有班级、日期和记录员填写栏。打开 Excel 后选择“打印整个工作簿”，即可打印全班空表。</p> : <p className="form-note">班级还没有学生，请先在班级设置中添加名单。</p>}
      <button className="button button-primary" disabled={exporting || !data.students.length} onClick={exportBlankRegister}>
        <Download size={17} />{exporting ? '正在生成…' : '下载登记空表（Excel）'}
      </button>
    </DialogContent>
  </Dialog>;
}
