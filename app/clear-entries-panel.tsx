'use client';

import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import type { Classroom } from '@/lib/classroom';

type Props = {
  data: Classroom;
  busy: boolean;
  mutate: (input: Record<string, unknown>) => Promise<Classroom>;
};

type Confirmation = { revision: string; entryCount: number; studentCount: number };

export default function ClearEntriesPanel({ data, busy, mutate }: Props) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [phrase, setPhrase] = useState('');
  const [operationPassword, setOperationPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const working = pending || busy;
  const changed = !!confirmation && confirmation.revision !== data.entriesRevision;
  const canSubmit = !!confirmation && !changed && !working && phrase === '清空积分' && operationPassword.length > 0;

  function resetConfirmation() {
    setConfirmation(null);
    setPhrase('');
    setOperationPassword('');
    setError('');
  }

  function changeOpen(open: boolean) {
    if (submitting.current || working) return;
    if (!open) {
      resetConfirmation();
      return;
    }
    if (data.demo || data.role !== 'owner' || !data.entries.length || !data.entriesRevision) return;
    setPhrase('');
    setOperationPassword('');
    setError('');
    setConfirmation({
      revision: data.entriesRevision,
      entryCount: data.entries.length,
      studentCount: data.students.length,
    });
  }

  async function clearEntries() {
    if (!canSubmit || !confirmation || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      await mutate({
        action: 'clearEntries',
        confirmation: '清空积分',
        entriesRevision: confirmation.revision,
        operationPassword,
      });
      resetConfirmation();
      toast.success('积分记录已清空，全班积分已归零。清空前的备份已保存。');
    } catch (cause) {
      setOperationPassword('');
      setError(cause instanceof Error ? cause.message : '清空失败，请稍后重试。');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  if (data.demo || data.role !== 'owner') return null;

  return (
    <AlertDialog open={!!confirmation} onOpenChange={changeOpen}>
      <section className="clear-entries-panel" aria-labelledby="clear-entries-heading">
        <div>
          <h3 id="clear-entries-heading">清空积分记录</h3>
          <p className="help-text">用于清除测试数据，让全班重新从 0 分开始。</p>
        </div>
        <div className="form-note">
          <p>删除全部加分、扣分记录，包括已撤销记录，所有学生积分归零。</p>
          <p>保留学生名单、班级公约和登录账号。清空前会自动备份；备份失败时不会清空。</p>
          <p>此操作无法在页面内撤销。</p>
        </div>
        <p className="clear-entries-count">当前共 {data.students.length} 位同学、{data.entries.length} 条积分记录（含已撤销记录）。</p>
        <AlertDialogTrigger asChild>
          <button type="button" className="button clear-entries-button" disabled={working || !data.entries.length || !data.entriesRevision}>
            <Trash2 size={16} />清空积分记录
          </button>
        </AlertDialogTrigger>
        {!data.entries.length && <p className="help-text">目前没有积分记录，无需清空。</p>}
        {!!data.entries.length && !data.entriesRevision && <p className="help-text">请刷新页面后再操作。</p>}
      </section>
      <AlertDialogContent className="confirm-dialog clear-entries-confirm" onEscapeKeyDown={event => { if (working) event.preventDefault(); }}>
        <AlertDialogHeader>
          <AlertDialogTitle>确认清空全班积分记录？</AlertDialogTitle>
          <AlertDialogDescription>
            将删除 {confirmation?.entryCount ?? 0} 条加减分记录（含已撤销记录），{confirmation?.studentCount ?? 0} 位同学的积分归零。
            学生名单、公约和账号保留。系统会先备份，页面内无法撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form className="clear-entries-form" onSubmit={event => { event.preventDefault(); void clearEntries(); }} aria-busy={working}>
          <label htmlFor="clear-entries-phrase">请输入“清空积分”确认
            <Input id="clear-entries-phrase" value={phrase} onChange={event => setPhrase(event.target.value)} autoComplete="off" maxLength={20} disabled={working} />
          </label>
          <label htmlFor="clear-entries-password">操作密码
            <Input id="clear-entries-password" type="password" value={operationPassword} onChange={event => setOperationPassword(event.target.value)} autoComplete="off" maxLength={128} disabled={working} aria-describedby="clear-entries-password-help" />
          </label>
          <p id="clear-entries-password-help" className="help-text">请输入清空数据的操作密码，与登录密码不同。</p>
          {changed && <p role="alert" className="clear-entries-error">积分记录已发生变化，请取消后重新打开，核对最新记录再清空。</p>}
          {!!error && <p role="alert" className="clear-entries-error">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={working}>取消</AlertDialogCancel>
            <button type="submit" className="button clear-entries-button" disabled={!canSubmit}>{working ? '正在备份并清空…' : '确认清空积分'}</button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
