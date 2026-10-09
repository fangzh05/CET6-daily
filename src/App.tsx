import { lazy, Suspense, useEffect, useState } from 'react';
import type { Annotation, Dashboard, Session, Stats, Result } from '../shared/contracts';
import { api, friendly, RequestError } from './api';
import { Reader } from './Reader';
import { StatsView } from './StatsView';
import { Library } from './Library';
import { readTheme, saveTheme } from './theme';
import './home.css';
const FormalReadingSession=lazy(()=>import('./reading/FormalReading').then(m=>({default:m.FormalReadingSession})));
const kindNames={careful:'仔细阅读',matching:'长篇匹配',cloze:'选词填空'};
const pct=(correct:number,count:number)=>count?`${Math.round(correct/count*100)}%`:'—';
export function App() {
  const [theme,setTheme]=useState(readTheme);
  const [user,setUser]=useState<{id:string;email:string}|null>(null); const [data,setData]=useState<Dashboard|null>(null);
  const [session,setSession]=useState<Session|null>(null); const [result,setResult]=useState<Result|null>(null); const [tab,setTab]=useState<'today'|'stats'|'notes'|'library'>('today');
  const [stats,setStats]=useState<Stats|null>(null); const [notes,setNotes]=useState<Annotation[]|null>(null);
  const [focusQuestion,setFocusQuestion]=useState<string|undefined>();
  const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const refresh=async()=>{setLoading(true);setError('');try {const u=await api<{id:string;email:string}>('/me');setUser(u);setData(await api<Dashboard>('/dashboard'));}catch(e){setError(friendly(e));}finally{setLoading(false);}};
  const open=async(s:Session,questionId?:string)=>{
    setFocusQuestion(questionId);
    const r=s.status==='submitted'?await api<Result>(`/sessions/${s.id}/result`):null;
    setResult(r);setSession(s);history.replaceState(null,'',`#session=${s.id}`);
  };
  useEffect(()=>{void (async()=>{await refresh();const sid=location.hash.match(/^#session=([a-f0-9-]+)$/)?.[1];if(sid)try{await open(await api<Session>(`/sessions/${sid}`));}catch(e){setError(friendly(e));}})();},[]);
  const start=async(group_id:string,practice_type:'new'|'retry'|'review',question_ids?:string[])=>{setBusy(true);setError('');try{let next:Session;try{next=await api<Session>('/sessions','POST',{group_id,practice_type,...(question_ids?{question_ids}:{})});}catch(e){if(practice_type!=='new'||!(e instanceof RequestError)||e.code!=='ALREADY_PRACTICED')throw e;next=await api<Session>('/sessions','POST',{group_id,practice_type:'retry'});}await open(next);}catch(e){setError(friendly(e));}finally{setBusy(false);}};
  const leave=()=>{setTheme(readTheme());setSession(null);setResult(null);history.replaceState(null,'',location.pathname);void refresh();};
  const navigate=async(t:typeof tab)=>{setTab(t);setError('');try{if(t==='stats')setStats(await api<Stats>('/stats'));if(t==='notes')setNotes(await api('/annotations'));}catch(e){setError(friendly(e));}};
  if(session && user && session.snapshot.kind==='careful')return <Suspense fallback={<p role="status">正在打开阅读工作区…</p>}><FormalReadingSession key={session.id} session={session} initialQuestionId={focusQuestion} uid={user.id} result={result} onLeave={leave} onRetry={()=>start(session.group_id,'retry')}/></Suspense>;
  if(session && user) return <Reader key={session.id} initial={session} initialQuestionId={focusQuestion} uid={user.id} result={result} onLeave={leave} onSubmitted={async()=>{const r=await api<Result>(`/sessions/${session.id}/result`);setResult(r);setSession(r.session);}} onRetry={()=>start(session.group_id,'retry')}/>;
  return <div className="app-shell" data-theme={theme}>
    <header className="topbar"><a className="brand" href="/" aria-label="CET6 Daily 首页">CET6 <span>Daily</span></a><nav aria-label="主导航">{([['today','今日'],['library','题库'],['stats','统计'],['notes','笔记']] as const).map(([key,label])=><button key={key} aria-current={tab===key?'page':undefined} onClick={()=>void navigate(key)}>{label}</button>)}</nav><div className="home-header-actions"><span className="account-label">A LITTLE FOCUS, EVERY DAY.</span><button className="home-theme" aria-label={theme==='light'?'切换深色模式':'切换浅色模式'} onClick={()=>{const next=theme==='light'?'dark':'light';saveTheme(next);setTheme(next);}}>{theme==='light'?'深色':'浅色'}</button></div></header>
    <main className="dashboard">
      {error&&<div className="error" role="alert"><span>{error}</span><button onClick={()=>void refresh()}>重试</button></div>}
      {tab==='today'&&<>
        <div className="page-heading"><div><p className="date-line">{new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'long'}).format(new Date())}</p><p className="home-eyebrow">YOUR DAILY READING</p><h1>今天，读一篇。</h1><p className="muted">留出 10—20 分钟，从完整文章开始。</p></div></div>
        {loading?<div className="empty panel" role="status">正在读取今日学习记录…</div>:<>
          <section className="today-panel panel" aria-label="今日任务"><div className="section-title"><h2>今日任务</h2><label className="goal">每日目标 <select aria-label="每日目标题数" value={data?.daily_goal??5} disabled={!data||busy} onChange={async e=>{setBusy(true);try{await api('/settings','PATCH',{daily_goal:Number(e.target.value)});await refresh();}catch(e){setError(friendly(e));}finally{setBusy(false);}}}>{[5,10,15,20].map(n=><option key={n} value={n}>{n} 题</option>)}</select></label></div>
            <div className="task-metrics"><div><strong>{data?data.remaining:'—'}</strong><span>待完成新题</span></div><div><strong>{data?data.due.length:'—'}</strong><span>到期复习</span></div><div><strong>{data?Math.round(data.stats.week_ms/60000):'—'}<small> 分钟</small></strong><span>本周学习</span></div></div>
            {!!data?.active.length&&<div className="resume-row"><div><span className="dot"/><strong>继续上次阅读</strong><p>{data.active[0].snapshot.title} · 已选择 {Object.values(data.active[0].choices).filter(c=>c.answer).length}/{data.active[0].question_ids.length} 题</p></div><button className="secondary" disabled={busy} onClick={()=>void open(data.active[0]).catch(e=>setError(friendly(e)))}>继续练习 →</button></div>}
            {data?.recommendations.length?data.recommendations.map((g,i)=><div className="reading-task" key={g.id}><div className="task-icon" aria-hidden="true">{String(i+1).padStart(2,'0')}</div><div className="task-description"><p className="task-meta">{g.year} 年 {g.month} 月 · 第 {g.set} 套 · {kindNames[g.kind]}</p><h3>{g.title}</h3><p className="muted">完整文章 · {g.question_count} 题 · 答案已核验</p></div><button className="primary" disabled={busy} onClick={()=>void start(g.id,'new')}>开始阅读 <span>→</span></button></div>):<div className="empty-state"><div className="empty-book" aria-hidden="true">▤</div><h3>{data&&data.remaining===0?'今日新题已完成':'等一篇可靠的真题'}</h3><p>{data&&data.remaining===0?'现在可以复习到期错题，或休息一下。':'题库中暂时没有可推荐的已核验文章。导入后，今日阅读会出现在这里。'}</p><span className="quiet-label">不完整或待核验题组不会参与评分</span><button className="secondary" onClick={()=>void navigate('library')}>浏览真题库 →</button></div>}
          </section>
          {!!data?.due.length&&<section className="panel review-panel"><div className="section-title"><h2>到期复习</h2><span className="muted">保留原文上下文</span></div>{[...new Set(data.due.map(r=>r.group_id))].map(gid=><div className="review-row" key={gid}><div><strong>{data.due.find(r=>r.group_id===gid)?.title}</strong><p className="muted">{data.due.filter(r=>r.group_id===gid).length} 道到期题目</p></div><button className="secondary" disabled={busy} onClick={()=>void start(gid,'review',data.due.filter(r=>r.group_id===gid).map(r=>r.question_id))}>复习 →</button></div>)}</section>}
          <section className="overview"><div className="section-title"><h2>最近的积累</h2><button className="text-button" onClick={()=>void navigate('stats')}>查看统计 →</button></div><div className="overview-grid"><div><p className="muted">最近 7 天 · 首次正确率</p><strong>{data?pct(data.stats.first_correct,data.stats.first_count):'—'}</strong><p className="caption">{data?.stats.first_count?`${data.stats.first_correct} / ${data.stats.first_count} 题答对`:'完成首次练习后开始记录'}</p></div><div><p className="muted">本周完成题数</p><strong>{data?.stats.week_count??'—'}</strong><p className="caption">新题、重做与复习均计入题数</p></div><div><p className="muted">阅读题型表现</p>{data?.stats.by_kind.length?data.stats.by_kind.map(k=><p key={k.kind}>{kindNames[k.kind]} <strong className="small-stat">{pct(k.correct,k.count)}</strong></p>):<><strong>—</strong><p className="caption">从第一篇阅读开始</p></>}</div></div></section>
        </>}
        <p className="footer-note">以真实作答为起点，以原文证据为依据。</p>
      </>}
      {tab==='library'&&<Library busy={busy} onStart={id=>void start(id,'new')}/>}
      {tab==='stats'&&(stats?<StatsView stats={stats} onOpen={async(sid,qid)=>{setError('');try{await open(await api<Session>(`/sessions/${sid}`),qid);}catch(e){setError(friendly(e));}}}/>:<div className="empty" role="status">正在读取统计…</div>)}
      {tab==='notes'&&<><h1>阅读笔记</h1><p className="muted">留下值得再读的词句。</p>{notes?.length?notes.map(n=><article className="panel note" key={n.id}><blockquote>{n.selected_text}</blockquote>{n.note&&<p>{n.note}</p>}<small>{n.title&&<>{n.title} · </>}{n.kind==='sentence'?'难句':n.note?'笔记':'高亮摘录'} · {new Date(n.created_at).toLocaleDateString('zh-CN')}</small></article>):<div className="empty panel">尚无笔记。阅读时选择原文，点击“高亮”或“写笔记”即可保存。</div>}</>}
    </main><footer className="site-footer"><span>CET6 Daily</span><span>{user?'学习进度已同步':'登录后同步学习进度'}</span></footer>
  </div>;
}
