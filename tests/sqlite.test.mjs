import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { SqliteDatabase } from '../db/sqlite.ts';

const classroomSchema = readFileSync(new URL('../drizzle/0000_puzzling_thaddeus_ross.sql', import.meta.url), 'utf8');

function fixture(t, initialSql = classroomSchema) {
  const directory = mkdtempSync(join(tmpdir(), 'tongbanji-sqlite-'));
  const migrationsDir = join(directory, 'drizzle');
  mkdirSync(migrationsDir);
  writeFileSync(join(migrationsDir, '0000_initial.sql'), initialSql);
  const path = join(directory, 'data', 'classroom.sqlite');
  const opened = [];
  t.after(() => {
    for (const db of opened) db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    path,
    migrationsDir,
    open() {
      const db = new SqliteDatabase(path, { migrationsDir });
      opened.push(db);
      return db;
    },
  };
}

function initializeClass(db) {
  db.batch([
    db.prepare('INSERT INTO classrooms (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .bind('main', '验证班级', 'owner', '2026-09-25T00:00:00.000Z'),
    db.prepare('INSERT INTO students (id, class_id, number, name, group_name) VALUES (?, ?, ?, ?, ?)')
      .bind('student-1', 'main', '01', '同学甲', '第一组'),
  ]);
}

test('disk database survives restart and bound queries preserve the D1 result shape', t => {
  const store = fixture(t);
  let db = store.open();
  initializeClass(db);
  assert.equal(db.prepare('PRAGMA journal_mode').first().journal_mode, 'wal');
  assert.equal(db.prepare('PRAGMA busy_timeout').first().timeout, 5000);
  assert.equal(db.prepare('PRAGMA foreign_keys').first().foreign_keys, 1);
  const base = db.prepare('SELECT name FROM students WHERE id = ?');
  const bound = base.bind('student-1');
  assert.equal(base.bind('missing').first(), null);
  assert.deepEqual(bound.first(), { name: '同学甲' });
  assert.deepEqual(bound.all().results, [{ name: '同学甲' }]);
  assert.equal(db.prepare('UPDATE students SET name = ? WHERE id = ?').bind('同学乙', 'student-1').run().meta.changes, 1);
  db.close();
  db = store.open();
  assert.equal(db.prepare('SELECT name FROM students WHERE id = ?').bind('student-1').first().name, '同学乙');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM _tongbanji_migrations').first().n, 1);
});

test('a failed batch rolls back earlier writes and leaves the connection usable', t => {
  const db = fixture(t).open();
  initializeClass(db);
  assert.throws(() => db.batch([
    db.prepare('INSERT INTO batches (id, creator_id, payload_hash, created_at) VALUES (?, ?, ?, ?)')
      .bind('failed-batch', 'owner', 'hash', '2026-09-25T00:00:00.000Z'),
    db.prepare('INSERT INTO students (id, class_id, number, name) VALUES (?, ?, ?, ?)')
      .bind('invalid-student', 'missing-class', '02', '不存在的班级'),
  ]), /FOREIGN KEY constraint failed/);
  assert.equal(db.prepare('SELECT id FROM batches WHERE id = ?').bind('failed-batch').first(), null);
  const results = db.batch([
    db.prepare('UPDATE students SET name = ? WHERE id = ?').bind('批量修改', 'student-1'),
    db.prepare('SELECT name FROM students WHERE id = ?').bind('student-1'),
  ]);
  assert.equal(results[0].meta.changes, 1);
  assert.deepEqual(results[1].results, [{ name: '批量修改' }]);
});

test('migrations run once and edited applied migrations are rejected', t => {
  const sql = 'CREATE TABLE counters (n INTEGER NOT NULL); INSERT INTO counters VALUES (1);';
  const store = fixture(t, sql);
  store.open().close();
  const reopened = store.open();
  assert.deepEqual(reopened.prepare('SELECT n FROM counters').all().results, [{ n: 1 }]);
  assert.match(reopened.prepare('SELECT checksum FROM _tongbanji_migrations').first().checksum, /^[a-f0-9]{64}$/);
  reopened.close();
  writeFileSync(join(store.migrationsDir, '0000_initial.sql'), `${sql}\nINSERT INTO counters VALUES (2);`);
  assert.throws(() => store.open(), /checksum changed: 0000_initial.sql/);
  const raw = new DatabaseSync(store.path);
  try {
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM counters').get().n, 1);
  } finally {
    raw.close();
  }
});

test('failed pending migrations roll back schema, data and migration metadata together', t => {
  const store = fixture(t, 'CREATE TABLE stable (n INTEGER NOT NULL); INSERT INTO stable VALUES (1);');
  store.open().close();
  writeFileSync(join(store.migrationsDir, '0001_valid.sql'), 'CREATE TABLE pending (n INTEGER); INSERT INTO stable VALUES (2);');
  writeFileSync(join(store.migrationsDir, '0002_invalid.sql'), 'INSERT INTO missing_table VALUES (3);');
  assert.throws(() => store.open(), /no such table: missing_table/);
  const raw = new DatabaseSync(store.path);
  try {
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM stable').get().n, 1);
    assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name='pending'").get(), undefined);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM _tongbanji_migrations').get().n, 1);
  } finally {
    raw.close();
  }
  writeFileSync(join(store.migrationsDir, '0002_invalid.sql'), 'INSERT INTO pending VALUES (3);');
  const db = store.open();
  assert.deepEqual(db.prepare('SELECT n FROM stable ORDER BY n').all().results, [{ n: 1 }, { n: 2 }]);
  assert.equal(db.prepare('SELECT n FROM pending').first().n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM _tongbanji_migrations').first().n, 3);
});

test('retrying a recorded batch does not duplicate points or revive a voided entry', t => {
  const store = fixture(t);
  let db = store.open();
  initializeClass(db);
  function record() {
    return db.batch([
      db.prepare('INSERT OR IGNORE INTO batches (id,creator_id,payload_hash,created_at) VALUES (?,?,?,?)')
        .bind('batch-1', 'owner', 'payload-hash', '2026-09-25T01:00:00.000Z'),
      db.prepare("INSERT OR IGNORE INTO entries (id,batch_id,student_id,title,category,points,date,created_at,operator) SELECT ? || ':' || s.id,?,s.id,?,?,?,?,?,? FROM students s JOIN json_each(?) selected ON selected.value=s.id WHERE s.class_id=? AND EXISTS (SELECT 1 FROM batches WHERE id=? AND creator_id=? AND payload_hash=?)")
        .bind('batch-1', 'batch-1', '测试扣分', '作业', -2, '2026-09-25', '2026-09-25T01:00:00.000Z', '老师', JSON.stringify(['student-1']), 'main', 'batch-1', 'owner', 'payload-hash'),
    ]);
  }
  record();
  assert.equal(record()[1].meta.changes, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n, SUM(points) AS points FROM entries').first().n, 1);
  assert.equal(db.prepare('SELECT SUM(points) AS points FROM entries').first().points, -2);
  db.prepare('UPDATE entries SET voided_at=?,void_reason=?,voided_by=? WHERE batch_id=? AND voided_at IS NULL')
    .bind('2026-09-25T02:00:00.000Z', '记错同学', '老师', 'batch-1').run();
  db.close();
  db = store.open();
  record();
  const rows = db.prepare('SELECT points,voided_at,void_reason FROM entries').all().results;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].points, -2);
  assert.equal(rows[0].voided_at, '2026-09-25T02:00:00.000Z');
  assert.equal(rows[0].void_reason, '记错同学');
  assert.equal(db.prepare('SELECT COALESCE(SUM(points),0) AS total FROM entries WHERE voided_at IS NULL').first().total, 0);
});

test('a batch cannot write across database connections', t => {
  const first = fixture(t).open();
  const second = fixture(t).open();
  assert.throws(() => first.batch([second.prepare('SELECT 1 AS n')]), /same database/);
  assert.equal(first.prepare('SELECT 1 AS n').first().n, 1);
});
