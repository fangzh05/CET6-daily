import { memo, useEffect, useRef, type CSSProperties } from 'react';
import { AnnotationSurface } from './AnnotationSurface';
import type { NoteRange } from '../useReadingNotes';
import type { Highlight } from './state';
type Paragraph={id:string;text:string;label:string};
export type Evidence={paragraphId:string;text:string};
type Selection={ranges:{paragraphId:string;start:number;end:number}[];text:string;x:number;y:number};
type Props={language?:string;title:string;subtitle:string;sourceLabel:string;paragraphs:Paragraph[];highlights:Highlight[];onHighlights:(h:Highlight[])=>void|Promise<void>;onSaveNote?:(ranges:NoteRange[],note:string)=>Promise<void>;evidence:Evidence|null;evidenceTick:number;initialScroll:number;onScroll:(y:number)=>void;fontSize:number;onFont:(size:number)=>void;onMessage:(text:string)=>void};
export const PassageReader=memo(function PassageReader({language='en',title,subtitle,sourceLabel,paragraphs,highlights,onHighlights,onSaveNote,evidence,evidenceTick,initialScroll,onScroll,fontSize,onFont,onMessage}:Props){
  const reader=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(reader.current)reader.current.scrollTop=initialScroll;},[]);
  useEffect(()=>{if(!evidence)return;requestAnimationFrame(()=>{const p=reader.current?.querySelector<HTMLElement>(`[data-paragraph="${evidence.paragraphId}"]`);if(p&&reader.current)reader.current.scrollTo({top:p.getBoundingClientRect().top-reader.current.getBoundingClientRect().top+reader.current.scrollTop-32,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});},[evidence,evidenceTick]);
  const render=(p:Paragraph)=>{const personal=highlights.filter(h=>h.paragraphId===p.id);const at=evidence?.paragraphId===p.id?p.text.indexOf(evidence.text):-1;const cuts=new Set([0,p.text.length]);personal.forEach(h=>{cuts.add(h.start);cuts.add(h.end);});if(at>=0&&evidence){cuts.add(at);cuts.add(at+evidence.text.length);}const positions=[...cuts].sort((a,b)=>a-b);return positions.slice(0,-1).map((start,i)=>{const end=positions[i+1];const user=personal.some(h=>h.start<end&&h.end>start);const ev=at>=0&&!!evidence&&start<at+evidence.text.length&&end>at;return <span key={start} className={`${user?'personal-highlight':''} ${ev?'evidence-highlight':''}`}>{p.text.slice(start,end)}</span>;});};
  return <AnnotationSurface highlights={highlights} onHighlights={onHighlights} onSaveNote={onSaveNote} onMessage={onMessage}><section className="rp-passage" aria-label="文章阅读区"><div className="rp-reader-tools"><span>PASSAGE 01 <span className="rp-dot">·</span> {sourceLabel}</span><div><button aria-label="缩小字号" disabled={fontSize<=17} onClick={()=>onFont(fontSize-1)}>A−</button><button aria-label="放大字号" disabled={fontSize>=26} onClick={()=>onFont(fontSize+1)}>A+</button></div></div>
    <div ref={reader} className="rp-reader-scroll" tabIndex={0} aria-label="阅读正文" onScroll={e=>{onScroll(e.currentTarget.scrollTop);}} style={{'--reading-size':`${fontSize}px`} as CSSProperties}>
      <article lang={language}><p className="rp-eyebrow">{subtitle} <span> / </span> {Math.ceil(paragraphs.reduce((n,p)=>n+p.text.split(/\s+/).length,0)/100)} MIN READ</p><h1>{title}</h1>{sourceLabel==='原创练习'&&<p className="rp-deck">A place to pause can change the way we move through a neighbourhood.</p>}<div className="rp-article-rule"/>
        {paragraphs.map(p=><div className={`rp-paragraph ${evidence?.paragraphId===p.id?'is-evidence':''}`} key={p.id}><span className="rp-paragraph-number" aria-hidden="true">{p.label}</span><p data-paragraph={p.id}>{render(p)}</p></div>)}
        <footer className="rp-source">END OF PASSAGE <p>{sourceLabel==='原创练习'?'原创交互测试材料 · 非六级真题':'正式会话快照 · 题库内容保持原样'}<br/>选取原文可高亮、移除标注或复制。</p></footer>
      </article>
    </div>

  </section></AnnotationSurface>;
});
