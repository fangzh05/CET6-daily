import { z } from 'zod';
import { readTheme } from '../theme';
export const highlightSchema=z.object({id:z.string(),paragraphId:z.string(),start:z.number().int().nonnegative(),end:z.number().int().positive()});
export type Highlight=z.infer<typeof highlightSchema>;
export const practiceSchema=z.object({version:z.literal(1),passageId:z.string(),currentQuestionId:z.string(),selectedAnswers:z.record(z.string(),z.string()),flaggedQuestionIds:z.array(z.string()),readerScrollPosition:z.number().nonnegative(),questionScrollPositions:z.record(z.string(),z.number().nonnegative()),drawerState:z.enum(['collapsed','half','full']),readingHighlights:z.array(highlightSchema),practiceStatus:z.enum(['practice','review']),reviewSelection:z.number().int().nonnegative(),split:z.number().min(40).max(65),tabletView:z.enum(['passage','questions']),theme:z.enum(['light','dark']),fontSize:z.number().min(17).max(26)});
export type PracticeState=z.infer<typeof practiceSchema>;
export const prototypeStorageKey='cet6:prototype:reading:quiet-city-v1';
export function initialState(passageId:string,currentQuestionId:string):PracticeState{return {version:1,passageId,currentQuestionId,selectedAnswers:{},flaggedQuestionIds:[],readerScrollPosition:0,questionScrollPositions:{},drawerState:'half',readingHighlights:[],practiceStatus:'practice',reviewSelection:0,split:55,tabletView:'passage',theme:readTheme(),fontSize:19};}
export function restoreState(raw:string|null,base:PracticeState,questions:{id:string;options:{key:string}[]}[],paragraphs:{id:string;text:string}[]):PracticeState {
  try{const s=practiceSchema.parse(JSON.parse(raw??'null'));if(s.passageId!==base.passageId||!questions.some(q=>q.id===s.currentQuestionId))return base;
    if(Object.entries(s.selectedAnswers).some(([id,key])=>!questions.some(q=>q.id===id&&q.options.some(o=>o.key===key))))return base;
    return {...s,flaggedQuestionIds:s.flaggedQuestionIds.filter(id=>questions.some(q=>q.id===id)),readingHighlights:s.readingHighlights.filter(h=>h.start<h.end&&paragraphs.some(p=>p.id===h.paragraphId&&h.end<=p.text.length))};
  }catch{return base;}
}
