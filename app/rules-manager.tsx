'use client';

import { useRef, useState, type Dispatch, type SetStateAction, type FormEvent } from 'react';
import { ArrowLeft, BookOpen, Download, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { categories, rules as defaultRules, signed, type Classroom, type Rule } from '@/lib/classroom';
import { createUuid } from '@/lib/uuid';
import { downloadRulesWorkbook } from '@/lib/rules-workbook';
import { toast } from 'sonner';

type Props = {
 data: Classroom;
 busy: boolean;
 onClose: () => void;
 mutate: (input: Record<string, unknown>) => Promise<Classroom>;
 setData: Dispatch<SetStateAction<Classroom>>;
 reload: () => Promise<void>;
};
type Editor = { rule: Rule; existing: boolean; title: string; category: string; points: string; note: string };

export default function RulesManager({data, busy, onClose, mutate, setData, reload}: Props) {
 const owner = data.role === 'owner';
 const active = data.rules ?? defaultRules;
 const deleted = data.deletedRules ?? [];
 const [query, setQuery] = useState('');
 const [category, setCategory] = useState('全部');
 const [trash, setTrash] = useState(false);
 const [editor, setEditor] = useState<Editor | null>(null);
 const [detail, setDetail] = useState<Rule | null>(null);
 const [deleting, setDeleting] = useState<Rule | null>(null);
 const [saving, setSaving] = useState(false);
 const [exporting, setExporting] = useState(false);
 const [error, setError] = useState('');
 const submitting = useRef(false);
 const locked = busy || saving;
 const visible = (trash ? deleted : active).filter(rule =>
  (category === '全部' || rule.category === category) &&
  (!query.trim() || `${rule.title} ${rule.note ?? ''}`.includes(query.trim())));

 async function resetAndReload() {
  setEditor(null); setDeleting(null); setDetail(null); setError('');
  await reload();
 }

 function edit(rule?: Rule) {
  const value = rule ?? {id: createUuid(), title: '', category: '其他', points: 1};
  setEditor({rule: value, existing: !!rule, title: value.title, category: value.category, points: String(value.points), note: value.note ?? ''});
  setDetail(null); setError('');
 }
 async function write(action: string, rule: Rule) {
  if (!owner || submitting.current || busy) return false;
  submitting.current = true; setSaving(true); setError('');
  try {
   if (data.demo) {
    setData(previous => {
     const current = previous.rules ?? defaultRules;
     const archived = previous.deletedRules ?? [];
     const next = {...rule, version: (rule.version ?? 0) + 1};
     if (action === 'createRule') return {...previous, rules: [...current, next]};
     if (action === 'updateRule') return {...previous, rules: current.map(row => row.id === rule.id ? next : row)};
     if (action === 'deleteRule') return {...previous, rules: current.filter(row => row.id !== rule.id), deletedRules: [...archived, next]};
     return {...previous, rules: [...current, next], deletedRules: archived.filter(row => row.id !== rule.id)};
    });
   } else {
    const fields = {title: rule.title, category: rule.category, points: rule.points, note: rule.note ?? ''};
    await mutate({action, id: rule.id, ...(action === 'createRule' ? fields : {version: rule.version, ...(action === 'updateRule' ? fields : {})})});
   }
   return true;
  } catch (cause) {
   setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
   return false;
  } finally { submitting.current = false; setSaving(false); }
 }
 async function saveEditor(event: FormEvent) {
  event.preventDefault();
  if (!editor) return;
  const points = Number(editor.points);
  if (!editor.title.trim() || !Number.isInteger(points) || points === 0 || Math.abs(points) > 100) {
   setError('请填写事项名称和 −100 至 100 之间的非零整数分值。'); return;
  }
  if (!editor.existing && active.length >= 200) { setError('最多保留 200 条有效公约，请先整理已有公约。'); return; }
  if (await write(editor.existing ? 'updateRule' : 'createRule', {...editor.rule, title: editor.title.trim(), category: editor.category, points, note: editor.note.trim()})) {
   toast.success(editor.existing ? '公约已修改，历史积分保持不变。' : '公约已新增，可在快速登记中使用。');
   setEditor(null);
  }
 }
 async function exportRules() {
  setExporting(true);
  try { const result = await downloadRulesWorkbook(data); toast.success(`已导出 ${result.ruleCount} 条班级公约。`); }
  catch { toast.error('公约导出失败，请重试。'); }
  finally { setExporting(false); }
 }
 return <>
  <Dialog open onOpenChange={open => { if (!open && !locked && !deleting) onClose(); }}>
   <DialogContent className="app-dialog rules-dialog" onEscapeKeyDown={event => { if (locked || deleting) event.preventDefault(); }}>
    <DialogHeader><DialogTitle>{editor ? (editor.existing ? '修改班级公约' : '新增班级公约') : detail ? '查看班级公约' : '班级公约'}</DialogTitle><DialogDescription>{data.demo ? '演示公约，刷新后重置。' : `${data.name} · 统一的加减分依据`}</DialogDescription></DialogHeader>
    {error && <div className="rules-error" role="alert"><span>{error}</span><button className="text-button" disabled={locked} onClick={() => void resetAndReload()}>{editor ? '取消本次编辑并刷新' : '返回列表并刷新'}</button></div>}
    {editor ? <form onSubmit={saveEditor} className="rules-editor"><fieldset disabled={locked} className="entry-fields">
     <label htmlFor="rule-title">事项名称<Input id="rule-title" autoFocus value={editor.title} maxLength={80} required onChange={event => setEditor({...editor, title: event.target.value})}/></label>
     <div className="form-grid"><label htmlFor="rule-category">类别<select id="rule-category" className="rule-select" value={editor.category} onChange={event => setEditor({...editor, category: event.target.value})}>{categories.map(value => <option key={value}>{value}</option>)}</select></label><label htmlFor="rule-points">单次加减分值<Input id="rule-points" type="number" step={1} min={-100} max={100} required value={editor.points} onChange={event => setEditor({...editor, points: event.target.value})}/></label></div>
     <p className="help-text">加分填写正整数，扣分填写负整数，不能为 0。</p>
     <label htmlFor="rule-note">公约说明（选填）<Textarea id="rule-note" rows={4} maxLength={500} placeholder="填写适用条件、次数说明或老师确认的执行方式" value={editor.note} onChange={event => setEditor({...editor, note: event.target.value})}/></label>
     <p className="help-text">{editor.note.length} / 500 字 · 保存后用于后续登记，历史积分不变。</p>
     <div className="rules-form-actions"><button type="button" className="button" onClick={() => {setEditor(null); setError('');}}>取消</button><button type="submit" className="button button-primary">{locked ? '正在保存…' : editor.existing ? '保存公约修改' : '保存新增公约'}</button></div>
    </fieldset></form> : detail ? <div className="rule-detail">
     <button className="text-button" onClick={() => setDetail(null)}><ArrowLeft size={16}/>返回公约列表</button>
     <div className="rule-detail-heading"><span className="category-tag">{detail.category}</span><strong className={detail.points > 0 ? 'positive' : 'negative'}>{signed(detail.points)} 分 / 次</strong></div>
     <h3>{detail.title}</h3><p className="rule-note-full">{detail.note || '暂无补充说明。'}</p>
     {owner && !trash && <button className="button" disabled={locked} onClick={() => edit(detail)}><Pencil size={15}/>修改公约</button>}
    </div> : <>
     <div className="rules-toolbar"><span className="rules-count"><BookOpen size={18}/>{active.length} 条有效公约</span><div><button className="button button-small" disabled={exporting || locked} onClick={exportRules}><Download size={16}/>{exporting ? '正在导出…' : '导出全部公约'}</button>{owner && <button className="button button-primary button-small" disabled={locked || active.length >= 200} onClick={() => edit()}><Plus size={16}/>新增公约</button>}</div></div>
     <div className="rules-filters"><div className="search"><Search/><Input aria-label="搜索班级公约" placeholder="搜索事项或说明" value={query} onChange={event => setQuery(event.target.value)}/></div><select className="rule-select" aria-label="筛选公约类别" value={category} onChange={event => setCategory(event.target.value)}>{['全部', ...categories].map(value => <option key={value}>{value}</option>)}</select></div>
     {owner && <div className="rules-status-tabs" role="group" aria-label="公约状态"><button className={!trash ? 'active' : ''} aria-pressed={!trash} onClick={() => {setTrash(false); setError('');}}>使用中</button><button className={trash ? 'active' : ''} aria-pressed={trash} onClick={() => {setTrash(true); setError('');}}>已删除 {deleted.length > 0 ? `(${deleted.length})` : ''}</button></div>}
     <div className="managed-rules-list">{visible.map(rule => <article key={rule.id} className="managed-rule">
      <div className="managed-rule-main"><span className="category-tag">{rule.category}</span><h3>{rule.title}</h3><strong className={rule.points > 0 ? 'positive' : 'negative'}>{signed(rule.points)}<small> 分 / 次</small></strong></div>
      {rule.note && <p className="managed-rule-note">{rule.note}</p>}
      <div className="managed-rule-actions"><button className="text-button" aria-label={`查看公约：${rule.title}`} onClick={() => setDetail(rule)}>查看</button>{owner && (trash ? <button className="text-button" disabled={locked || active.length >= 200} onClick={async () => {if (await write('restoreRule', rule)) toast.success('公约已恢复。');}}><RotateCcw size={14}/>恢复</button> : <><button className="text-button" aria-label={`修改公约：${rule.title}`} disabled={locked} onClick={() => edit(rule)}><Pencil size={14}/>修改</button><button className="text-button negative" aria-label={`删除公约：${rule.title}`} disabled={locked} onClick={() => {setDeleting(rule); setError('');}}><Trash2 size={14}/>删除</button></>)}</div>
     </article>)}</div>
     {!visible.length && <p className="empty-message">{query || category !== '全部' ? '没有找到符合条件的公约。' : trash ? '没有已删除的公约。' : '还没有班级公约，管理员可以新增第一条。'}</p>}
     <p className="help-text">{owner ? '删除后不再出现在登记选项中，可在“已删除”中恢复。已有积分记录保持不变。' : '公约由管理员维护，可查看、导出，并在快速登记中使用。'}</p>
    </>}
   </DialogContent>
  </Dialog>
  <AlertDialog open={!!deleting} onOpenChange={open => {if (!open && !locked) setDeleting(null);}}><AlertDialogContent className="confirm-dialog"><AlertDialogHeader><AlertDialogTitle>删除这条班级公约？</AlertDialogTitle><AlertDialogDescription>“{deleting?.title}”将从登记选项中移除，历史积分不变。之后可以在“已删除”中恢复。</AlertDialogDescription></AlertDialogHeader>{error && <div className="rules-error" role="alert"><span>{error}</span><button className="text-button" disabled={locked} onClick={() => void resetAndReload()}>返回列表并刷新</button></div>}<AlertDialogFooter><AlertDialogCancel disabled={locked}>取消</AlertDialogCancel><AlertDialogAction disabled={locked} onClick={async event => {event.preventDefault(); if (deleting && await write('deleteRule', deleting)) {setDeleting(null); toast.success('公约已删除，可在“已删除”中恢复。');}}}>{locked ? '正在删除…' : '确认删除公约'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </>;
}
