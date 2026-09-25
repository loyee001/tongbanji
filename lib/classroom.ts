export type Student = { id: string; number: string; name: string; group: string };
export type Rule = { id: string; category: string; title: string; points: number; note?: string };
export type Entry = { id: string; batchId: string; studentId: string; title: string; category: string; points: number; unitPoints?: number; quantity?: number; date: string; createdAt: string; operator: string; voidedAt: string | null; voidReason?: string };
export type Classroom = { name: string; students: Student[]; entries: Entry[]; demo: boolean; role?: string; operator?: string; members?: {email:string;name:string;role:string}[] };
export type Score = Student & { plus: number; minus: number; total: number; rank: number; tied: boolean };
export const categories = ['出勤','早读','课前','上课','眼操','课间','自习课','作业','卫生','仪容仪表','升旗','路队','其他'];
export const rules: Rule[] = [
 {id:'reading',category:'早读',title:'早读认真',points:1},
 {id:'answer',category:'上课',title:'主动举手回答问题',points:1},
 {id:'homework',category:'作业',title:'未按时交作业',points:-1},
 {id:'duty',category:'卫生',title:'无故不值日',points:-2},
 {id:'reading-talk',category:'早读',title:'早读未读书或讲话',points:-1},
 {id:'seat',category:'课前',title:'铃响未回座位或继续讲话',points:-1},
 {id:'supplies',category:'课前',title:'未准备课本和学习用品',points:-1},
 {id:'class-discipline',category:'上课',title:'课堂一般违纪',points:-1},
 {id:'class-praise',category:'上课',title:'课堂获老师表扬',points:1},
 {id:'eye-discipline',category:'眼操',title:'眼操不认真',points:-1},
 {id:'eye-award',category:'眼操',title:'获得眼操红旗',points:1},
 {id:'break-discipline',category:'课间',title:'课间违纪',points:-1},
 {id:'civilized-award',category:'课间',title:'获得文明红旗',points:1},
 {id:'study-praise',category:'自习课',title:'自习课获表扬',points:1},
 {id:'hygiene-discipline',category:'卫生',title:'乱扔垃圾或带零食进教室',points:-1},
 {id:'duty-careless',category:'卫生',title:'值日不认真',points:-1},
 {id:'cleaning-unfinished',category:'卫生',title:'上课后仍未完成卫生打扫',points:-1},
 {id:'flag-uniform',category:'升旗',title:'升旗未穿校服',points:-1},
 {id:'flag-discipline',category:'升旗',title:'升旗讲话或乱动',points:-1},
 {id:'queue-award',category:'路队',title:'获得路队红旗',points:1},
];
export function chinaToday(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function shiftDate(date:string,days:number){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function weekOf(date:string){const day=new Date(date+'T00:00:00Z').getUTCDay();const start=shiftDate(date,-((day+6)%7));return {start,end:shiftDate(start,6)};}
export function validDate(date:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;const d=new Date(date+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===date;}
export function activeEntries(entries:Entry[],start?:string,end?:string){return entries.filter(e=>!e.voidedAt&&(!start||e.date>=start)&&(!end||e.date<=end));}
export function calculateScores(students:Student[],entries:Entry[],start?:string,end?:string):Score[]{
 const sums=new Map(students.map(s=>[s.id,{plus:0,minus:0}]));
 for(const e of activeEntries(entries,start,end)){const s=sums.get(e.studentId);if(s){if(e.points>0)s.plus+=e.points;else s.minus-=e.points;}}
 const rows=students.map(s=>{const sum=sums.get(s.id)!;return {...s,...sum,total:sum.plus-sum.minus,rank:0,tied:false}}).sort((a,b)=>b.total-a.total||a.number.localeCompare(b.number,'zh-CN',{numeric:true}));
 const frequencies=new Map<number,number>();rows.forEach(s=>frequencies.set(s.total,(frequencies.get(s.total)||0)+1));
 let rank=1;return rows.map((s,i)=>{if(!i||rows[i-1].total!==s.total)rank=i+1;return {...s,rank,tied:(frequencies.get(s.total)||0)>1}});
}
export function bottomFive(scores:Score[]){if(scores.length<=5)return scores;const threshold=scores[scores.length-5].total;return scores.filter(s=>s.total<=threshold);}
export function signed(n:number){return n>0?'+'+n:n<0?'−'+Math.abs(n):'0';}
export function parseRoster(text:string):Omit<Student,'id'>[]{
 const lines=text.split(/\r?\n/).filter(s=>s.trim());if(lines.length>200)throw new Error('一次最多导入 200 位同学。');
 const rows=lines.map((line,i)=>{const p=line.split(/[,，\t]/).map(s=>s.trim());return p.length===1?{number:String(i+1).padStart(2,'0'),name:p[0],group:''}:{number:p[0],name:p[1],group:p[2]||''}});
 if(!rows.length)throw new Error('请先填写学生名单。');
 if(rows.some(s=>!s.name||s.name.length>30||!s.number||s.number.length>20||s.group.length>30))throw new Error('请检查姓名、学号和小组，内容不能为空或过长。');
 if(new Set(rows.map(s=>s.number)).size!==rows.length)throw new Error('名单中有重复学号，请修改后再导入。');return rows;
}
export function createDemo():Classroom{
 const names=['陈沐阳','林知夏','周予安','许星禾','宋书宁','沈嘉禾','顾一诺','苏景辰','叶清和','唐可欣','陆明远','江语桐','何子墨','吴思齐','郑以宁','梁一凡','谢若溪','徐乐言','方嘉宁','蔡雨辰','蒋思远','程以安','韩诗悦','魏星澄','邓子轩','冯沐晴','彭书瑶','马亦辰','罗欣然','夏云舒','高梓涵','于乐知','丁予墨','杜可言','廖锦程','孟安然','田若宁','石云舟','白嘉乐','袁星宇'];
 const today=chinaToday();const students=names.map((name,i)=>({id:'demo-'+(i+1),number:String(i+1).padStart(2,'0'),name,group:'第 '+(Math.floor(i/8)+1)+' 组'}));const entries:Entry[]=[];
 students.forEach((s,i)=>{const plus=i>=35?0:Math.max(0,12-Math.floor(i/3)),minus=i>=35?i-33:i%3;
  for(let j=0;j<plus;j++)entries.push({id:`d-${i}-p-${j}`,batchId:`demo-p-${i}-${j}`,studentId:s.id,title:j%2?'主动举手回答问题':'早读认真',category:j%2?'上课':'早读',points:1,date:today,createdAt:today+`T0${j%8}:15:00.000Z`,operator:'林同学',voidedAt:null});
  for(let j=0;j<minus;j++)entries.push({id:`d-${i}-m-${j}`,batchId:`demo-m-${i}-${j}`,studentId:s.id,title:'未按时交作业',category:'作业',points:-1,date:today,createdAt:today+`T0${j%8}:20:00.000Z`,operator:'林同学',voidedAt:null});
 });return {name:'五年级（2）班',students,entries,demo:true,role:'owner',operator:'林同学'};
}
