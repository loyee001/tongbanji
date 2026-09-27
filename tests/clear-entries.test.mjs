import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { SqliteDatabase } from '../db/sqlite.ts';
import { ClearEntriesError, clearEntries, entriesRevision } from '../db/clear-entries.ts';
import { recordEntries } from '../db/record-entries.ts';

const now = '2026-09-27T08:00:00.000Z';
const recordInput = {
  action: 'record', batchId: '1e143f20-5268-4b57-8e08-7ee2c30e8f78',
  studentIds: ['student-1', 'student-2'], date: '2026-09-27',
  items: [
    { title: '主动举手回答问题', category: '上课', points: 1, quantity: 3 },
    { title: '课间违纪', category: '课间', points: -1, quantity: 2 },
  ],
};
const recordContext = { userId: 'owner', operator: '管理员', now };

function rowsSnapshot(connection, { excludeEntries = false } = {}) {
  const tables = connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return JSON.stringify(tables
    .filter(({ name }) => !excludeEntries || name !== 'entries')
    .map(({ name }) => [name, connection.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
      .map(row => JSON.stringify(row)).sort()]));
}

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'tongbanji-clear-'));
  const backupDir = join(directory, 'backups');
  const db = new SqliteDatabase(join(directory, 'classroom.sqlite'), {
    migrationsDir: new URL('../drizzle/', import.meta.url).pathname,
  });
  const oldPassword = process.env.DATA_RESET_PASSWORD;
  delete process.env.DATA_RESET_PASSWORD;
  t.after(() => {
    if (oldPassword === undefined) delete process.env.DATA_RESET_PASSWORD;
    else process.env.DATA_RESET_PASSWORD = oldPassword;
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  db.batch([
    ...['main', 'other'].map(id => db.prepare('INSERT INTO classrooms (id,name,owner_id,created_at) VALUES (?,?,?,?)')
      .bind(id, `${id} 班级`, 'owner', now)),
    ...[
      ['student-1', 'main', '1', '同学甲', '第一组'],
      ['student-2', 'main', '2', '同学乙', '第二组'],
      ['student-3', 'main', '3', '无记录同学', '第二组'],
      ['other-student', 'other', '1', '其他班同学', '其他组'],
    ].map(values => db.prepare('INSERT INTO students (id,class_id,number,name,group_name) VALUES (?,?,?,?,?)').bind(...values)),
    ...['owner', 'recorder'].map(role => db.prepare('INSERT INTO accounts (id,email,name,password_hash,role) VALUES (?,?,?,?,?)')
      .bind(role, `${role}@example.test`, role, `opaque-hash-${role}`, role)),
    ...['owner', 'recorder'].map(role => db.prepare('INSERT INTO members (email,user_id,name,role) VALUES (?,?,?,?)')
      .bind(`${role}@example.test`, role, role, role)),
    db.prepare('INSERT INTO sessions (token_hash,account_id,expires_at) VALUES (?,?,?)')
      .bind('opaque-session-hash', 'owner', '2026-09-28T08:00:00.000Z'),
    db.prepare('INSERT INTO login_attempts (key,attempts,window_start) VALUES (?,?,?)')
      .bind('opaque-attempt-key', 2, 12345),
    ...['main', 'other'].map(id => db.prepare('INSERT INTO class_rule_initializations (class_id,initialized_at) VALUES (?,?)').bind(id, now)),
    ...['main', 'other'].map(id => db.prepare('INSERT INTO class_rules (id,class_id,category,title,points,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind('answer', id, '上课', '主动举手回答问题', 1, '保留公约说明', now, now)),
    db.prepare('INSERT INTO batches (id,creator_id,payload_hash,created_at) VALUES (?,?,?,?)')
      .bind('class-initialization', 'owner', 'initialization-marker', now),
    db.prepare('INSERT INTO batches (id,creator_id,payload_hash,created_at) VALUES (?,?,?,?)')
      .bind('other-batch', 'owner', 'other-class-hash', now),
    db.prepare('INSERT INTO entries (id,batch_id,student_id,title,category,points,unit_points,quantity,date,created_at,operator) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind('other-entry', 'other-batch', 'other-student', '其他班加分', '上课', 2, 1, 2, '2026-09-27', now, '其他班管理员'),
  ]);
  recordEntries(db, recordInput, recordContext);
  db.prepare('UPDATE entries SET voided_at=?,void_reason=?,voided_by=? WHERE id=?')
    .bind(now, '测试作废记录仍需删除', '管理员', `${recordInput.batchId}:0:student-2`).run();
  const context = { classId: 'main', role: 'owner', backupDir };
  const input = () => ({
    action: 'clearEntries', confirmation: '清空积分',
    entriesRevision: entriesRevision(db.connection(), 'main'), operationPassword: '00000',
  });
  return { db, directory, backupDir, context, input };
}

function statusIs(status) {
  return error => error instanceof ClearEntriesError && error.status === status;
}

test('clear removes every class entry including voided ones, preserves all other rows, and creates a complete verified private backup', async t => {
  const { db, backupDir, context, input } = fixture(t);
  const before = rowsSnapshot(db.connection());
  const protectedBefore = rowsSnapshot(db.connection(), { excludeEntries: true });
  const otherBefore = db.prepare('SELECT * FROM entries WHERE id=?').bind('other-entry').first();
  const result = await clearEntries(db, input(), context);
  assert.equal(result.deletedCount, 4);
  assert.equal(existsSync(result.backupPath), true);
  assert.equal(result.backupPath.startsWith(`${backupDir}/`), true);
  assert.equal(statSync(result.backupPath).mode & 0o777, 0o600);
  const backup = new DatabaseSync(result.backupPath, { readOnly: true });
  try {
    assert.equal(rowsSnapshot(backup), before);
    assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(backup.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    backup.close();
  }
  assert.equal(rowsSnapshot(db.connection(), { excludeEntries: true }), protectedBefore);
  assert.deepEqual(db.prepare('SELECT * FROM entries').all().results, [otherBefore]);
  assert.deepEqual(db.prepare('SELECT s.id,COALESCE(SUM(e.points),0) AS score FROM students s LEFT JOIN entries e ON e.student_id=s.id AND e.voided_at IS NULL WHERE s.class_id=? GROUP BY s.id ORDER BY s.id')
    .bind('main').all().results,
  ['student-1', 'student-2', 'student-3'].map(id => ({ id, score: 0 })));
  assert.deepEqual(db.connection().prepare('PRAGMA foreign_key_check').all(), []);
  // Keep batch deduplication so an already open browser cannot revive erased records by retrying.
  assert.equal(recordEntries(db, recordInput, recordContext).repeated, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries').first().n, 1);
});

test('recorders cannot clear data even with the right operation password, and wrong passwords do not create backups or modify any rows', async t => {
  const { db, backupDir, context, input } = fixture(t);
  const before = rowsSnapshot(db.connection());
  for (const role of ['recorder', 'visitor', '']) {
    await assert.rejects(clearEntries(db, input(), { ...context, role }), statusIs(403));
  }
  for (const operationPassword of ['0000', '000000', '112233', ' 00000', '00000 ']) {
    await assert.rejects(clearEntries(db, { ...input(), operationPassword }, context), statusIs(403));
  }
  assert.equal(rowsSnapshot(db.connection()), before);
  assert.equal(existsSync(backupDir), false);
});

test('a configured operation password replaces the default and remains distinct from the login password', async t => {
  const { db, context, input } = fixture(t);
  process.env.DATA_RESET_PASSWORD = 'custom-reset-54321';
  await assert.rejects(clearEntries(db, input(), context), statusIs(403));
  await assert.rejects(clearEntries(db, { ...input(), operationPassword: '112233' }, context), statusIs(403));
  const result = await clearEntries(db, { ...input(), operationPassword: 'custom-reset-54321' }, context);
  assert.equal(result.deletedCount, 4);
});

test('missing explicit confirmation or malformed revision cannot clear any records', async t => {
  const { db, backupDir, context, input } = fixture(t);
  const before = rowsSnapshot(db.connection());
  for (const change of [
    { confirmation: '' }, { confirmation: '确认' }, { confirmation: ' 清空积分' },
    { entriesRevision: '' }, { entriesRevision: 'invalid' }, { operationPassword: '' },
  ]) {
    await assert.rejects(clearEntries(db, { ...input(), ...change }, context));
  }
  assert.equal(rowsSnapshot(db.connection()), before);
  assert.equal(existsSync(backupDir), false);
});

test('a changed entry with the same row count invalidates confirmation before any backup or deletion', async t => {
  const { db, backupDir, context, input } = fixture(t);
  const confirmed = input();
  db.prepare('UPDATE entries SET voided_at=?,void_reason=?,voided_by=? WHERE id=?')
    .bind(now, '确认期间有人撤销了记录', '另一管理员', `${recordInput.batchId}:1:student-1`).run();
  const afterEdit = rowsSnapshot(db.connection());
  assert.notEqual(entriesRevision(db.connection(), 'main'), confirmed.entriesRevision);
  await assert.rejects(clearEntries(db, confirmed, context), statusIs(409));
  assert.equal(rowsSnapshot(db.connection()), afterEdit);
  assert.equal(existsSync(backupDir), false);
});

test('backup failure leaves all live records and account data intact', async t => {
  const { db, directory, context, input } = fixture(t);
  t.mock.method(console, 'error', () => {});
  const blockedPath = join(directory, 'cannot-be-a-backup-directory');
  writeFileSync(blockedPath, 'regular file prevents directory creation');
  const before = rowsSnapshot(db.connection());
  await assert.rejects(clearEntries(db, input(), { ...context, backupDir: blockedPath }), statusIs(503));
  assert.equal(rowsSnapshot(db.connection()), before);
});

test('an entry edited while the asynchronous backup runs aborts reset and preserves the new state', async t => {
  const { db, context, input } = fixture(t);
  const pending = clearEntries(db, input(), context);
  db.prepare('UPDATE entries SET title=?,points=?,unit_points=? WHERE id=?')
    .bind('备份期间更正的加分', 6, 2, `${recordInput.batchId}:0:student-1`).run();
  recordEntries(db, { ...recordInput, batchId: 'f0d5613e-f343-4601-bf3b-aa6846cf1a8f' }, recordContext);
  const updated = rowsSnapshot(db.connection());
  await assert.rejects(pending, statusIs(409));
  assert.equal(rowsSnapshot(db.connection()), updated);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries').first().n, 9);
});

test('a delete failure rolls back earlier deletions and keeps the complete backup for recovery', async t => {
  const { db, backupDir, context, input } = fixture(t);
  db.connection().exec(`CREATE TRIGGER reject_reset_delete BEFORE DELETE ON entries
    WHEN OLD.id = '${recordInput.batchId}:1:student-1'
    BEGIN SELECT RAISE(ABORT, 'simulated reset delete failure'); END;`);
  const before = rowsSnapshot(db.connection());
  await assert.rejects(clearEntries(db, input(), context));
  assert.equal(rowsSnapshot(db.connection()), before);
  const backupFiles = readdirSync(backupDir).filter(name => name.endsWith('.sqlite'));
  assert.equal(backupFiles.length, 1);
  const backup = new DatabaseSync(join(backupDir, backupFiles[0]), { readOnly: true });
  try {
    assert.equal(rowsSnapshot(backup), before);
  } finally {
    backup.close();
  }
  db.connection().exec('DROP TRIGGER reject_reset_delete');
  assert.equal((await clearEntries(db, input(), context)).deletedCount, 4);
});

test('clearing an already empty class is an authorized no-op without extra backups', async t => {
  const { db, backupDir, context, input } = fixture(t);
  await clearEntries(db, input(), context);
  const before = rowsSnapshot(db.connection());
  const files = readdirSync(backupDir).sort();
  assert.deepEqual(await clearEntries(db, input(), context), { deletedCount: 0, backupPath: null });
  assert.equal(rowsSnapshot(db.connection()), before);
  assert.deepEqual(readdirSync(backupDir).sort(), files);
  await assert.rejects(clearEntries(db, { ...input(), operationPassword: 'bad' }, context), statusIs(403));
});
