import { useCallback, useEffect, useRef, useState } from 'react';
import type { Choice, Session } from '../shared/contracts';
import { api, RequestError } from './api';
import { draftSchema } from '../shared/contracts';
import { z } from 'zod';
export type LocalDraft = Pick<Session,'choices'|'cursor'|'scroll'|'elapsed_ms'> & { paused:boolean };
export type SaveState = 'saved'|'saving'|'failed'|'conflict';
type Stored = { revision:number; draft:LocalDraft; dirty:boolean; token?:string };
export const storageKey=(uid:string,sid:string)=>`cet6:draft:${uid}:${sid}`;
export function useDraft(initial:Session,uid:string,enabled=true) {
  const active=useRef(enabled);active.current=enabled;
  const key=storageKey(uid,initial.id);
  const base:LocalDraft={choices:initial.choices,cursor:initial.cursor,scroll:initial.scroll,elapsed_ms:initial.elapsed_ms,paused:initial.status==='paused'};
  const stored=useRef<Stored|null>(null);
  if(!stored.current) { try {
    const parsed=z.object({revision:z.number().int().nonnegative(),draft:draftSchema.omit({revision:true}),dirty:z.boolean(),token:z.uuid().optional()}).safeParse(JSON.parse(localStorage.getItem(key)??'null'));
    stored.current=parsed.success?parsed.data:null;
  } catch {/* corrupted storage is ignored */} }
  const valid=stored.current!==null;
  const [draft,setDraft]=useState<LocalDraft>(()=>valid && stored.current!.dirty ? stored.current!.draft : base);
  const [state,setState]=useState<SaveState>(()=>valid && stored.current!.dirty ? (stored.current!.revision===initial.revision?'saving':'conflict'):'saved');
  const current=useRef(draft); const revision=useRef(initial.revision); const dirty=useRef(Boolean(valid && stored.current!.dirty));
  const generation=useRef(0); const saving=useRef<Promise<void>|null>(null); const blocked=useRef(state==='conflict'); const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const submitToken=useRef(stored.current?.token); const mounted=useRef(true); const clockPaused=useRef(false);
  const persist=useCallback(()=>{
    try { localStorage.setItem(key,JSON.stringify({revision:revision.current,draft:current.current,dirty:dirty.current,token:submitToken.current})); }
    catch { if(mounted.current) setState('failed'); }
  },[key]);
  const flush=useCallback(async():Promise<void>=>{
    if(!active.current) return;
    if(saving.current) { await saving.current; if(dirty.current) return flush(); return; }
    if(blocked.current) throw new RequestError(409,'REVISION_CONFLICT');
    if(!dirty.current) return;
    const sent=structuredClone(current.current); const sentGeneration=generation.current; const expected=revision.current;
    setState('saving');
    const work=(async()=>{
      try {
        const response=await api<Session>(`/sessions/${initial.id}`,'PATCH',{...sent,revision:expected});
        revision.current=response.revision;
        dirty.current=generation.current!==sentGeneration; persist();
        if(mounted.current) setState(dirty.current?'saving':'saved');
      } catch(error) {
        if(error instanceof RequestError && error.code==='REVISION_CONFLICT') blocked.current=true;
        if(mounted.current) setState(blocked.current?'conflict':'failed'); persist(); throw error;
      }
    })();
    saving.current=work;
    try { await work; } finally { saving.current=null; }
  },[initial.id,persist]);
  const update=useCallback((change:(d:LocalDraft)=>LocalDraft,schedule=true)=>{
    current.current=change(current.current); generation.current++; dirty.current=true; setDraft(current.current); persist();
    if(schedule && !blocked.current) {
      setState('saving'); if(timer.current) clearTimeout(timer.current);
      timer.current=setTimeout(()=>{ void flush().catch(()=>{}); },650);
    }
  },[flush,persist]);
  useEffect(()=>{
    mounted.current=true;
    const online=()=>{ if(!blocked.current) void flush().catch(()=>{}); };
    const visibility=()=>{ if(document.hidden) void flush().catch(()=>{}); };
    const interval=setInterval(()=>{ if(dirty.current && !blocked.current && !current.current.paused) void flush().catch(()=>{}); },10000);
    window.addEventListener('online',online); document.addEventListener('visibilitychange',visibility);
    if(dirty.current && !blocked.current) void flush().catch(()=>{});
    return()=>{ mounted.current=false; if(timer.current) clearTimeout(timer.current); clearInterval(interval); window.removeEventListener('online',online);document.removeEventListener('visibilitychange',visibility); };
  },[flush]);
  useEffect(()=>{
    let last=performance.now();
    const timer=setInterval(()=>{
      const now=performance.now(); const delta=Math.min(2000,Math.round(now-last)); last=now;
      if(!active.current || document.hidden || current.current.paused || clockPaused.current) return;
      update(d=>{ const qid=initial.question_ids[d.cursor]; const choice=d.choices[qid]??{answer:null,uncertain:false,duration_ms:0}; return {...d,elapsed_ms:d.elapsed_ms+delta,choices:{...d.choices,[qid]:{...choice,duration_ms:choice.duration_ms+delta}}}; },false);
    },1000);
    return()=>clearInterval(timer);
  },[initial.question_ids,update]);
  const resolveConflict=async(keepLocal:boolean)=>{
    const server=await api<Session>(`/sessions/${initial.id}`); if(server.status==='submitted') throw new RequestError(409,'ALREADY_SUBMITTED');
    revision.current=server.revision; blocked.current=false;
    if(!keepLocal) { current.current={choices:server.choices,cursor:server.cursor,scroll:server.scroll,elapsed_ms:server.elapsed_ms,paused:server.status==='paused'};dirty.current=false;setDraft(current.current);setState('saved');persist(); }
    else { current.current.elapsed_ms=Math.max(server.elapsed_ms,current.current.elapsed_ms); for(const [id,choice] of Object.entries(current.current.choices)) choice.duration_ms=Math.max(choice.duration_ms,server.choices[id]?.duration_ms??0); dirty.current=true;generation.current++;persist();await flush(); }
  };
  const submit=async()=>{
    clockPaused.current=true;
    try {
      await flush(); while(dirty.current) await flush();
      submitToken.current??=crypto.randomUUID(); persist();
      await api(`/sessions/${initial.id}/submit`,'POST',{submission_id:submitToken.current,revision:revision.current});
      localStorage.removeItem(key);
    } finally { clockPaused.current=false; }
  };
  const answer=(qid:string,answer:string|null)=>update(d=>({ ...d,choices:{...d.choices,[qid]:{...(d.choices[qid]??{uncertain:false,duration_ms:0}),answer}} }));
  const uncertain=(qid:string)=>update(d=>({ ...d,choices:{...d.choices,[qid]:{...(d.choices[qid]??{answer:null,duration_ms:0}),uncertain:!d.choices[qid]?.uncertain}} }));
  return {draft,state,update,flush,answer,uncertain,resolveConflict,submit};
}
