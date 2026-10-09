import { useEffect, useState } from 'react';
import type { GroupSummary, PublicGroup } from '../shared/contracts';
import { SourceAnalysis } from './SourceAnalysis';
import { api, friendly } from './api';
type Entry=GroupSummary & {eligible:boolean};
const names={careful:'仔细阅读',matching:'匹配 / 新题型',cloze:'选词填空',use_of_english:'完形填空',translation:'翻译',writing:'写作'};
export function Library({onStart,busy=false}:{onStart:(id:string)=>void;busy?:boolean}) {
  const [entries,setEntries]=useState<Entry[]>([]),[group,setGroup]=useState<(PublicGroup & {eligible:boolean;analyses?:Record<string,{analysis:unknown}>})|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[year,setYear]=useState('all'),[kind,setKind]=useState('all'),[exam,setExam]=useState('CET6');
  const [view,setView]=useState<'article'|'questions'>('article');
  useEffect(()=>{let active=true;api<Entry[]>('/library').then(rows=>{if(active)setEntries(rows);}).catch(e=>{if(active)setError(friendly(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  const open=async(id:string)=>{setLoading(true);setError('');try{setGroup(await api(`/library/${encodeURIComponent(id)}`));setView('article');}catch(e){setError(friendly(e));}finally{setLoading(false);}};
  return <section aria-label="真题库"><div className="section-title"><h1>真题库</h1>{group&&<button className="secondary" onClick={()=>setGroup(null)}>返回题库</button>}</div>
    <p className="muted">完整文章与对应题目已开放。待核验内容仅供试阅，不提交、不评分，也不计入学习统计。</p>
    {error&&<div role="alert" className="error">{error}<button onClick={()=>group?void open(group.id):location.reload()}>重试</button></div>}
    {loading&&<p role="status">正在加载题库…</p>}
    {!group&&!loading&&<><div className="library-filters"><label>考试 <select value={exam} onChange={e=>{setExam(e.target.value);setYear("all");setKind("all");}}><option value="CET6">英语六级</option><option value="KY1">考研英语一</option></select></label><label>年份 <select value={year} onChange={e=>setYear(e.target.value)}><option value="all">全部年份</option>{[...new Set(entries.filter(g=>g.exam===exam).map(g=>g.year))].map(y=><option key={y}>{y}</option>)}</select></label><label>题型 <select value={kind} onChange={e=>setKind(e.target.value)}><option value="all">全部题型</option>{Object.entries(names).filter(([k])=>entries.some(g=>g.exam===exam&&g.kind===k)).map(([k,n])=><option key={k} value={k}>{n}</option>)}</select></label><span className="muted">{entries.filter(g=>g.exam===exam&&(year==='all'||String(g.year)===year)&&(kind==='all'||g.kind===kind)).length} 个题组</span></div>
      {entries.filter(g=>g.exam===exam&&(year==='all'||String(g.year)===year)&&(kind==='all'||g.kind===kind)).map(g=><article className="panel reading-task" key={g.id}><div className="task-description"><p className="task-meta">{g.year} 年 {g.exam==='KY1'?'考研英语一':`${g.month} 月 · 第 ${g.set} 套`} · {names[g.kind]}</p><h3>{g.title}</h3><p className="muted">{g.question_count} 题 · {g.eligible?'已开放正式练习':['translation','writing'].includes(g.kind)?'参考学习 · 不评分':'待核验 · 试阅'}</p></div><button className="secondary" onClick={()=>void open(g.id)}>查看文章与题目 →</button></article>)}
      {!entries.length&&<p className="empty panel">题库尚未导入。</p>}</>}
    {group&&!loading&&<><h2>{group.title}</h2><p className="quiet-label">{group.eligible?'可正式练习':['translation','writing'].includes(group.kind)?'参考学习 · 展开查看译文与范文':'待核验 · 暂不评分'}</p>{group.eligible&&<button className="primary" disabled={busy} onClick={()=>onStart(group.id)}>{busy?'正在打开…':'开始正式练习'}</button>}
      <div className="preview-switch"><button aria-pressed={view==='article'} onClick={()=>setView('article')}>文章</button><button aria-pressed={view==='questions'} onClick={()=>setView('questions')}>题目</button></div>
      <div className="preview-layout"><article className="panel preview-article" data-mobile-visible={view==='article'}>{group.passage.paragraphs.map(p=><p key={p.id}><small className="muted">[{p.label}] </small>{p.text.replace(/\{\{(\d+)\}\}/g,'____($1)____')}</p>)}{!!group.passage.word_bank.length&&<div><h3>词库</h3>{group.passage.word_bank.map(w=><p key={w.key}>{w.key}. {w.text}</p>)}</div>}</article>
      <section className="preview-questions" data-mobile-visible={view==='questions'}>{group.questions.map(q=><article className="panel" key={q.id}><h3>{q.number}. {q.stem}</h3>{q.options.map(o=><p key={o.key}>{o.key}. {o.text}</p>)}{group.analyses?.[q.id]&&<details><summary>查看参考解析</summary><SourceAnalysis analysis={group.analyses[q.id].analysis}/></details>}</article>)}</section></div></>}
  </section>;
}
