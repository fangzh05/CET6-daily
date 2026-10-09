import { it, expect } from 'vitest';
import { attachExplanations } from '../scripts/explanations';
import { fixture } from './fixture';
import { testDatabase, importFixture } from './database';
import { explanationValidationSql } from '../scripts/explanation-sql';

it('attaches source analyses with provenance and updates content version without changing answers',()=>{
  const g=fixture();
  const q=g.questions[0];
  const source={group_id:g.id,url:'https://english-exam.lazynote.cn/cet6/sections/2025-12-1/part3-section-c/',sha256:'a'.repeat(64),records:[{...g.explanations[0],stem:q.stem,options:q.options,correct_answer:g.answers[0].correct_answer}]};
  const result=attachExplanations(g,source);
  expect(result.answers).toEqual(g.answers);
  expect(result.version).not.toBe(g.version);
  expect(result.source.explanation_sources?.[0].sha256).toBe(source.sha256);
  expect(()=>attachExplanations(g,{...source,records:[{...source.records[0],correct_answer:'Z'}]})).toThrow('mismatch');
  expect(()=>attachExplanations(g,{...source,records:[{...source.records[0],stem:'Different paper'}]})).toThrow('mismatch');
  expect(()=>attachExplanations(g,{...source,records:[{...source.records[0],evidence:[{paragraph_id:g.passage.paragraphs[0].id,text:'Fabricated quotation'}]}]})).toThrow();
  expect(()=>attachExplanations(g,{...source,records:[source.records[0],source.records[0]]})).toThrow();
});

it('database preflight rejects stale answers, changed options and evidence from another passage',async()=>{
  const {pg,db}=await testDatabase();
  try {
    const g=fixture();await importFixture(db,g);
    const q=g.questions[0];
    const record={...g.explanations[0],group_id:g.id,stem:q.stem,options:q.options,correct_answer:g.answers[0].correct_answer};
    const matched=async(value:unknown)=>(await pg.query(explanationValidationSql,[JSON.stringify([value])])).rows.length;
    expect(await matched(record)).toBe(1);
    expect(await matched({...record,correct_answer:'Z'})).toBe(0);
    expect(await matched({...record,options:[{key:'A',text:'Changed question'}]})).toBe(0);
    expect(await matched({...record,evidence:[{paragraph_id:g.passage.paragraphs[0].id,text:'Invented evidence'}]})).toBe(0);
    expect(await matched({...record,group_id:'other-group'})).toBe(0);
  } finally {await pg.close();}
});
