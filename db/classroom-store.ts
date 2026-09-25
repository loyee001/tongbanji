import { database as sqliteDatabase } from './sqlite';
import { getChatGPTUser, type ChatGPTUser } from '@/app/chatgpt-auth';
import type { Student, Entry } from '@/lib/classroom';
export class ApiError extends Error{constructor(public status:number,message:string){super(message);}}
export const database=sqliteDatabase;
export type Member={email:string;userId:string|null;name:string;role:'owner'|'recorder'};
export type Room={id:string;name:string;ownerId:string;createdAt:string};
export async function identity(){const user=await getChatGPTUser();if(!user)throw new ApiError(401,'请先登录，再保存班级记录。');return user;}
export async function room(){return database().prepare('SELECT id,name,owner_id AS ownerId,created_at AS createdAt FROM classrooms WHERE id = ?').bind('main').first<Room>();}
export async function membership(user:ChatGPTUser,current:Room){
 const member=await database().prepare('SELECT email,user_id AS userId,name,role FROM members WHERE user_id = ? OR (user_id IS NULL AND email = ?) LIMIT 1').bind(user.userId,user.email.trim().toLowerCase()).first<Member>();
 if(current.ownerId===user.userId&&member)return {...member,role:'owner' as const};
 if(!member)throw new ApiError(403,'你的账号尚未被设为本班记录员，请联系老师。');
 if(!member.userId){await database().prepare('UPDATE members SET user_id = ? WHERE email = ? AND user_id IS NULL').bind(user.userId,member.email).run();const bound=await database().prepare('SELECT user_id AS userId FROM members WHERE email=?').bind(member.email).first<{userId:string}>();if(bound?.userId!==user.userId)throw new ApiError(403,'该记录员账号已绑定其他登录身份。');}
 return member;
}
export async function loadClassroom(user:ChatGPTUser){
 const current=await room();if(!current)return {classroom:null,user:{name:user.displayName,email:user.email}};
 const member=await membership(user,current);
 const results=await database().batch([
  database().prepare('SELECT id,number,name,group_name AS "group" FROM students WHERE class_id = ? ORDER BY number COLLATE NOCASE').bind('main'),
  database().prepare('SELECT e.id,e.batch_id AS batchId,e.student_id AS studentId,e.title,e.category,e.points,e.unit_points AS unitPoints,e.quantity,e.date,e.created_at AS createdAt,e.operator,e.voided_at AS voidedAt,e.void_reason AS voidReason FROM entries e JOIN students s ON s.id=e.student_id WHERE s.class_id = ? ORDER BY e.created_at DESC,e.id DESC').bind('main'),
 ]);
 const roster=member.role==='owner'?await database().prepare('SELECT email,name,role FROM members ORDER BY role,name').all():null;
 return {classroom:{name:current.name,students:results[0].results as unknown as Student[],entries:results[1].results as unknown as Entry[],demo:false,role:member.role,operator:member.name,members:roster?.results||[]},user:{name:member.name,email:user.email}};
}
