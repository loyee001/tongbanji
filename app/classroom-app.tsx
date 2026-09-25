'use client';
import { useState, useRef, type CSSProperties } from 'react';
import { Sprout, LayoutDashboard, Users, Trophy, Files, Settings, Download, Search, Plus, Minus, Check, ChevronLeft, ChevronRight, PenLine, CalendarDays, BookOpen, ArrowUpRight } from 'lucide-react';
import { Sidebar, SidebarProvider, SidebarHeader, SidebarContent, SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from '@/components/ui/sidebar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import ClassroomDialogs from './classroom-dialogs';
import RulesManager from './rules-manager';
import BlankRegisterDialog from './blank-register-dialog';
import { useClassroom, RejectedMutationError } from './use-classroom';
import { useClassroomTools } from './use-classroom-tools';
import { Table, TableBody, TableHead, TableHeader, TableRow, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { createUuid } from '@/lib/uuid';
import QuickEntryItems, { type DraftItem, draftKey } from './quick-entry-items';
import { calculateScores, bottomFive, signed, weekOf, chinaToday, shiftDate, validDate, rules, type Rule } from '@/lib/classroom';

export default function ClassroomApp(){const classroom=useClassroom();return <ClassroomWorkspace key={classroom.data.demo?'demo':'real'} classroom={classroom}/>;}
function ClassroomWorkspace({classroom}:{classroom:ReturnType<typeof useClassroom>}){
 const {data,setData,loading,busy,error,user,reload,mutate}=classroom;
 const pendingBatch=useRef<{fingerprint:string;id:string}|null>(null);const saving=useRef(false);
 const [studentPage,setStudentPage]=useState(0);
 const [selected,setSelected]=useState<string[]>([]);
 const [search,setSearch]=useState('');const [group,setGroup]=useState('all');
 const activeRules=data.rules??rules;
 const [draftItems,setDraftItems]=useState<DraftItem[]>(()=>activeRules[0]?[{key:draftKey(activeRules[0]),rule:activeRules[0],quantity:'1'}]:[]);
 const [editingItem,setEditingItem]=useState<string|null>(null);const [date,setDate]=useState(chinaToday());
 const [submitting,setSubmitting]=useState(false);const [needsConfirmation,setNeedsConfirmation]=useState(false);
 const outdatedItems=draftItems.filter(item=>item.rule.id!=='custom'&&!activeRules.some(rule=>rule.id===item.rule.id&&rule.title===item.rule.title&&rule.category===item.rule.category&&rule.points===item.rule.points&&(rule.note??'')===(item.rule.note??'')&&(rule.version??1)===(item.rule.version??1)));
 function refreshDraftRules(){setDraftItems(items=>items.flatMap(item=>{if(item.rule.id==='custom')return [item];const rule=activeRules.find(rule=>rule.id===item.rule.id);return rule?[{...item,rule,key:draftKey(rule)}]:[]}));}
 const validItems=draftItems.length>0&&draftItems.every(item=>/^\d+$/.test(item.quantity)&&Number(item.quantity)>=1&&Number(item.quantity)<=100);
 const perStudentTotal=validItems?draftItems.reduce((total,item)=>total+item.rule.points*Number(item.quantity),0):null;
 function chooseRule(nextRule:Rule){
  if(saving.current||needsConfirmation)return;
  if(!editingItem&&draftItems.length>=50){toast.error('一次最多选择 50 项事项。');return}
  const key=draftKey(nextRule);const duplicate=draftItems.find(item=>item.key===key&&item.key!==editingItem);
  if(editingItem&&duplicate){toast.error('清单中已有此事项，请直接修改该项次数。');return}
  if(editingItem)setDraftItems(items=>items.map(item=>item.key===editingItem?{...item,key,rule:nextRule}:item));
  else if(!duplicate)setDraftItems(items=>[...items,{key,rule:nextRule,quantity:'1'}]);
  setEditingItem(null);setDialog(null);
 }
 const [week,setWeek]=useState(weekOf(chinaToday()));const [rankTab,setRankTab]=useState('top');const [rankPage,setRankPage]=useState(0);
 const [dialog,setDialog]=useState<string|null>(null);
 const scores=calculateScores(data.students,data.entries,week.start,week.end);
 const groups=[...new Set(data.students.map(s=>s.group).filter(Boolean))];
 const filtered=data.students.filter(s=>(group==='all'||s.group===group)&&(!search||s.name.includes(search)||s.number.includes(search)));
 const displayed=filtered.slice(studentPage*12,studentPage*12+12);
 const ranked=rankTab==='bottom'?bottomFive(scores):scores.slice(rankPage*5,rankPage*5+5);
 const entries=data.entries.filter(e=>!e.voidedAt).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,4);
 function toggle(id:string){setSelected(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);}
 async function onVoid(input:{entryId?:string;batchId?:string;reason:string}){
  if(data.demo){setData(d=>({...d,entries:d.entries.map(e=>(input.entryId?e.id===input.entryId:e.batchId===input.batchId)&&!e.voidedAt?{...e,voidedAt:new Date().toISOString(),voidReason:input.reason}:e)}))}
  else await mutate({action:'void',...input});toast.success('已撤销，积分和排名已重新计算。');
 }
 async function save(){
  if(saving.current||loading||busy)return;
  if(!needsConfirmation&&outdatedItems.length){toast.error('公约已调整，请先更新待提交事项并核对分值。');return}
  if(!validItems){toast.error('请选择事项，并为每项填写 1–100 的整数次数。');return}
  const studentIds=selected.filter(id=>data.students.some(s=>s.id===id));
  if(!studentIds.length){toast.error('请先选择同学。');return}
  if(!validDate(date)||date>chinaToday()||date<'2000-01-01'){toast.error('请选择有效的发生日期，不能晚于今天。');return}
  saving.current=true;setSubmitting(true);
  try{
  const items=draftItems.map(item=>({title:item.rule.title,category:item.rule.category,points:item.rule.points,quantity:Number(item.quantity)}));
  const payload={studentIds:[...studentIds].sort(),items,date};
  const fingerprint=JSON.stringify(payload);if(pendingBatch.current?.fingerprint!==fingerprint)pendingBatch.current={fingerprint,id:createUuid()};const batchId=pendingBatch.current.id;
   if(data.demo){const createdAt=new Date().toISOString();setData(d=>({...d,entries:[...d.entries,...studentIds.flatMap(studentId=>items.map((item,index)=>({id:`${batchId}:${studentId}:${index}`,batchId,studentId,title:item.title,category:item.category,points:item.points*item.quantity,unitPoints:item.points,quantity:item.quantity,date,createdAt,operator:d.operator||'演示记录员',voidedAt:null})))]}))}
   else await mutate({action:'record',batchId,...payload});
   pendingBatch.current=null;setNeedsConfirmation(false);setSelected([]);setDraftItems([]);setWeek(weekOf(date));setRankPage(0);
   toast.success(`${data.demo?'演示：':''}已登记 ${studentIds.length} 人、${items.length} 项，每人合计 ${signed(items.reduce((total,item)=>total+item.points*item.quantity,0))} 分`,{action:{label:'撤销这批',onClick:()=>{void onVoid({batchId,reason:'记录员撤销本批登记'}).catch(e=>toast.error(e.message))}}});
  }catch(e){
   if(e instanceof RejectedMutationError){pendingBatch.current=null;setNeedsConfirmation(false)}
   else if(!data.demo&&pendingBatch.current)setNeedsConfirmation(true);
   toast.error(e instanceof Error?e.message:'保存失败，选择已保留，请重试。')
  }finally{saving.current=false;setSubmitting(false)}
 }
 useClassroomTools({data,week,onStage:(ids,nextRule,nextDate)=>{if(saving.current||needsConfirmation)return;setSelected(ids);setDraftItems([{key:draftKey(nextRule),rule:nextRule,quantity:'1'}]);setDate(nextDate);setDialog(null)}});
 async function logout(){try{const response=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});if(!response.ok)throw new Error('退出失败，请重试。');window.location.assign('/login')}catch(e){toast.error((e as Error).message)}}
 const navItems=[{icon:LayoutDashboard,label:'登记台',target:null},{icon:Users,label:'全班积分',target:'students'},{icon:Trophy,label:'排行榜',target:'ranking'},{icon:Files,label:'记录与导出',target:'records'},{icon:BookOpen,label:'班级公约',target:'manageRules'},{icon:Settings,label:'班级设置',target:'settings'}];
 return <SidebarProvider style={{'--sidebar-width':'13.5rem'} as CSSProperties} className="app-shell">
  <Sidebar collapsible="none" className="class-sidebar"><SidebarHeader className="brand"><span className="brand-mark"><Sprout/></span><span><strong>同班记</strong><small>CLASS LOG</small></span></SidebarHeader><SidebarContent className="side-content"><span className="nav-label">班级工作台</span><SidebarMenu>{navItems.map(({icon:Icon,label,target})=><SidebarMenuItem key={label}><SidebarMenuButton className="nav-button" isActive={target===dialog} onClick={()=>setDialog(target)}><Icon/><span>{label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarContent><SidebarFooter className="operator"><span className="avatar">{(data.operator||"记").slice(0,1)}</span><div><strong>{data.operator}</strong><small>{data.demo?"演示记录员":data.role==='owner'?"班级管理员":"学生记录员"}</small></div></SidebarFooter></Sidebar>
  <div className="app-body"><header className="topbar"><span className="breadcrumb">{data.name}<span>/</span>登记台</span><div className="top-actions"><button className="text-button" disabled={busy} onClick={logout}>退出</button><span className="demo-badge">{loading?"正在同步":data.demo?"演示班级":busy?"正在保存":"已连接班级"}</span><button className="button button-small" disabled={loading||!!error} onClick={()=>setDialog('blankRegister')}><Download size={16}/>导出登记空表</button><button className="button button-small" onClick={()=>setDialog('export')}><Download size={16}/>导出周报</button></div></header>
   <nav className="mobile-nav" aria-label="页面导航">{navItems.map(n=><button key={n.label} onClick={()=>setDialog(n.target)}>{n.label}</button>)}</nav>
   <main className="main-content">{error?<div className="connection-banner" role="alert"><span>{error}</span><button className="text-button" onClick={()=>void reload()}>重新连接</button></div>:data.demo&&<div className="demo-banner"><span><b>先体验，再创建你的班级</b><small>当前为演示数据，刷新后重置。</small></span><button className="button button-small" disabled={loading} onClick={()=>setDialog("settings")}>创建我的班级 <ArrowUpRight size={15}/></button></div>}<div className="page-heading"><div><span className="eyebrow">OUR CLASS, EVERY DAY</span><h1>班级登记台<span className="heading-dot">✦</span></h1><p>把认真与进步记下来，也把每一笔分数记清楚。</p></div><div className="week-switch"><button aria-label="上一周" onClick={()=>setWeek(weekOf(shiftDate(week.start,-7)))}><ChevronLeft size={17}/></button><span><CalendarDays size={16}/>{week.start.slice(5).replace('-','.')} — {week.end.slice(5).replace('-','.')}</span><button aria-label="下一周" onClick={()=>setWeek(weekOf(shiftDate(week.start,7)))}><ChevronRight size={17}/></button></div></div>
    <div className="metrics"><section className="metric yellow"><span>班级同学</span><Users/><strong>{data.students.length}<small>人</small></strong><p>每人从 0 分开始</p></section><section className="metric"><span>本周累计加分</span><Plus/><strong className="positive">+{scores.reduce((n,s)=>n+s.plus,0)}<small>分</small></strong><p>认真、主动与进步</p></section><section className="metric"><span>本周累计扣分</span><Minus/><strong className="negative">−{scores.reduce((n,s)=>n+s.minus,0)}<small>分</small></strong><p>按班级公约如实记录</p></section></div>
    <div className="workspace"><section className="panel entry-panel"><div className="panel-heading"><h2><PenLine/>快速登记</h2><span className="mini-pill">多人 · 多项 · 多次</span></div><fieldset className="entry-fields" disabled={busy||submitting||loading||needsConfirmation}><div className="step-heading"><h3><b>01</b>选择同学</h3><button className="text-button" onClick={()=>setSelected(filtered.map(s=>s.id))}>{search?'选择搜索结果':group==='all'?'选择全班':'选择本组'}</button></div><div className="search"><Search/><Input aria-label="搜索姓名或学号" placeholder="搜索姓名或学号" value={search} onChange={e=>{setSearch(e.target.value);setStudentPage(0)}}/></div><div className="group-filters"><button className={group==='all'?'active':''} onClick={()=>{setGroup('all');setStudentPage(0)}}>全部</button>{groups.map(g=><button className={g===group?'active':''} key={g} onClick={()=>{setGroup(g);setStudentPage(0)}}>{g}</button>)}</div><div className="student-grid">{displayed.map(s=><button key={s.id} className={`student ${selected.includes(s.id)?'selected':''}`} aria-pressed={selected.includes(s.id)} onClick={()=>toggle(s.id)}><span className="student-number">{s.number}</span><strong>{s.name}</strong><span className="student-points">{signed(scores.find(x=>x.id===s.id)?.total||0)} 分</span>{selected.includes(s.id)&&<Check className="check-mark"/>}</button>)}</div>{filtered.length===0&&<p className="empty-message">没有找到同学，换个姓名或学号试试。</p>}{filtered.length>12&&<div className="student-pagination"><button className="text-button" aria-label="上一页同学" disabled={studentPage===0} onClick={()=>setStudentPage(p=>p-1)}><ChevronLeft size={16}/>上一页</button><span>{studentPage+1} / {Math.ceil(filtered.length/12)}</span><button className="text-button" aria-label="下一页同学" disabled={(studentPage+1)*12>=filtered.length} onClick={()=>setStudentPage(p=>p+1)}>下一页<ChevronRight size={16}/></button></div>}<div className="selection-meta"><span>已选 <b>{selected.length}</b> 人 / 共 {data.students.length} 人</span><button className="text-button" onClick={()=>setSelected([])}>清空选择</button></div>
     <QuickEntryItems rules={activeRules} items={draftItems} onChange={setDraftItems} onBrowse={()=>{setEditingItem(null);setDialog('rules')}} onEdit={key=>{setEditingItem(key);setDialog('rules')}}/>
     {outdatedItems.length>0&&!needsConfirmation&&<div className="rules-draft-warning" role="alert"><span>有 {outdatedItems.length} 项公约已修改或删除，请更新并核对后再提交。</span><button className="text-button" onClick={refreshDraftRules}>更新待提交事项</button></div>}<div className="date-row"><label htmlFor="entry-date">发生日期</label><Input id="entry-date" type="date" value={date} max={chinaToday()} onChange={e=>setDate(e.target.value)}/></div>
     <div className="entry-summary" aria-live="polite"><span>已选 <b>{selected.length} 位同学 · {draftItems.length} 项事项</b></span><span>每人合计 <b>{perStudentTotal===null?(draftItems.length?'待填写次数':'0 分'):`${signed(perStudentTotal)} 分`}</b></span></div>
     <p className="draft-hint">提交前可修改同学、事项、次数和日期；确认后才计入积分。</p>
     </fieldset>{needsConfirmation&&<p className="form-note" role="alert">上次提交结果尚未确认，内容已暂时锁定。请重试确认这批，系统不会重复计分。</p>}<button className="button button-primary save-button" disabled={!selected.length||!validItems||busy||submitting||loading||!!error||(!needsConfirmation&&outdatedItems.length>0)} onClick={save}><Check size={18}/>{busy||submitting?"正在保存…":needsConfirmation?"重试确认这批":`确认登记 · ${selected.length} 人`}</button></section>
     <aside className="panel ranking-panel"><div className="panel-heading"><h2><Trophy/>本周排行榜</h2><span className="label-small">净积分</span></div><Tabs value={rankTab} onValueChange={value=>{setRankTab(value);setRankPage(0)}} className="rank-tabs"><TabsList><TabsTrigger value="top">前 10 名</TabsTrigger><TabsTrigger value="bottom">后 5 名</TabsTrigger></TabsList><TabsContent value={rankTab}><div className="rank-list" style={{maxHeight:rankTab==='bottom'?460:undefined,overflowY:'auto'}} >{ranked.map(s=><button className="rank-row" key={s.id} onClick={()=>setDialog('student:'+s.id)}><span className="rank-number">{String(s.rank).padStart(2,'0')}</span><span className="rank-person"><strong>{s.name}{s.tied&&<small>并列</small>}</strong><span>加 {s.plus} / 扣 {s.minus}</span></span><strong className={`rank-score ${s.total<0?'negative':'positive'}`}>{signed(s.total)}</strong></button>)}</div></TabsContent></Tabs><div className="rank-paging"><span>{rankTab==='bottom'?`共 ${ranked.length} 人（含边界同分）`:`第 ${rankPage*5+1}—${Math.min(rankPage*5+5,scores.length)} 位`}</span>{rankTab==='top'&&scores.length>5&&<button className="text-button" onClick={()=>setRankPage(p=>p===0?1:0)}>{rankPage?'← 返回前 5 位':'第 6—10 位 →'}</button>}</div><div className="rank-note"><BookOpen size={16}/><p>本周加分 − 扣分。同分并列，后 5 名包含边界同分同学。</p></div><button className="button rank-all" onClick={()=>setDialog('ranking')}>查看全班排行<ArrowUpRight size={16}/></button></aside></div>
    <section className="panel recent-panel"><div className="panel-heading"><h2>最近登记</h2><button className="text-button" onClick={()=>setDialog('records')}>全部记录 <ArrowUpRight size={15}/></button></div><Table><TableHeader><TableRow><TableHead>学生</TableHead><TableHead>登记事项</TableHead><TableHead>分值</TableHead><TableHead>记录员</TableHead><TableHead>发生日期</TableHead></TableRow></TableHeader><TableBody>{entries.map(e=><TableRow key={e.id}><TableCell>{data.students.find(s=>s.id===e.studentId)?.name}</TableCell><TableCell><span className="category-tag">{e.category}</span>{e.title}<small className="block-meta">{signed(e.unitPoints??e.points)} 分 × {e.quantity??1} 次</small></TableCell><TableCell className={e.points>0?'positive':'negative'}>{signed(e.points)}</TableCell><TableCell>{e.operator}</TableCell><TableCell>{e.date}</TableCell></TableRow>)}</TableBody></Table>{entries.length===0&&<p className="empty-message">还没有登记记录，选好同学后记下第一笔吧。</p>}</section><footer className="page-footer"><span>同班记 · 我们班的每一天</span><span>初始 0 分 · 周统计 · 累计保留</span></footer>
   </main>
  </div>
  <ClassroomDialogs key={dialog||'closed'} data={data} dialog={dialog==='manageRules'||dialog==='blankRegister'?null:dialog} setDialog={setDialog} week={week} user={user} busy={busy} mutate={mutate} onRule={chooseRule} editingRule={draftItems.find(item=>item.key===editingItem)?.rule} onVoid={onVoid}/>{dialog==='manageRules'&&<RulesManager data={data} busy={busy||submitting} setData={setData} mutate={mutate} reload={reload} onClose={()=>setDialog(null)}/>} {dialog==='blankRegister'&&<BlankRegisterDialog data={data} onClose={()=>setDialog(null)}/>}<Toaster richColors position="bottom-right"/>
 </SidebarProvider>;
}
