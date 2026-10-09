import { beforeAll, afterAll, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { validateKy1Bank } from '../scripts/ky1-bank';
import { isEligible } from '../shared/contracts';
import { testDatabase, importFixture } from './database';
import { Repository } from '../worker/repository';
const root=process.env.KY1_BANK_PATH??'C:/Users/16648/WorkBuddy/2026-10-08-21-27-31';
const present=existsSync(root+'/data/markdown/KY1_manifest.json');
it.skipIf(!present)('validates and imports all real KY1 data, grades objective questions and freezes analyses',async()=>{
  const bank=await validateKy1Bank(root);expect(bank.errors).toEqual([]);expect(bank.coverage.source_questions).toBe(884);expect(bank.coverage.source_verified_answers).toBe(765);expect(bank.coverage.analysis_blocks).toBe(3163);expect(bank.groups).toHaveLength(153);expect(bank.groups.filter(isEligible)).toHaveLength(102);
  const data=await testDatabase();try{
    for(const group of bank.groups)await importFixture(data.db,group);
    const repo=new Repository(data.db);const user=await repo.user({identity:'ky1-test',email:'ky1@example.invalid'});
    const library=await repo.library();expect(library.filter(g=>g.exam==='KY1')).toHaveLength(153);
    const objective=bank.groups.find(g=>g.id==='ky1-2024-cloze-a-01')!;
    const session=await repo.start(user.id,objective.id,'new');expect(JSON.stringify(session)).not.toContain('correct_answer');expect(JSON.stringify(session)).not.toContain('analysis');
    const choices=Object.fromEntries(objective.answers.map(a=>[a.question_id,{answer:a.correct_answer,uncertain:false,duration_ms:10}]));
    const saved=await repo.save(user.id,session.id,{revision:session.revision,choices,cursor:0,scroll:0,elapsed_ms:200,paused:false});
    await repo.submit(user.id,saved.id,crypto.randomUUID(),saved.revision);const result=await repo.result(user.id,saved.id);expect(result.score).toBe(20);expect(result.total).toBe(20);expect(result.attempts.every(a=>a.explanation?.analysis)).toBe(true);
    const writing=bank.groups.find(g=>g.id==='ky1-2024-writing-a-01')!;const preview=await repo.preview(writing.id);expect(preview.eligible).toBe(false);expect(preview.analyses['ky1-2024-q51']).toBeTruthy();await expect(repo.start(user.id,writing.id,'new')).rejects.toThrow('GROUP_NOT_VERIFIED');
    await importFixture(data.db,objective);expect((await repo.result(user.id,session.id)).attempts).toEqual(result.attempts);
    const counts=await data.db.query(sql`select count(*)::int n from explanations where question_id like 'ky1-%' and verification_status='verified'`);expect(counts[0].n).toBe(884);
  }finally{await data.pg.close();}
},60000);
