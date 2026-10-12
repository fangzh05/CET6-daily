import { useEffect, useRef, useState } from 'react';
import { kindNames, paperLabel } from '../../shared/contracts';
import type { Result, Session } from '../../shared/contracts';
import { api, friendly } from '../api';
import { useReadingNotes } from '../useReadingNotes';
import { useDraft } from '../useDraft';
import { ReadingWorkspace, type ReadingConnection } from './ReadingPlayground';

// Shared CET6, KY1 careful-reading and JLPT single-choice workspace.
export default function FormalReading({sessionId}:{sessionId:string}){
  const [loaded,setLoaded]=useState<{session:Session;uid:string;result:Result|null}|null>(null);const [error,setError]=useState('');
  useEffect(()=>{let active=true;void(async()=>{try{const user=await api<{id:string}>('/me');const session=await api<Session>(`/sessions/${encodeURIComponent(sessionId)}`);if(!['careful','jlpt_reading','jlpt_vocab','jlpt_grammar'].includes(session.snapshot.kind))throw new Error('此题型请从首页进入正式练习。');const result=session.status==='submitted'?await api<Result>(`/sessions/${session.id}/result`):null;if(active)setLoaded({session,uid:user.id,result});}catch(e){if(active)setError(friendly(e));}})();return()=>{active=false;};},[sessionId]);
  if(error)return <main className="dashboard"><p role="alert">{error}</p><a href="/">返回正式练习</a></main>;
  if(!loaded)return <p role="status">正在读取正式练习会话…</p>;
  return <FormalReadingSession key={loaded.session.id} {...loaded}/>;
}
export function FormalReadingSession({session,uid,result:initialResult,onLeave,onRetry,initialQuestionId}:{session:Session;uid:string;result:Result|null;initialQuestionId?:string;onLeave?:()=>void;onRetry?:()=>Promise<void>}){
  const [result,setResult]=useState(initialResult);const draft=useDraft(session,uid,!result);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [reviewCursor,setReviewCursor]=useState(()=>Math.max(0,session.question_ids.indexOf(initialQuestionId??'')));
  // Opening from home is an explicit resume action. Only resume on mount,
  // so the save-and-leave operation can still pause the draft normally.
  useEffect(()=>{if(onLeave&&!initialResult&&draft.draft.paused&&draft.state!=='conflict')draft.update(s=>({...s,paused:false}));},[]);
  const group=session.snapshot;const notes=useReadingNotes(group,`cet6:reading-ui:${uid}:${session.id}`);const questions=group.questions.filter(q=>session.question_ids.includes(q.id));
  const practiceHighlights=useRef<import('./state').Highlight[]>(undefined);
  if(practiceHighlights.current===undefined){try{practiceHighlights.current=JSON.parse(localStorage.getItem(`cet6:reading-ui:${uid}:${session.id}`)??'{}').readingHighlights??[];}catch{practiceHighlights.current=[];}}
  const reviews=result?result.attempts.map(a=>({questionId:a.question_id,correctOptionId:a.correct_answer as 'A'|'B'|'C'|'D',evidence:a.explanation?.evidence.map(e=>({paragraphId:e.paragraph_id,text:e.text}))??[],analysis:a.explanation?.analysis,explanation:a.explanation?.explanation??'当前题目解析待核验。',distractorExplanations:a.explanation?.distractor_explanations??{}})):null;
  const label={saved:'云端已保存',saving:'正在保存草稿',failed:'云端保存失败 · 本机保留',conflict:'草稿冲突 · 请先处理'}[draft.state];
  const connection:ReadingConnection={canViewNotes:!!result,notes:result?notes.notes:[],noteError:notes.error,onNotesRetry:()=>notes.load().then(()=>{}),highlights:result?notes.highlights:undefined,
    onHighlights:async highlights=>{if(!result){const removed=(practiceHighlights.current??[]).filter(h=>!highlights.some(p=>p.paragraphId===h.paragraphId&&p.start===h.start&&p.end===h.end));await notes.save(highlights);await notes.remove(notes.highlights.filter(h=>removed.some(p=>p.paragraphId===h.paragraphId&&p.start===h.start&&p.end===h.end)).map(h=>h.id));practiceHighlights.current=highlights;return;}const previous=notes.highlights;await notes.save(highlights.filter(h=>!previous.some(p=>p.id===h.id)));await notes.remove(previous.filter(h=>!highlights.some(p=>p.id===h.id)).map(h=>h.id));},onSaveNote:async(ranges,note)=>{await notes.save(ranges,note);if(!result)practiceHighlights.current=[...(practiceHighlights.current??[]),...ranges.map(r=>({...r,id:crypto.randomUUID()}))];},practiceLabel:session.practice_type==='retry'?'重新练习':'正式练习',
    data:{id:group.passage.id,title:group.title,subtitle:paperLabel(group.paper)+' · '+kindNames[group.kind],questionOnly:['jlpt_vocab','jlpt_grammar'].includes(group.kind),language:group.paper.exam==='JLPT_N1'?'ja':'en',paragraphs:group.passage.paragraphs,questions},storageKey:`cet6:reading-ui:${uid}:${session.id}`,
    answers:Object.fromEntries(Object.entries(result?result.session.choices:draft.draft.choices).filter(([,c])=>c.answer).map(([id,c])=>[id,c.answer!])),flags:Object.entries(result?result.session.choices:draft.draft.choices).filter(([,c])=>c.uncertain).map(([id])=>id),cursor:result?reviewCursor:draft.draft.cursor,scroll:draft.draft.scroll,reviews,saveLabel:result?'正式成绩已保存':(session.practice_type==='retry'?'重新练习 · ':'')+label,blocked:busy||!!result||draft.state==='conflict'||draft.draft.paused,
    onAnswer:(id,key)=>{if(!result&&!busy)draft.answer(id,key);},onFlag:id=>{if(!result&&!busy)draft.uncertain(id);},onMove:cursor=>{if(result)setReviewCursor(cursor);else draft.update(s=>({...s,cursor}));},onScroll:scroll=>{if(!result)draft.update(s=>({...s,scroll}));},
    submit:async()=>{setBusy(true);setError('');try{await draft.submit();setResult(await api<Result>(`/sessions/${session.id}/result`));}catch(e){throw new Error(friendly(e));}finally{setBusy(false);}},
    leave:async()=>{if(busy)return;setBusy(true);try{if(!result){draft.update(s=>({...s,paused:true}));await draft.flush();}if(onLeave)onLeave();else location.assign('/');}finally{setBusy(false);}},
    retry:async()=>{if(busy)return;setBusy(true);try{if(onRetry){await onRetry();return;}const next=await api<Session>('/sessions','POST',{group_id:session.group_id,practice_type:'retry'});location.assign(`/reading/${next.id}`);}finally{setBusy(false);}}
  };
  return <>{!result&&(draft.draft.paused||draft.state==='conflict'||draft.state==='failed')&&<aside className="rp-connection-notice" role="status">{draft.draft.paused?<button onClick={()=>draft.update(s=>({...s,paused:false}))}>继续已暂停的练习</button>:draft.state==='conflict'?<><span>云端草稿存在更新：</span><button onClick={()=>void draft.resolveConflict(false).catch(e=>setError(friendly(e)))}>使用云端草稿</button><button onClick={()=>void draft.resolveConflict(true).catch(e=>setError(friendly(e)))}>保留本机草稿</button></>:<button onClick={()=>void draft.flush().catch(e=>setError(friendly(e)))}>重试云端保存</button>}{error&&<span role="alert">{error}</span>}</aside>}<ReadingWorkspace connection={connection}/></>;
}
