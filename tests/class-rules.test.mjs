import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { rules, categories } from '../lib/classroom.ts';
import { createRuleInputSchema } from '../lib/rule-input.ts';
import { SqliteDatabase } from '../db/sqlite.ts';
import { defaultClassRuleStatements, loadClassRules, mutateClassRule, RuleError } from '../db/class-rules.ts';
import { recordEntries } from '../db/record-entries.ts';

const source = new URL('../drizzle/', import.meta.url);
const ruleMigration = '0003_class_rules.sql';
const context = { classId: 'main', role: 'owner', now: '2026-09-25T08:00:00.000Z' };
const schema = createRuleInputSchema(categories);
const fields = { title: '参加班级活动', category: '其他', points: 2, note: '由老师确认参加情况' };

function fixture(t, { beforeRulesMigration = false, seed = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'tongbanji-rules-'));
  const migrationsDir = join(directory, 'drizzle');
  mkdirSync(migrationsDir);
  for (const filename of readdirSync(source).filter(name => name.endsWith('.sql'))) {
    if (beforeRulesMigration && filename === ruleMigration) continue;
    copyFileSync(new URL(filename, source), join(migrationsDir, filename));
  }
  const path = join(directory, 'classroom.sqlite');
  const opened = [];
  function open() {
    const db = new SqliteDatabase(path, { migrationsDir });
    opened.push(db);
    return db;
  }
  t.after(() => {
    for (const db of opened) db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const db = open();
  db.batch([
    db.prepare('INSERT INTO classrooms (id,name,owner_id,created_at) VALUES (?,?,?,?)').bind('main', '测试班', 'owner', context.now),
    db.prepare('INSERT INTO students (id,class_id,number,name,group_name) VALUES (?,?,?,?,?)').bind('student-1', 'main', '01', '同学甲', ''),
    ...(!beforeRulesMigration && seed ? defaultClassRuleStatements(db, 'main', rules, context.now) : []),
  ]);
  return {
    db, open,
    applyRulesMigration() {
      copyFileSync(new URL(ruleMigration, source), join(migrationsDir, ruleMigration));
    },
  };
}

function create(db, changes = {}) {
  const input = schema.parse({ action: 'createRule', id: randomUUID(), ...fields, ...changes });
  mutateClassRule(db, input, context);
  return input;
}

test('migration initializes existing classrooms once and preserves historical entry snapshots', t => {
  const store = fixture(t, { beforeRulesMigration: true });
  recordEntries(store.db, {
    action: 'record', batchId: randomUUID(), studentIds: ['student-1'], date: '2026-09-25',
    items: [{ title: '未按时交作业', category: '作业', points: -2, quantity: 3 }],
  }, { userId: 'owner', operator: '老师', now: context.now });
  const original = store.db.prepare('SELECT * FROM entries').all().results;
  store.db.close();
  store.applyRulesMigration();
  const db = store.open();
  assert.deepEqual(loadClassRules(db, 'main', 'owner').rules,
    rules.map(rule => ({ ...rule, note: rule.note ?? '', version: 1 })));
  assert.deepEqual(db.prepare('SELECT * FROM entries').all().results, original);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM class_rule_initializations').first().n, 1);
  db.close();
  const reopened = store.open();
  assert.equal(loadClassRules(reopened, 'main', 'owner').rules.length, 20);
  assert.deepEqual(reopened.prepare('SELECT * FROM entries').all().results, original);
});

test('new classroom defaults are created atomically and initialization never repeats', t => {
  const { db } = fixture(t);
  assert.equal(loadClassRules(db, 'main', 'owner').rules.length, 20);
  db.batch(defaultClassRuleStatements(db, 'main', rules, context.now));
  assert.equal(loadClassRules(db, 'main', 'owner').rules.length, 20);
  assert.throws(() => db.batch([
    db.prepare('INSERT INTO classrooms (id,name,owner_id,created_at) VALUES (?,?,?,?)').bind('broken', '不会保留', 'owner', context.now),
    ...defaultClassRuleStatements(db, 'broken', [{ ...rules[0], points: 0 }], context.now),
  ]), /CHECK constraint failed/);
  assert.equal(db.prepare('SELECT id FROM classrooms WHERE id=?').bind('broken').first(), null);
  assert.equal(db.prepare('SELECT class_id FROM class_rule_initializations WHERE class_id=?').bind('broken').first(), null);
});

test('owner can add, edit, soft-delete and restore rules, with increasing versions and stable ordering', t => {
  const { db } = fixture(t);
  const input = create(db);
  let active = loadClassRules(db, 'main', 'owner').rules;
  assert.equal(active.at(-1).id, input.id);
  assert.equal(active.at(-1).version, 1);
  mutateClassRule(db, schema.parse({ action: 'updateRule', id: input.id, version: 1, ...fields, title: '活动积极参与', points: 3 }), context);
  active = loadClassRules(db, 'main', 'owner').rules;
  assert.equal(active.at(-1).title, '活动积极参与');
  assert.equal(active.at(-1).version, 2);
  mutateClassRule(db, schema.parse({ action: 'deleteRule', id: input.id, version: 2 }), context);
  const deleted = loadClassRules(db, 'main', 'owner');
  assert.equal(deleted.rules.some(rule => rule.id === input.id), false);
  assert.equal(deleted.deletedRules[0].id, input.id);
  assert.equal(deleted.deletedRules[0].version, 3);
  mutateClassRule(db, schema.parse({ action: 'restoreRule', id: input.id, version: 3 }), context);
  const restored = loadClassRules(db, 'main', 'owner');
  assert.equal(restored.rules.at(-1).points, 3);
  assert.equal(restored.rules.at(-1).version, 4);
  assert.deepEqual(restored.deletedRules, []);
});

test('editing and deleting a rule never changes recorded points, title or quantity', t => {
  const { db } = fixture(t);
  const rule = loadClassRules(db, 'main', 'owner').rules.find(rule => rule.id === 'homework');
  recordEntries(db, {
    action: 'record', batchId: randomUUID(), studentIds: ['student-1'], date: '2026-09-25',
    items: [{ title: rule.title, category: rule.category, points: rule.points, quantity: 4 }],
  }, { userId: 'owner', operator: '老师', now: context.now });
  const original = db.prepare('SELECT * FROM entries').all().results;
  mutateClassRule(db, schema.parse({ action: 'updateRule', ...rule, title: '新作业规则', points: -3, note: '更新说明' }), context);
  mutateClassRule(db, { action: 'deleteRule', id: rule.id, version: 2 }, context);
  mutateClassRule(db, { action: 'restoreRule', id: rule.id, version: 3 }, context);
  assert.deepEqual(db.prepare('SELECT * FROM entries').all().results, original);
});

test('deleting every rule survives restart and does not restore the default list', t => {
  const store = fixture(t);
  for (const rule of loadClassRules(store.db, 'main', 'owner').rules) {
    mutateClassRule(store.db, { action: 'deleteRule', id: rule.id, version: rule.version }, context);
  }
  store.db.close();
  const db = store.open();
  db.batch(defaultClassRuleStatements(db, 'main', rules, context.now));
  assert.deepEqual(loadClassRules(db, 'main', 'owner').rules, []);
  assert.equal(loadClassRules(db, 'main', 'owner').deletedRules.length, 20);
  assert.deepEqual(loadClassRules(db, 'main', 'recorder'), { rules: [] });
});

test('recorders can read current rules but cannot inspect deleted rules or mutate any rule', t => {
  const { db } = fixture(t);
  const input = create(db);
  mutateClassRule(db, { action: 'deleteRule', id: input.id, version: 1 }, context);
  const recorderView = loadClassRules(db, 'main', 'recorder');
  assert.equal(recorderView.rules.length, 20);
  assert.equal('deletedRules' in recorderView, false);
  for (const operation of [
    { action: 'createRule', id: randomUUID(), ...fields },
    { action: 'updateRule', id: 'reading', version: 1, ...fields },
    { action: 'deleteRule', id: 'reading', version: 1 },
    { action: 'restoreRule', id: input.id, version: 2 },
  ]) {
    assert.throws(() => mutateClassRule(db, schema.parse(operation), { ...context, role: 'recorder' }), error => error instanceof RuleError && error.status === 403);
  }
  assert.equal(loadClassRules(db, 'main', 'owner').rules.length, 20);
  assert.equal(loadClassRules(db, 'main', 'owner').deletedRules.length, 1);
});

test('client UUID creation retries never duplicate, overwrite edits or reactivate a deleted rule', t => {
  const { db } = fixture(t);
  const input = create(db);
  mutateClassRule(db, input, context);
  assert.equal(loadClassRules(db, 'main', 'owner').rules.length, 21);
  mutateClassRule(db, { ...input, action: 'updateRule', version: 1, title: '老师已改过' }, context);
  mutateClassRule(db, input, context);
  assert.equal(loadClassRules(db, 'main', 'owner').rules.at(-1).title, '老师已改过');
  mutateClassRule(db, { action: 'deleteRule', id: input.id, version: 2 }, context);
  mutateClassRule(db, input, context);
  assert.equal(loadClassRules(db, 'main', 'owner').rules.length, 20);
  assert.equal(loadClassRules(db, 'main', 'owner').deletedRules[0].version, 3);
  assert.throws(() => mutateClassRule(db, { ...input, points: 5 }, context), error => error.status === 409);
});

test('stale versions and invalid state transitions return conflicts; unknown IDs return 404', t => {
  const { db } = fixture(t);
  mutateClassRule(db, { action: 'updateRule', id: 'reading', version: 1, ...fields }, context);
  for (const operation of [
    { action: 'updateRule', id: 'reading', version: 1, ...fields },
    { action: 'deleteRule', id: 'reading', version: 1 },
    { action: 'restoreRule', id: 'reading', version: 2 },
  ]) assert.throws(() => mutateClassRule(db, operation, context), error => error.status === 409);
  mutateClassRule(db, { action: 'deleteRule', id: 'reading', version: 2 }, context);
  assert.throws(() => mutateClassRule(db, { action: 'updateRule', id: 'reading', version: 3, ...fields }, context), error => error.status === 409);
  assert.throws(() => mutateClassRule(db, { action: 'restoreRule', id: 'reading', version: 2 }, context), error => error.status === 409);
  assert.throws(() => mutateClassRule(db, { action: 'deleteRule', id: 'missing', version: 1 }, context), error => error.status === 404);
  assert.equal(loadClassRules(db, 'main', 'owner').deletedRules[0].version, 3);
});

test('active rule capacity includes restoration and allows idempotent create retries at the limit', t => {
  const { db } = fixture(t, { seed: false });
  let last;
  for (let index = 0; index < 200; index++) last = create(db, { title: `规则 ${index}` });
  mutateClassRule(db, last, context);
  assert.throws(() => create(db), error => error.status === 409);
  mutateClassRule(db, { action: 'deleteRule', id: last.id, version: 1 }, context);
  create(db, { title: '占用空出的名额' });
  assert.throws(() => mutateClassRule(db, { action: 'restoreRule', id: last.id, version: 2 }, context), error => error.status === 409);
  assert.equal(loadClassRules(db, 'main', 'owner').rules.length, 200);
  assert.equal(loadClassRules(db, 'main', 'owner').deletedRules.length, 1);
});

test('rule validation trims text and rejects invalid titles, categories, scores, notes, IDs and versions', () => {
  const valid = { action: 'createRule', id: randomUUID(), ...fields };
  assert.equal(schema.parse({ ...valid, title: '  认真早读  ', note: '  已确认  ' }).title, '认真早读');
  assert.equal(schema.parse({ ...valid, note: '  已确认  ' }).note, '已确认');
  for (const change of [
    { title: ' ' }, { title: '长'.repeat(81) }, { category: '不存在的类别' },
    { points: 0 }, { points: 101 }, { points: -101 }, { points: 1.5 }, { points: '2' },
    { note: '长'.repeat(501) }, { note: undefined }, { id: 'not-a-uuid' }, { extra: true },
  ]) assert.equal(schema.safeParse({ ...valid, ...change }).success, false, JSON.stringify(change));
  for (const version of [undefined, 0, -1, 1.5, '1']) {
    assert.equal(schema.safeParse({ action: 'deleteRule', id: 'reading', version }).success, false);
  }
  assert.equal(schema.safeParse({ action: 'deleteRule', id: 'reading', version: 1 }).success, true);
  assert.equal(schema.safeParse({ ...valid, title: '长'.repeat(80), note: '长'.repeat(500), points: -100 }).success, true);
});
