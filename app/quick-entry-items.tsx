'use client';

import { ArrowUpRight, Minus, Plus, Pencil, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { signed, type Rule } from '@/lib/classroom';

export type DraftItem = { key: string; rule: Rule; quantity: string };
export function draftKey(rule: Rule) {
 return JSON.stringify(rule.id === 'custom' ? [rule.id, rule.category, rule.title, rule.points] : [rule.id]);
}

type Props = {
 rules: Rule[];
 items: DraftItem[];
 onChange: (items: DraftItem[]) => void;
 onBrowse: () => void;
 onEdit: (key: string) => void;
};

export default function QuickEntryItems({rules, items, onChange, onBrowse, onEdit}: Props) {
 function toggleRule(rule: Rule) {
  const key = draftKey(rule);
  onChange(items.some(item => item.key === key)
   ? items.filter(item => item.key !== key)
   : [...items, {key, rule, quantity: '1'}]);
 }
 function changeQuantity(key: string, quantity: string) {
  onChange(items.map(item => item.key === key ? {...item, quantity} : item));
 }
 return <>
  <div className="step-heading second">
   <h3><b>02</b>选择加减分事项</h3>
   <button className="text-button" onClick={onBrowse}>全部公约 <ArrowUpRight size={14}/></button>
  </div>
  <div className="rule-grid">
   {rules.slice(0, 4).map(rule => {
    const selected = items.some(item => item.key === draftKey(rule));
    return <button key={rule.id} className={`rule ${selected ? 'selected' : ''}`} aria-pressed={selected} disabled={!selected&&items.length>=50} onClick={() => toggleRule(rule)}>
     <span>{rule.title}</span><strong className={rule.points > 0 ? 'positive' : 'negative'}>{signed(rule.points)}</strong>
    </button>;
   })}
  </div>
  <div className="draft-heading"><h4>待提交事项 <span>{items.length}</span></h4>{items.length > 0 && <button className="text-button" onClick={() => onChange([])}>清空事项</button>}</div>
  <p className="draft-hint">可选多项；每项次数会应用于所有已选同学。</p>
  {items.length === 0 ? <div className="draft-empty">点选上方事项，或从全部公约中添加。</div> : <div className="draft-items">
   {items.map(item => {
    const quantity = Number(item.quantity);
    const valid = /^\d+$/.test(item.quantity) && quantity >= 1 && quantity <= 100;
    return <div className="draft-item" key={item.key}>
     <div className="draft-item-heading"><div><small>{item.rule.category}</small><strong>{item.rule.title}</strong></div><div className="draft-item-actions">
      <button className="text-button" aria-label={`修改${item.rule.title}`} onClick={() => onEdit(item.key)}><Pencil size={14}/>修改</button>
      <button className="draft-remove" aria-label={`移除${item.rule.title}`} onClick={() => onChange(items.filter(row => row.key !== item.key))}><X size={16}/></button>
     </div></div>
     <div className="draft-calculation">
      <span className="draft-unit">每次 <b className={item.rule.points > 0 ? 'positive' : 'negative'}>{signed(item.rule.points)} 分</b></span>
      <div className="quantity-control">
       <button aria-label={`减少${item.rule.title}次数`} disabled={!valid || quantity <= 1} onClick={() => changeQuantity(item.key, String(quantity - 1))}><Minus size={15}/></button>
       <Input aria-label={`${item.rule.title}次数`} type="number" inputMode="numeric" min={1} max={100} step={1} value={item.quantity} aria-invalid={!valid} onChange={event => changeQuantity(item.key, event.target.value)}/>
       <button aria-label={`增加${item.rule.title}次数`} disabled={!valid || quantity >= 100} onClick={() => changeQuantity(item.key, String(quantity + 1))}><Plus size={15}/></button>
       <span>次</span>
      </div>
      <strong className={`draft-subtotal ${item.rule.points > 0 ? 'positive' : 'negative'}`}>{valid ? `= ${signed(item.rule.points * quantity)} 分` : '次数待填写'}</strong>
     </div>
     {!valid && <p className="quantity-error" role="alert">请填写 1–100 的整数次数。</p>}
    </div>;
   })}
  </div>}
 </>;
}
