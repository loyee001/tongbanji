import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import type { ClearEntriesInput } from '../lib/clear-entries-input';
import type { SqliteDatabase } from './sqlite';

export class ClearEntriesError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function entriesSnapshot(connection: DatabaseSync, classId: string) {
  // Include every stored field, including void metadata and entry quantities.
  const rows = connection.prepare(`SELECT e.* FROM entries e
    JOIN students s ON s.id=e.student_id WHERE s.class_id=? ORDER BY e.id COLLATE BINARY`).all(classId);
  const canonicalRows = rows.map(row => Object.keys(row).sort().map(key => [key, row[key]]));
  const revision = createHash('sha256')
    .update(JSON.stringify({ version: 1, classId, entries: canonicalRows }))
    .digest('hex');
  return { revision, count: rows.length };
}

export function entriesRevision(connection: DatabaseSync, classId: string): string {
  return entriesSnapshot(connection, classId).revision;
}

function requireRevision(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new ClearEntriesError(409, '积分记录已发生变化，请刷新页面后重新确认清空。');
  }
}

function requireOperationPassword(password: string): void {
  const expected = process.env.DATA_RESET_PASSWORD || '00000';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(digest(password), digest(expected))) {
    throw new ClearEntriesError(403, '操作密码不正确。');
  }
}

export async function clearEntries(
  db: SqliteDatabase,
  input: ClearEntriesInput,
  context: { classId: string; role: string; backupDir?: string },
): Promise<{ deletedCount: number; backupPath: string | null }> {
  if (context.role !== 'owner') throw new ClearEntriesError(403, '只有管理员可以清空积分记录。');
  if (input.action !== 'clearEntries' || input.confirmation !== '清空积分' ||
    typeof input.entriesRevision !== 'string' || !/^[a-f0-9]{64}$/.test(input.entriesRevision) ||
    typeof input.operationPassword !== 'string' || input.operationPassword.length < 1 || input.operationPassword.length > 128) {
    throw new ClearEntriesError(400, '请填写操作密码，并输入“清空积分”确认操作。');
  }
  requireOperationPassword(input.operationPassword);
  const initial = entriesSnapshot(db.connection(), context.classId);
  requireRevision(initial.revision, input.entriesRevision);
  if (initial.count === 0) return { deletedCount: 0, backupPath: null };

  const dataDir = resolve(process.env.DATA_DIR || resolve(process.cwd(), 'data'));
  const directory = resolve(context.backupDir || process.env.BACKUP_DIR || resolve(dataDir, '../backups'));
  const backupPath = resolve(directory, `tongbanji-before-clear-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.sqlite`);
  let created = false;
  let backupRevision: string;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    // Reserve a private file before the backup writes any student or account data.
    closeSync(openSync(backupPath, 'wx', 0o600));
    created = true;
    await backup(db.connection(), backupPath);
    chmodSync(backupPath, 0o600);
    const saved = new DatabaseSync(backupPath, { readOnly: true });
    try {
      const integrity = saved.prepare('PRAGMA integrity_check').all();
      if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok' ||
        saved.prepare('PRAGMA foreign_key_check').all().length !== 0) {
        throw new Error('The reset backup did not pass its integrity checks.');
      }
      backupRevision = entriesRevision(saved, context.classId);
    } finally {
      saved.close();
    }
    const file = openSync(backupPath, 'r');
    try { fsyncSync(file); } finally { closeSync(file); }
  } catch (error) {
    if (created) {
      try { unlinkSync(backupPath); } catch { /* Preserve the original backup error. */ }
    }
    console.error('Classroom reset backup failed', error);
    throw new ClearEntriesError(503, '自动备份失败，积分记录未清空，请稍后重试。');
  }

  // A completed backup is retained even if a concurrent update cancels the reset.
  requireRevision(backupRevision, input.entriesRevision);
  const deletedCount = db.transaction(() => {
    const current = entriesSnapshot(db.connection(), context.classId);
    requireRevision(current.revision, input.entriesRevision);
    const result = db.prepare('DELETE FROM entries WHERE student_id IN (SELECT id FROM students WHERE class_id=?)')
      .bind(context.classId).run();
    if (result.meta.changes !== current.count) throw new Error('The reset entry count did not match.');
    // Keep batches: their deduplication records prevent old requests restoring cleared entries.
    return result.meta.changes;
  });
  return { deletedCount, backupPath };
}
