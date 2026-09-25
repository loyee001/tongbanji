import { createHash } from 'node:crypto';
import type { RecordInput } from '../lib/record-input';
import type { SqliteDatabase } from './sqlite';

export class RecordError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function payloadHash(input: RecordInput): string {
  const ids = [...input.studentIds].sort();
  const first = input.items[0];
  // Keep the previous single-item digest so retries from an already open page
  // also recognize batches recorded before the quantity migration.
  const payload = input.items.length === 1 && first.quantity === 1
    ? { ids, title: first.title, category: first.category, points: first.points, date: input.date }
    : { ids, items: input.items, date: input.date };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function recordEntries(
  db: SqliteDatabase,
  input: RecordInput,
  context: { userId: string; operator: string; now: string },
): { repeated: boolean; count: number } {
  const hash = payloadHash(input);
  return db.transaction(() => {
    const prior = db.prepare('SELECT payload_hash AS hash,creator_id AS creatorId FROM batches WHERE id=?')
      .bind(input.batchId).first<{ hash: string; creatorId: string }>();
    if (prior) {
      if (prior.hash !== hash || prior.creatorId !== context.userId) {
        throw new RecordError(409, '登记请求已变化，请重新确认。');
      }
      return { repeated: true, count: input.studentIds.length * input.items.length };
    }
    const match = db.prepare('SELECT COUNT(*) AS count FROM students WHERE class_id=? AND id IN (SELECT value FROM json_each(?))')
      .bind('main', JSON.stringify(input.studentIds)).first<{ count: number }>();
    if (match?.count !== input.studentIds.length) {
      throw new RecordError(400, '名单已变化，请重新选择同学。');
    }
    db.prepare('INSERT INTO batches (id,creator_id,payload_hash,created_at) VALUES (?,?,?,?)')
      .bind(input.batchId, context.userId, hash, context.now).run();
    const insert = db.prepare(`INSERT INTO entries
      (id,batch_id,student_id,title,category,points,unit_points,quantity,date,created_at,operator)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    input.items.forEach((item, index) => {
      for (const studentId of input.studentIds) {
        insert.bind(`${input.batchId}:${index}:${studentId}`, input.batchId, studentId,
          item.title, item.category, item.points * item.quantity, item.points, item.quantity,
          input.date, context.now, context.operator).run();
      }
    });
    return { repeated: false, count: input.studentIds.length * input.items.length };
  });
}
