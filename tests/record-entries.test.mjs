import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteDatabase } from '../db/sqlite.ts';
import { recordEntries, RecordError } from '../db/record-entries.ts';
import { createRecordInputSchema } from '../lib/record-input.ts';

const migrationsSource = new URL('../drizzle/', import.meta.url);
const quantityMigration = '0002_entry_quantities.sql';
const schema = createRecordInputSchema(['上课', '作业'], date => date === '2026-09-25');
const context = { userId: 'owner', operator: '老师', now: '2026-09-25T08:00:00.000Z' };
const base = {
  action: 'record', batchId: 'b394c1a4-6988-4e1e-8fa5-d7b9cdd99931',
  studentIds: ['student-1', 'student-2'], date: '2026-09-25',
};
const items = [
  { title: '主动举手回答问题', category: '上课', points: 1, quantity: 3 },
  { title: '未交作业', category: '作业', points: -2, quantity: 2 },
];

function fixture(t, { beforeQuantityMigration = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'tongbanji-record-'));
  const migrationsDir = join(directory, 'drizzle');
  mkdirSync(migrationsDir);
  for (const filename of readdirSync(migrationsSource).filter(name => name.endsWith('.sql'))) {
    if (beforeQuantityMigration && filename === quantityMigration) continue;
    copyFileSync(new URL(filename, migrationsSource), join(migrationsDir, filename));
  }
  const path = join(directory, 'classroom.sqlite');
  const opened = [];
  const open = () => {
    const db = new SqliteDatabase(path, { migrationsDir });
    opened.push(db);
    return db;
  };
  t.after(() => {
    for (const db of opened) db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const db = open();
  db.batch([
    db.prepare('INSERT INTO classrooms (id,name,owner_id,created_at) VALUES (?,?,?,?)')
      .bind('main', '测试班级', context.userId, context.now),
    ...base.studentIds.map((id, index) => db.prepare('INSERT INTO students (id,class_id,number,name,group_name) VALUES (?,?,?,?,?)')
      .bind(id, 'main', String(index + 1), `同学${index + 1}`, '')),
  ]);
  return {
    db, open,
    applyQuantityMigration() {
      copyFileSync(new URL(quantityMigration, migrationsSource), join(migrationsDir, quantityMigration));
    },
  };
}

test('multiple items keep each student/item breakdown and calculate positive and negative multiples', t => {
  const { db } = fixture(t);
  assert.deepEqual(recordEntries(db, schema.parse({ ...base, items }), context), { repeated: false, count: 4 });
  const rows = db.prepare('SELECT student_id,title,points,unit_points,quantity FROM entries ORDER BY student_id,title').all().results;
  assert.equal(rows.length, 4);
  for (const id of base.studentIds) {
    assert.deepEqual(rows.filter(row => row.student_id === id).map(({ student_id, ...row }) => row), [
      { title: '主动举手回答问题', points: 3, unit_points: 1, quantity: 3 },
      { title: '未交作业', points: -4, unit_points: -2, quantity: 2 },
    ]);
  }
  assert.deepEqual(db.prepare('SELECT student_id,SUM(points) AS score FROM entries GROUP BY student_id ORDER BY student_id').all().results,
    base.studentIds.map(student_id => ({ student_id, score: -1 })));
});

test('quantity validation rejects missing, fractional, zero, negative, oversized and coerced values before any write', t => {
  const { db } = fixture(t);
  for (const quantity of [undefined, 0, -1, 1.5, 101, '2', null, NaN, Infinity]) {
    assert.throws(() => recordEntries(db, schema.parse({ ...base, items: [{ ...items[0], quantity }] }), context));
  }
  for (const points of [0, 101, -101, 0.5, '1']) {
    assert.equal(schema.safeParse({ ...base, items: [{ ...items[0], points }] }).success, false);
  }
  assert.equal(schema.safeParse({ ...base, items: [] }).success, false);
  assert.equal(schema.safeParse({ ...base, items: Array.from({ length: 51 }, () => items[0]) }).success, false);
  assert.equal(schema.safeParse({ ...base, studentIds: ['student-1', 'student-1'], items }).success, false);
  assert.equal(schema.safeParse({ ...base, items, ...items[0] }).success, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM batches').first().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries').first().n, 0);
});

test('valid quantity limits produce exact totals without treating a repeated item as separate occurrences', t => {
  const { db } = fixture(t);
  const input = schema.parse({ ...base, items: [
    { ...items[0], points: 100, quantity: 100 },
    { ...items[1], points: -100, quantity: 1 },
  ] });
  recordEntries(db, input, context);
  assert.deepEqual(db.prepare('SELECT points,unit_points,quantity FROM entries WHERE student_id=? ORDER BY points DESC')
    .bind('student-1').all().results, [
    { points: 10000, unit_points: 100, quantity: 100 },
    { points: -100, unit_points: -100, quantity: 1 },
  ]);
});

test('a repeated batch is idempotent across restart and cannot revive a voided item', t => {
  const store = fixture(t);
  const input = schema.parse({ ...base, items });
  recordEntries(store.db, input, context);
  const entryId = `${base.batchId}:0:student-1`;
  store.db.prepare('UPDATE entries SET voided_at=?,void_reason=?,voided_by=? WHERE id=?')
    .bind(context.now, '登记有误', '老师', entryId).run();
  store.db.close();
  const db = store.open();
  assert.deepEqual(recordEntries(db, { ...input, studentIds: [...input.studentIds].reverse() }, context), { repeated: true, count: 4 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries').first().n, 4);
  assert.equal(db.prepare('SELECT void_reason FROM entries WHERE id=?').bind(entryId).first().void_reason, '登记有误');
  assert.equal(db.prepare('SELECT SUM(points) AS score FROM entries WHERE student_id=? AND voided_at IS NULL').bind('student-1').first().score, -4);
});

test('reusing a batch with an edited item or another recorder rejects the entire request', t => {
  const { db } = fixture(t);
  const input = schema.parse({ ...base, items });
  recordEntries(db, input, context);
  for (const inputChange of [
    { items: [{ ...items[0], quantity: 4 }, items[1]] },
    { items: [{ ...items[0], points: 2 }, items[1]] },
    { items: [{ ...items[0], title: '改过的事项' }, items[1]] },
    { items: [items[0]] },
    { studentIds: ['student-1'] },
  ]) {
    assert.throws(() => recordEntries(db, { ...input, ...inputChange }, context), error => error instanceof RecordError && error.status === 409);
  }
  assert.throws(() => recordEntries(db, input, { ...context, userId: 'another-recorder' }), error => error.status === 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n, SUM(points) AS score FROM entries').first().n, 4);
  assert.equal(db.prepare('SELECT SUM(points) AS score FROM entries').first().score, -2);
});

test('a later item insert failure rolls back all earlier students, entries and batch metadata', t => {
  const { db } = fixture(t);
  db.connection().exec(`CREATE TRIGGER simulated_later_failure BEFORE INSERT ON entries
    WHEN NEW.title = '未交作业' BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;`);
  const input = schema.parse({ ...base, items });
  assert.throws(() => recordEntries(db, input, context), /simulated write failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM batches').first().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries').first().n, 0);
  db.connection().exec('DROP TRIGGER simulated_later_failure');
  assert.equal(recordEntries(db, input, context).count, 4);
});

test('a missing or out-of-class student prevents the entire batch from being saved', t => {
  const { db } = fixture(t);
  const input = schema.parse({ ...base, studentIds: ['student-1', 'missing'], items });
  assert.throws(() => recordEntries(db, input, context), error => error instanceof RecordError && error.status === 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM batches').first().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries').first().n, 0);
});

test('migration preserves existing points and audit, and legacy single-item retries remain idempotent', t => {
  const store = fixture(t, { beforeQuantityMigration: true });
  const legacy = { ...base, title: '未交作业', category: '作业', points: -2 };
  const hash = createHash('sha256').update(JSON.stringify({
    ids: [...legacy.studentIds].sort(), title: legacy.title, category: legacy.category,
    points: legacy.points, date: legacy.date,
  })).digest('hex');
  store.db.prepare('INSERT INTO batches (id,creator_id,payload_hash,created_at) VALUES (?,?,?,?)')
    .bind(legacy.batchId, context.userId, hash, context.now).run();
  for (const studentId of legacy.studentIds) {
    store.db.prepare('INSERT INTO entries (id,batch_id,student_id,title,category,points,date,created_at,operator,voided_at,void_reason,voided_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(`${legacy.batchId}:${studentId}`, legacy.batchId, studentId, legacy.title, legacy.category, legacy.points,
        legacy.date, context.now, context.operator, context.now, '原有撤销原因', context.operator).run();
  }
  store.db.close();
  store.applyQuantityMigration();
  const db = store.open();
  assert.equal(recordEntries(db, schema.parse(legacy), context).repeated, true);
  assert.equal(recordEntries(db, schema.parse({ ...base, items: [{ title: legacy.title, category: legacy.category, points: legacy.points, quantity: 1 }] }), context).repeated, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries').first().n, 2);
  assert.deepEqual(db.prepare('SELECT points,unit_points,quantity,void_reason FROM entries ORDER BY student_id').all().results,
    [1, 2].map(() => ({ points: -2, unit_points: -2, quantity: 1, void_reason: '原有撤销原因' })));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM _tongbanji_migrations').first().n, readdirSync(migrationsSource).filter(name => name.endsWith('.sql')).length);
});

test('an old single-item request defaults to one occurrence and accepts an explicit quantity', t => {
  const { db } = fixture(t);
  const input = schema.parse({ ...base, title: '主动举手回答问题', category: '上课', points: 1 });
  assert.equal(input.items[0].quantity, 1);
  recordEntries(db, input, context);
  const next = schema.parse({ ...base, batchId: 'c2ecb6bd-5730-42f9-89c0-d0053b25ce70', ...items[1] });
  recordEntries(db, next, context);
  assert.deepEqual(db.prepare('SELECT points,unit_points,quantity FROM entries WHERE student_id=? ORDER BY points DESC')
    .bind('student-1').all().results, [
    { points: 1, unit_points: 1, quantity: 1 },
    { points: -4, unit_points: -2, quantity: 2 },
  ]);
});
