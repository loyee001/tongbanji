import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const previousLogin = 'admin@tongbanji.local';
const nextLogin = 'admin';
const administratorId = 'administrator';
const usage = `用法：node --env-file=/path/to/app.env scripts/rename-admin.mjs ${previousLogin}\n请先备份并验证数据库。本脚本只将现有管理员登录账号改为 admin，不修改密码。`;

if (process.argv.length !== 3 || process.argv[2] !== previousLogin) {
  console.error(usage);
  process.exitCode = 1;
} else {
  let db;
  try {
    const databasePath = resolve(process.env.DATA_DIR || './data', 'classroom.sqlite');
    // Check the existing file before opening: a mistyped DATA_DIR must not create a database.
    if (!statSync(databasePath, { throwIfNoEntry: false })?.isFile()) {
      throw new Error('现有数据库文件不存在；没有创建数据库。请检查 DATA_DIR。');
    }
    db = new DatabaseSync(databasePath, { timeout: 5000, enableForeignKeyConstraints: true });
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = db.prepare('SELECT * FROM accounts WHERE email = ?').get(previousLogin);
      const target = db.prepare('SELECT * FROM accounts WHERE email = ?').get(nextLogin);
      if (previous && target) throw new Error('目标账号 admin 已被占用；未修改任何账号。');
      const account = previous || target;
      if (!account) throw new Error('找不到指定的管理员账号。');
      const owners = db.prepare("SELECT id FROM accounts WHERE role = 'owner'").all();
      if (account.id !== administratorId || account.role !== 'owner' || owners.length !== 1 || owners[0].id !== account.id) {
        throw new Error('管理员身份不明确：必须是唯一的原始 administrator 管理员账号。');
      }
      const currentLogin = previous ? previousLogin : nextLogin;
      const linkedMembers = db.prepare('SELECT * FROM members WHERE user_id = ? OR email IN (?, ?)')
        .all(account.id, previousLogin, nextLogin);
      const ownerMembers = db.prepare("SELECT * FROM members WHERE role = 'owner'").all();
      if (linkedMembers.length !== 1 || ownerMembers.length !== 1 ||
          linkedMembers[0].user_id !== account.id || linkedMembers[0].email !== currentLogin ||
          linkedMembers[0].role !== 'owner' || ownerMembers[0].email !== currentLogin) {
        throw new Error('管理员成员关联不一致；未修改账号。');
      }
      const classrooms = db.prepare('SELECT owner_id FROM classrooms').all();
      if (classrooms.length === 0 || classrooms.some(classroom => classroom.owner_id !== account.id)) {
        throw new Error('班级管理员关联不一致；未修改账号。');
      }
      if (previous) {
        const renamedAccount = db.prepare("UPDATE accounts SET email = ? WHERE id = ? AND email = ? AND role = 'owner'")
          .run(nextLogin, account.id, previousLogin);
        const renamedMember = db.prepare("UPDATE members SET email = ? WHERE user_id = ? AND email = ? AND role = 'owner'")
          .run(nextLogin, account.id, previousLogin);
        if (renamedAccount.changes !== 1 || renamedMember.changes !== 1) {
          throw new Error('管理员改名数量不符合预期；已回滚。');
        }
      }
      db.exec('COMMIT');
      console.log(previous ? '管理员账号已改为 admin；密码、会话和班级数据均保留。' : '管理员账号已经是 admin；无需修改。');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : '管理员改名失败。');
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}
