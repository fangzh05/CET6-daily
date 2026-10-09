import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, PublicGroup } from '../shared/contracts';
import { api, friendly } from './api';
import type { Highlight } from './reading/state';
export type NoteRange={paragraphId:string;start:number;end:number};
export function noteHighlights(notes:Annotation[],group:PublicGroup):Highlight[] {
  return notes.flatMap(n=>{const p=group.passage.paragraphs.find(p=>p.id===n.paragraph_id);const start=p?.text.indexOf(n.selected_text)??-1;return start<0?[]:[{id:n.id,paragraphId:n.paragraph_id,start,end:start+n.selected_text.length}];});
}
export function useReadingNotes(group:PublicGroup,legacyKey?:string) {
  const [notes,setNotes]=useState<Annotation[]>([]);const [error,setError]=useState('');const [loaded,setLoaded]=useState(false);const current=useRef(notes);current.current=notes;
  const load=useCallback(async()=>{setError('');try{const rows=await api<Annotation[]>(`/annotations?passage_id=${encodeURIComponent(group.passage.id)}`);setNotes(rows);current.current=rows;setLoaded(true);return rows;}catch(e){setError(friendly(e));throw e;}},[group.passage.id]);
  const save=useCallback(async(ranges:NoteRange[],note='',kind:'note'|'sentence'='note')=>{
    for(const range of ranges){const p=group.passage.paragraphs.find(p=>p.id===range.paragraphId);if(!p||range.start<0||range.end>p.text.length||range.start>=range.end)continue;const selected_text=p.text.slice(range.start,range.end);
      const existing=current.current.find(n=>n.paragraph_id===p.id&&n.selected_text===selected_text&&n.note===note&&n.kind===kind);if(existing)continue;
      const created=await api<{id:string;created_at:string}>('/annotations','POST',{passage_id:group.passage.id,paragraph_id:p.id,selected_text,note,kind});
      const row:Annotation={...created,passage_id:group.passage.id,paragraph_id:p.id,selected_text,note,kind};current.current=[row,...current.current];setNotes(current.current);
    }
    setError('');
  },[group]);
  useEffect(()=>{let active=true;void load().then(async rows=>{
    if(!active||!legacyKey)return;
    // Recover earlier local-only highlights into the existing cloud notes table.
    let legacy:{readingHighlights?:NoteRange[]};try{legacy=JSON.parse(localStorage.getItem(legacyKey)??'{}');}catch{return;}
    for(const range of legacy.readingHighlights??[]){if(!active)break;const p=group.passage.paragraphs.find(p=>p.id===range.paragraphId);if(p&&!rows.some(n=>n.paragraph_id===p.id&&n.selected_text===p.text.slice(range.start,range.end)))await save([range]);}
  }).catch(e=>{if(active)setError(friendly(e));});return()=>{active=false;};},[load,legacyKey,save,group]);
  const remove=async(ids:string[])=>{for(const id of ids){await api(`/annotations/${encodeURIComponent(id)}`,'DELETE');current.current=current.current.filter(n=>n.id!==id);setNotes(current.current);}};
  return {notes,highlights:noteHighlights(notes,group),save,remove,load,error,loaded};
}
