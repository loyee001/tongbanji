import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync } from 'node:crypto';
import { resolve } from 'node:path';
const email=process.argv[2]?.trim().toLowerCase();
if(!email)throw new Error('用法：node scripts/reset-password.mjs 管理员或记录员邮箱');
const db=new DatabaseSync(resolve(process.env.DATA_DIR||'./data','classroom.sqlite'));
try{const account=db.prepare('SELECT id FROM accounts WHERE email=?').get(email);if(!account)throw new Error('账号不存在。请先完成首次登录。');const password=randomBytes(16).toString('hex'),salt=randomBytes(16).toString('hex');const hash=`scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`;db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');try{db.prepare('UPDATE accounts SET password_hash=? WHERE id=?').run(hash,account.id);db.prepare('DELETE FROM sessions WHERE account_id=?').run(account.id);db.prepare('DELETE FROM login_attempts WHERE key=?').run(email);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}console.log(`账号：${email}\n新密码：${password}\n旧会话已失效，请妥善保存新密码。`)}finally{db.close()}
