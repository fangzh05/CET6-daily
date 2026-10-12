import type { PublicGroup } from './contracts';
export const questionTextId=(id:string)=>`question:${id}:stem`;
export const optionTextId=(id:string,key:string)=>`question:${id}:option:${key}`;
export function annotationTexts(group:PublicGroup){return [...group.passage.paragraphs,...group.questions.flatMap(q=>[{id:questionTextId(q.id),text:q.stem},...q.options.map(o=>({id:optionTextId(q.id,o.key),text:o.text}))])];}
