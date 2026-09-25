'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createDemo, type Classroom } from '@/lib/classroom';
type ApiResult={classroom:Classroom|null;user:{name:string;email:string}|null;error?:string};
export class RejectedMutationError extends Error {}
export function useClassroom(){
 const [data,setData]=useState<Classroom>(()=>createDemo());
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [user,setUser]=useState<{name:string;email:string}|null>(null);
 const [initialized,setInitialized]=useState(false);
 const sequence=useRef(0),working=useRef(false),alive=useRef(true);
 const reload=useCallback(async()=>{
  if(working.current)return;const current=++sequence.current;
  try{const response=await fetch('/api/classroom',{cache:'no-store'});const result=await response.json() as ApiResult;if(!alive.current||current!==sequence.current)return;
   if(response.status===401){window.location.assign('/login');return}
   if(response.status===403){setUser(null);setInitialized(false);setData(previous=>previous.demo?previous:createDemo())}
   if(!response.ok)throw new Error(result.error||'暂时无法读取班级记录。');
   setUser(result.user);setError('');setInitialized(!!result.classroom);if(result.classroom)setData(result.classroom);
  }catch(e){if(alive.current&&current===sequence.current)setError(e instanceof Error?e.message:'网络暂时不可用，请重试。')}
  finally{if(alive.current&&current===sequence.current)setLoading(false)}
 },[]);
 useEffect(()=>{alive.current=true;const initial=setTimeout(()=>void reload(),0);const invalidate=()=>{++sequence.current};const refresh=()=>{if(!document.hidden)void reload()};window.addEventListener('focus',refresh);const timer=setInterval(refresh,20000);return()=>{alive.current=false;invalidate();clearTimeout(initial);clearInterval(timer);window.removeEventListener('focus',refresh)}},[reload]);
 const mutate=useCallback(async(input:Record<string,unknown>)=>{
  if(working.current)throw new Error('上一笔正在保存，请稍候。');working.current=true;setBusy(true);++sequence.current;
  try{const response=await fetch('/api/classroom',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const result=await response.json() as ApiResult;if(!response.ok){const message=result.error||'保存失败，请重试。';throw response.status<500?new RejectedMutationError(message):new Error(message)}if(alive.current){if(result.classroom)setData(result.classroom);setUser(result.user);setInitialized(true);setError('')}return result.classroom as Classroom;
  }finally{working.current=false;if(alive.current)setBusy(false)}
 },[]);
 return {data,setData,loading,busy,error,user,initialized,reload,mutate};
}
