import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { SqliteDatabase } from '../db/sqlite.ts';

const oldLogin = 'admin@tongbanji.local';
const script = fileURLToPath(new URL('../scripts/rename-admin.mjs', import.meta.url));
const now = '2026-09-27T08:00:00.000Z';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'tongbanji-rename-admin-'));
  const database = new SqliteDatabase(join(directory, 'classroom.sqlite'), {
    migrationsDir: fileURLToPath(new URL('../drizzle/', import.meta.url)),
  });
  const db = database.connection();
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  db.prepare('INSERT INTO accounts (id,email,name,password_hash,role) VALUES (?,?,?,?,?)')
    .run('administrator', oldLogin, '原管理员名字', 'opaque-password-hash', 'owner');
  db.prepare('INSERT INTO accounts (id,email,name,password_hash,role) VALUES (?,?,?,?,?)')
    .run('recorder', 'recorder@example.test', '记录员', 'recorder-password-hash', 'recorder');
  db.prepare('INSERT INTO members (email,user_id,name,role) VALUES (?,?,?,?)')
    .run(oldLogin, 'administrator', '原成员显示名字', 'owner');
  db.prepare('INSERT INTO members (email,user_id,name,role) VALUES (?,?,?,?)')
    .run('recorder@example.test', 'recorder', '记录员', 'recorder');
  db.prepare('INSERT INTO classrooms (id,name,owner_id,created_at) VALUES (?,?,?,?)')
    .run('main', '测试班级', 'administrator', now);
  db.prepare('INSERT INTO students (id,class_id,number,name,group_name) VALUES (?,?,?,?,?)')
    .run('student', 'main', '01', '同学甲', '第一组');
  db.prepare('INSERT INTO class_rules (id,class_id,category,title,points,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('answer', 'main', '上课', '举手', 1, '公约备注', now, now);
  db.prepare('INSERT INTO class_rule_initializations (class_id,initialized_at) VALUES (?,?)').run('main', now);
  db.prepare('INSERT INTO batches (id,creator_id,payload_hash,created_at) VALUES (?,?,?,?)')
    .run('batch', 'administrator', 'payload-hash', now);
  db.prepare('INSERT INTO entries (id,batch_id,student_id,title,category,points,unit_points,quantity,date,created_at,operator,voided_at,void_reason,voided_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('entry', 'batch', 'student', '举手', '上课', 3, 1, 3, '2026-09-27', now, '原管理员名字', now, '作废说明', '原管理员名字');
  db.prepare('INSERT INTO sessions (token_hash,account_id,expires_at) VALUES (?,?,?)')
    .run('session-hash', 'administrator', '2026-09-28T08:00:00.000Z');
  db.prepare('INSERT INTO login_attempts (key,attempts,window_start) VALUES (?,?,?)').run(oldLogin, 3, 12345);
  db.prepare('INSERT INTO login_attempts (key,attempts,window_start) VALUES (?,?,?)').run('admin', 2, 12345);
  return { db, directory };
}

function snapshot(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(({ name }) => [name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
      .map(row => ({ ...row })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}

function run(directory, args = [oldLogin]) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8', env: { ...process.env, DATA_DIR: directory }, timeout: 10000,
  });
}

function assertRejectedWithoutChanges(db, directory, pattern) {
  const before = snapshot(db);
  const result = run(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, pattern);
  assert.deepEqual(snapshot(db), before);
}

test('rename updates exactly the administrator account and member login and preserves every other field and row', t => {
  const { db, directory } = fixture(t);
  const expected = snapshot(db);
  for (const [table, rows] of expected) {
    if (table === 'accounts' || table === 'members') {
      for (const row of rows) if (row.email === oldLogin) row.email = 'admin';
      rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
  }
  const result = run(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /已改为 admin/);
  assert.deepEqual(snapshot(db), expected);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const repeated = run(directory);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stdout, /已经是 admin/);
  assert.deepEqual(snapshot(db), expected);
});

test('existing target account is rejected without changing either identity', t => {
  const { db, directory } = fixture(t);
  db.prepare('UPDATE accounts SET email=? WHERE id=?').run('admin', 'recorder');
  assertRejectedWithoutChanges(db, directory, /已被占用/);
});

test('a recorder at the old login cannot be promoted or renamed', t => {
  const { db, directory } = fixture(t);
  db.prepare('UPDATE accounts SET role=? WHERE id=?').run('recorder', 'administrator');
  assertRejectedWithoutChanges(db, directory, /身份不明确/);
});

test('multiple owner accounts are rejected without guessing the administrator', t => {
  const { db, directory } = fixture(t);
  db.prepare('UPDATE accounts SET role=? WHERE id=?').run('owner', 'recorder');
  assertRejectedWithoutChanges(db, directory, /身份不明确/);
});

test('an owner member linked to the wrong identity is rejected', t => {
  const { db, directory } = fixture(t);
  db.prepare('UPDATE members SET user_id=? WHERE email=?').run('recorder', oldLogin);
  assertRejectedWithoutChanges(db, directory, /成员关联不一致/);
});

test('an existing target member cannot be overwritten', t => {
  const { db, directory } = fixture(t);
  db.prepare('UPDATE members SET email=? WHERE user_id=?').run('admin', 'recorder');
  assertRejectedWithoutChanges(db, directory, /成员关联不一致/);
});

test('the account update rolls back when updating the member fails', t => {
  const { db, directory } = fixture(t);
  db.exec("CREATE TRIGGER reject_member_rename BEFORE UPDATE OF email ON members BEGIN SELECT RAISE(ABORT, 'member rename blocked'); END");
  assertRejectedWithoutChanges(db, directory, /member rename blocked/);
});

test('idempotent recognition rejects an unrelated owner already using admin', t => {
  const { db, directory } = fixture(t);
  db.prepare('DELETE FROM sessions').run();
  db.prepare('UPDATE accounts SET id=?,email=? WHERE id=?').run('unrelated-owner', 'admin', 'administrator');
  db.prepare('UPDATE members SET user_id=?,email=? WHERE user_id=?').run('unrelated-owner', 'admin', 'administrator');
  db.prepare('UPDATE classrooms SET owner_id=?').run('unrelated-owner');
  assertRejectedWithoutChanges(db, directory, /身份不明确/);
});

test('a wrong DATA_DIR does not create a database or its directory', t => {
  const directory = mkdtempSync(join(tmpdir(), 'tongbanji-rename-missing-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const missingDirectory = join(directory, 'missing');
  const result = run(missingDirectory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /数据库文件不存在/);
  assert.equal(existsSync(missingDirectory), false);
  const emptyDirectoryResult = run(directory);
  assert.equal(emptyDirectoryResult.status, 1);
  assert.equal(existsSync(join(directory, 'classroom.sqlite')), false);
});

test('usage requires the explicitly supported old login and reminds the operator to back up', t => {
  const { db, directory } = fixture(t);
  const before = snapshot(db);
  for (const args of [[], ['recorder@example.test'], [oldLogin, 'another-login']]) {
    const result = run(directory, args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /请先备份并验证数据库/);
  }
  assert.deepEqual(snapshot(db), before);
});
