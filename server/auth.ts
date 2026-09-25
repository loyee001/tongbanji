import { cookies } from 'next/headers';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { database } from '../db/sqlite';
const deriveKey=promisify(scrypt);
const cookieName='tongbanji_session';
const lifetime=8*60*60;
export type LocalUser={userId:string;email:string;displayName:string;fullName:string;role:'owner'|'recorder'};
type Account={id:string;email:string;name:string;passwordHash:string;role:'owner'|'recorder'};
export function publicOrigin(){const value=process.env.APP_URL;if(!value)throw new Error('请配置 APP_URL。');const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('APP_URL 必须是网站访问地址。');return url.origin;}
export function sameOrigin(request:Request){return request.headers.get('origin')===publicOrigin()}
export function sessionCookie(){return {name:cookieName,httpOnly:true,sameSite:'strict' as const,secure:publicOrigin().startsWith('https:'),path:'/',maxAge:lifetime}}
export async function hashPassword(password:string){const salt=randomBytes(16).toString('hex');const key=await deriveKey(password,salt,64) as Buffer;return `scrypt:${salt}:${key.toString('hex')}`;}
async function verifyPassword(password:string,hash:string){const [scheme,salt,stored]=hash.split(':');if(scheme!=='scrypt'||!salt||!stored)return false;const key=await deriveKey(password,salt,64) as Buffer;const actual=Buffer.from(stored,'hex');return actual.length===key.length&&timingSafeEqual(key,actual);}
let seeding:Promise<void>|undefined;
async function seedAdministrator(){if(seeding)return seeding;seeding=(async()=>{const db=database();if(await db.prepare("SELECT id FROM accounts WHERE role='owner'").first())return;const email=process.env.ADMIN_EMAIL?.trim().toLowerCase();const password=process.env.ADMIN_PASSWORD;if(!email||!/^\S+@\S+\.\S+$/.test(email)||!password||password.length<10||password.length>128)throw new Error('首次启动需设置管理员邮箱和至少 10 位密码。');const hashed=await hashPassword(password);await db.prepare("INSERT OR IGNORE INTO accounts (id,email,name,password_hash,role) VALUES (?,?,?,?,'owner')").bind('administrator',email,'管理员',hashed).run()})().catch(error=>{seeding=undefined;throw error});return seeding;}
const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export async function getLocalUser():Promise<LocalUser|null>{const token=(await cookies()).get(cookieName)?.value;if(!token||!/^[a-f0-9]{64}$/.test(token))return null;const row=await database().prepare('SELECT a.id,a.email,a.name,a.role FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?').bind(tokenHash(token),new Date().toISOString()).first<Account>();return row?{userId:row.id,email:row.email,displayName:row.name,fullName:row.name,role:row.role}:null;}
export async function signIn(email:string,password:string){await seedAdministrator();const db=database(),key=email.trim().toLowerCase(),now=Date.now();
 // Reserve an attempt before hashing so concurrent requests share the same limit.
 const attempt=await db.prepare('INSERT INTO login_attempts (key,attempts,window_start) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start<? THEN 1 ELSE attempts+1 END,window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END RETURNING attempts').bind(key,now,now-15*60*1000,now-15*60*1000).first<{attempts:number}>();
 if((attempt?.attempts||0)>10)return {error:'尝试次数过多，请 15 分钟后再试。',status:429} as const;
 const account=await db.prepare('SELECT id,email,name,password_hash AS passwordHash,role FROM accounts WHERE email=?').bind(key).first<Account>();
 const dummy='scrypt:00000000000000000000000000000000:'+ '00'.repeat(64);const valid=await verifyPassword(password,account?.passwordHash||dummy);if(!account||!valid)return {error:'账号或密码不正确。',status:401} as const;
 const token=randomBytes(32).toString('hex');const saved=await db.batch([db.prepare('DELETE FROM login_attempts WHERE key=?').bind(key),db.prepare('DELETE FROM login_attempts WHERE window_start<?').bind(now-15*60*1000),db.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(new Date().toISOString()),db.prepare('INSERT INTO sessions (token_hash,account_id,expires_at) SELECT ?,id,? FROM accounts WHERE id=? AND password_hash=?').bind(tokenHash(token),new Date(now+lifetime*1000).toISOString(),account.id,account.passwordHash)]);if(saved.at(-1)?.meta.changes!==1)return {error:'账号信息已变更，请重新登录。',status:401} as const;return {token,status:200} as const;
}
export async function signOut(){const token=(await cookies()).get(cookieName)?.value;if(token)await database().prepare('DELETE FROM sessions WHERE token_hash=?').bind(tokenHash(token)).run()}
export async function saveRecorder(email:string,name:string,password?:string){const db=database();const existing=await db.prepare('SELECT id,role FROM accounts WHERE email=?').bind(email).first<{id:string;role:string}>();if(existing?.role==='owner')throw new Error('该账号是管理员。');if(!existing&&!password)throw new Error('新记录员需要设置登录密码。');const hash=password?await hashPassword(password):null;const current=await db.prepare('SELECT id FROM accounts WHERE email=?').bind(email).first<{id:string}>();const id=current?.id||randomUUID();
 const statements=[db.prepare("INSERT INTO members (email,user_id,name,role) SELECT ?,?,?,'recorder' WHERE (SELECT COUNT(*) FROM members WHERE role='recorder')<2 OR EXISTS(SELECT 1 FROM members WHERE email=? AND role='recorder') ON CONFLICT(email) DO UPDATE SET name=excluded.name").bind(email,id,name,email),db.prepare("INSERT INTO accounts (id,email,name,password_hash,role) SELECT ?,?,?,?,'recorder' WHERE EXISTS(SELECT 1 FROM members WHERE email=? AND role='recorder') ON CONFLICT(email) DO UPDATE SET name=excluded.name,password_hash=COALESCE(?,accounts.password_hash)").bind(id,email,name,hash||'',email,hash)];
 if(password)statements.push(db.prepare('DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE email=?)').bind(email));const result=await db.batch(statements);if(!result[0].meta.changes)throw new Error('最多设置 2 名学生记录员。');
}
