import { z } from 'zod';
import { sameOrigin, saveRecorder } from '@/server/auth';
export const runtime='nodejs';
import { database, identity, room, membership, loadClassroom, ApiError } from '@/db/classroom-store';
import { validDate, chinaToday, categories } from '@/lib/classroom';
import { createRecordInputSchema } from '@/lib/record-input';
import { recordEntries, RecordError } from '@/db/record-entries';
export const dynamic='force-dynamic';
const student=z.object({number:z.string().trim().min(1).max(20),name:z.string().trim().min(1).max(30),group:z.string().trim().max(30)}).strict();
const roster=z.array(student).min(1).max(200).refine(rows=>new Set(rows.map(s=>s.number)).size===rows.length,'学号不能重复');
const inputSchema=z.union([
 z.object({action:z.literal('create'),name:z.string().trim().min(1).max(40),operator:z.string().trim().min(1).max(30),students:roster}).strict(),
 z.object({action:z.literal('addStudents'),students:roster}).strict(),
 createRecordInputSchema(categories,d=>validDate(d)&&d<=chinaToday()&&d>='2000-01-01'),
 z.object({action:z.literal('void'),batchId:z.string().min(1).max(100).optional(),entryId:z.string().min(1).max(150).optional(),reason:z.string().trim().min(1).max(120)}).strict().refine(v=>Boolean(v.batchId)!==Boolean(v.entryId)),
 z.object({action:z.literal('settings'),name:z.string().trim().min(1).max(40),operator:z.string().trim().min(1).max(30)}).strict(),
 z.object({action:z.literal('member'),email:z.string().trim().email().max(160),name:z.string().trim().min(1).max(30),password:z.string().min(10).max(128).optional()}).strict(),
 z.object({action:z.literal('removeMember'),email:z.string().trim().email().max(160)}).strict(),
]);
function json(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'no-store'}});}
function failure(error:unknown){if(error instanceof ApiError||error instanceof RecordError)return json({error:error.message},error.status);if(error instanceof z.ZodError)return json({error:'请检查填写内容：学生、单次分值、次数（1–100）和发生日期必须有效。'},400);console.error('Classroom request failed',error);return json({error:'保存服务暂时不可用，填写内容已保留，请稍后重试。'},503);}
export async function GET(){try{return json(await loadClassroom(await identity()));}catch(e){return failure(e)}}
export async function POST(request:Request){try{
 if(!sameOrigin(request))throw new ApiError(403,'请求来源无效。');
 if(!request.headers.get('content-type')?.includes('application/json'))throw new ApiError(415,'请使用有效的登记请求。');
 const raw=await request.text();if(raw.length>100000)throw new ApiError(413,'本次内容过多，请分批导入。');
 let parsed:unknown;try{parsed=JSON.parse(raw)}catch{throw new ApiError(400,'提交内容格式无效。')}
 const input=inputSchema.parse(parsed);const user=await identity();const db=database();const current=await room();const now=new Date().toISOString();
 if(input.action==='create'){
  if(user.role!=='owner')throw new ApiError(403,'班级由管理员创建。');
  if(current)throw new ApiError(409,'班级已经创建，请刷新页面查看。');
  const students=input.students.map(s=>({...s,id:crypto.randomUUID()}));const setupToken=crypto.randomUUID();
  await db.batch([
   db.prepare('INSERT OR IGNORE INTO batches (id,creator_id,payload_hash,created_at) VALUES (?,?,?,?)').bind('class-initialization',user.userId,setupToken,now),
   db.prepare('INSERT OR IGNORE INTO classrooms (id,name,owner_id,created_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM batches WHERE id=? AND payload_hash=?)').bind('main',input.name,user.userId,now,'class-initialization',setupToken),
   db.prepare('INSERT OR IGNORE INTO members (email,user_id,name,role) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM classrooms WHERE id=? AND owner_id=?) AND EXISTS (SELECT 1 FROM batches WHERE id=? AND payload_hash=?)').bind(user.email.trim().toLowerCase(),user.userId,input.operator,'owner','main',user.userId,'class-initialization',setupToken),
   db.prepare("INSERT OR IGNORE INTO students (id,class_id,number,name,group_name) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.number'),json_extract(value,'$.name'),json_extract(value,'$.group') FROM json_each(?) WHERE EXISTS (SELECT 1 FROM classrooms WHERE id=? AND owner_id=?) AND EXISTS (SELECT 1 FROM batches WHERE id=? AND payload_hash=?)").bind('main',JSON.stringify(students),'main',user.userId,'class-initialization',setupToken),
  ]);
  return json(await loadClassroom(user),201);
 }
 if(!current)throw new ApiError(409,'请先创建班级并导入真实名单。');
 const member=await membership(user,current);
 if(['addStudents','settings','member','removeMember'].includes(input.action)&&member.role!=='owner')throw new ApiError(403,'这项设置由老师或管理员维护。');
 if(input.action==='record'){
  recordEntries(db,input,{userId:user.userId,operator:member.name,now});
 }else if(input.action==='void'){
  const clause=input.entryId?'id=?':'batch_id=?';const target=input.entryId||input.batchId;
  const exists=await db.prepare(`SELECT id FROM entries WHERE ${clause} LIMIT 1`).bind(target!).first();if(!exists)throw new ApiError(404,'没有找到这笔登记。');
  await db.prepare(`UPDATE entries SET voided_at=?,void_reason=?,voided_by=? WHERE ${clause} AND voided_at IS NULL`).bind(now,input.reason,member.name,target!).run();
 }else if(input.action==='addStudents'){
  const existing=await db.prepare('SELECT number FROM students WHERE class_id=?').bind('main').all<{number:string}>();
  if(existing.results.length+input.students.length>200)throw new ApiError(400,'一个班级最多登记 200 位同学。');
  const old=new Set(existing.results.map(s=>s.number));if(input.students.some(s=>old.has(s.number)))throw new ApiError(409,'导入名单的学号与现有同学重复。');
  const rows=input.students.map(s=>({...s,id:crypto.randomUUID()}));
  const inserted=await db.prepare("INSERT INTO students (id,class_id,number,name,group_name) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.number'),json_extract(value,'$.name'),json_extract(value,'$.group') FROM json_each(?) WHERE (SELECT COUNT(*) FROM students WHERE class_id=?) + ? <= 200").bind('main',JSON.stringify(rows),'main',rows.length).run();
  if(!inserted.meta.changes)throw new ApiError(409,'名单已更新，当前人数将超过 200 人，请刷新后再试。');
 }else if(input.action==='settings'){
  await db.batch([db.prepare('UPDATE classrooms SET name=? WHERE id=?').bind(input.name,'main'),db.prepare('UPDATE members SET name=? WHERE user_id=?').bind(input.operator,user.userId)]);
 }else if(input.action==='member'){
  try{await saveRecorder(input.email.toLowerCase(),input.name,input.password)}catch(error){throw new ApiError(400,error instanceof Error?error.message:'记录员账号保存失败。')}
 }else if(input.action==='removeMember'){
  await db.batch([db.prepare("DELETE FROM accounts WHERE email=? AND role='recorder'").bind(input.email.toLowerCase()),db.prepare("DELETE FROM members WHERE email=? AND role='recorder'").bind(input.email.toLowerCase())]);
 }
 return json(await loadClassroom(user));
 }catch(error){return failure(error)}}
