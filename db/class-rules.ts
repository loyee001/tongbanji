import { createHash } from 'node:crypto';
import type { Rule } from '../lib/classroom';
import type { RuleMutation } from '../lib/rule-input';
import type { SqliteDatabase, SqliteStatement } from './sqlite';

export class RuleError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type StoredRule = Rule & { version: number; deletedAt: string | null; creationHash: string | null };
const columns = 'id,category,title,points,note,version';

export function loadClassRules(db: SqliteDatabase, classId: string, role: string) {
  const active = db.prepare(`SELECT ${columns} FROM class_rules WHERE class_id=? AND deleted_at IS NULL ORDER BY sort_order,id`)
    .bind(classId).all<Rule>().results;
  if (role !== 'owner') return { rules: active };
  const deleted = db.prepare(`SELECT ${columns} FROM class_rules WHERE class_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC,sort_order,id`)
    .bind(classId).all<Rule>().results;
  return { rules: active, deletedRules: deleted };
}

// Include these statements in the same transaction that creates the classroom.
// The durable marker distinguishes an intentionally empty rule list from a new one.
export function defaultClassRuleStatements(db: SqliteDatabase, classId: string, defaults: readonly Rule[], now: string): SqliteStatement[] {
  return [
    db.prepare(`INSERT INTO class_rules (id,class_id,category,title,points,note,version,sort_order,created_at,updated_at)
      SELECT json_extract(value,'$.id'),?,json_extract(value,'$.category'),json_extract(value,'$.title'),
        json_extract(value,'$.points'),COALESCE(json_extract(value,'$.note'),''),1,CAST(key AS INTEGER),?,?
      FROM json_each(?)
      WHERE EXISTS (SELECT 1 FROM classrooms WHERE id=?)
        AND NOT EXISTS (SELECT 1 FROM class_rule_initializations WHERE class_id=?)`)
      .bind(classId, now, now, JSON.stringify(defaults), classId, classId),
    db.prepare(`INSERT OR IGNORE INTO class_rule_initializations (class_id,initialized_at)
      SELECT id,? FROM classrooms WHERE id=?`).bind(now, classId),
  ];
}

export function mutateClassRule(
  db: SqliteDatabase,
  input: RuleMutation,
  context: { classId: string; role: string; now: string },
): void {
  if (context.role !== 'owner') throw new RuleError(403, '班级公约由老师或管理员维护。');
  db.transaction(() => {
    const current = db.prepare(`SELECT ${columns},deleted_at AS deletedAt,creation_hash AS creationHash FROM class_rules WHERE class_id=? AND id=?`)
      .bind(context.classId, input.id).first<StoredRule>();
    if (input.action === 'createRule') {
      const hash = createHash('sha256').update(JSON.stringify({ category: input.category, title: input.title, points: input.points, note: input.note })).digest('hex');
      if (current) {
        if (current.creationHash === hash) return;
        throw new RuleError(409, '这条公约的新增请求已变化，请重新确认。');
      }
      requireRuleCapacity(db, context.classId);
      db.prepare(`INSERT INTO class_rules (id,class_id,category,title,points,note,version,sort_order,created_at,updated_at,creation_hash)
        SELECT ?,?,?,?,?,?,1,COALESCE(MAX(sort_order),-1)+1,?,?,? FROM class_rules WHERE class_id=?`)
        .bind(input.id, context.classId, input.category, input.title, input.points, input.note, context.now, context.now, hash, context.classId).run();
      return;
    }
    if (!current) throw new RuleError(404, '没有找到这条班级公约。');
    if (current.version !== input.version) throw new RuleError(409, '这条公约已被修改，请刷新后重新确认。');
    if (input.action === 'restoreRule') {
      if (!current.deletedAt) throw new RuleError(409, '这条公约已经恢复，请刷新查看。');
      requireRuleCapacity(db, context.classId);
      db.prepare('UPDATE class_rules SET deleted_at=NULL,version=version+1,updated_at=? WHERE class_id=? AND id=?')
        .bind(context.now, context.classId, input.id).run();
      return;
    }
    if (current.deletedAt) throw new RuleError(409, '这条公约已删除，请先恢复后再修改。');
    if (input.action === 'deleteRule') {
      db.prepare('UPDATE class_rules SET deleted_at=?,version=version+1,updated_at=? WHERE class_id=? AND id=?')
        .bind(context.now, context.now, context.classId, input.id).run();
      return;
    }
    db.prepare('UPDATE class_rules SET category=?,title=?,points=?,note=?,version=version+1,updated_at=? WHERE class_id=? AND id=?')
      .bind(input.category, input.title, input.points, input.note, context.now, context.classId, input.id).run();
  });
}

function requireRuleCapacity(db: SqliteDatabase, classId: string): void {
  const count = db.prepare('SELECT COUNT(*) AS count FROM class_rules WHERE class_id=? AND deleted_at IS NULL')
    .bind(classId).first<{ count: number }>()?.count ?? 0;
  if (count >= 200) throw new RuleError(409, '班级最多保留 200 条使用中的公约，请先删除不再使用的项目。');
}
