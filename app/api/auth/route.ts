import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sameOrigin, sessionCookie, signIn, signOut } from '@/server/auth';
export const runtime='nodejs';
export async function POST(request:Request){try{if(!sameOrigin(request))return NextResponse.json({error:'请求来源无效，请从配置的网站地址登录。'},{status:403});if(!request.headers.get('content-type')?.includes('application/json'))return NextResponse.json({error:'请求格式无效。'},{status:415});const body=await request.text();if(body.length>2048)return NextResponse.json({error:'请求内容过长。'},{status:413});const input=z.union([z.object({action:z.literal('login'),email:z.string().trim().email().max(160),password:z.string().min(1).max(128)}).strict(),z.object({action:z.literal('logout')}).strict()]).parse(JSON.parse(body));
 if(input.action==='logout'){await signOut();const response=NextResponse.json({ok:true});response.cookies.set({...sessionCookie(),value:'',maxAge:0});return response}
 const result=await signIn(input.email,input.password);if('error' in result)return NextResponse.json({error:result.error},{status:result.status});const response=NextResponse.json({ok:true});response.cookies.set({...sessionCookie(),value:result.token});response.headers.set('Cache-Control','no-store');return response;
 }catch(error){if(error instanceof z.ZodError||error instanceof SyntaxError)return NextResponse.json({error:'请填写有效账号和密码。'},{status:400});console.error('Login unavailable',error instanceof Error?error.message:'unknown');return NextResponse.json({error:'登录服务未就绪，请检查服务器配置。'},{status:503})}}
