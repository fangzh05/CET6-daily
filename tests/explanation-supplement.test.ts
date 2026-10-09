import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase, importFixture } from './database';
import { fixture } from './fixture';
import { Repository } from '../worker/repository';
let data:Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async()=>{data=await testDatabase();});
afterAll(async()=>{await data.pg.close();});
it('supplements missing old-session explanations only when frozen content and grading match',async()=>{
  const bank=fixture('careful','supplement');const missing={...bank,explanations:[]};await importFixture(data.db,missing);
  const repo=new Repository(data.db);const user=await repo.user({identity:'test:supplement',email:'test@example.invalid'});
  const session=await repo.start(user.id,bank.id,'new');
  await expect(repo.result(user.id,session.id)).rejects.toThrow('RESULT_NOT_SUBMITTED');
  await repo.submit(user.id,session.id,crypto.randomUUID(),session.revision);
  const before=await data.pg.query('select * from practice_sessions where id=$1',[session.id]);
  const attempts=await data.pg.query('select * from attempts where session_id=$1 order by question_id',[session.id]);
  expect((await repo.result(user.id,session.id)).attempts.every(a=>!a.explanation)).toBe(true);
  await importFixture(data.db,bank);
  expect((await repo.result(user.id,session.id)).attempts[0].explanation?.explanation).toBe(bank.explanations[0].explanation);
  await expect(repo.result((await repo.user({identity:'other',email:'other@example.invalid'})).id,session.id)).rejects.toThrow('SESSION_NOT_FOUND');
  const qid=bank.questions[0].id;
  for(const change of [
    "update explanations set verification_status='pending' where question_id=$1",
    "update answer_keys set answer_version='changed' where question_id=$1",
    "update answer_keys set correct_answer='B' where question_id=$1",
    "update questions set stem='changed' where id=$1",
    "update questions set options='[]' where id=$1",
    "update explanations set evidence='[{\"paragraph_id\":\"supplement-p0\",\"text\":\"invented evidence\"}]' where question_id=$1",
  ]){
    await data.pg.query(change,[qid]);expect((await repo.result(user.id,session.id)).attempts.find(a=>a.question_id===qid)?.explanation).toBeNull();await importFixture(data.db,bank);
  }
  await data.pg.query("update passage_paragraphs set text=text||' changed' where id=$1",[bank.passage.paragraphs[0].id]);
  expect((await repo.result(user.id,session.id)).attempts.every(a=>!a.explanation)).toBe(true);await importFixture(data.db,bank);
  expect((await data.pg.query('select * from practice_sessions where id=$1',[session.id])).rows).toEqual(before.rows);
  expect((await data.pg.query('select * from attempts where session_id=$1 order by question_id',[session.id])).rows).toEqual(attempts.rows);
  const frozen=await repo.start(user.id,bank.id,'retry');await repo.submit(user.id,frozen.id,crypto.randomUUID(),frozen.revision);
  await data.pg.query("update explanations set explanation='replacement' where question_id=$1",[qid]);
  expect((await repo.result(user.id,frozen.id)).attempts[0].explanation?.explanation).toBe(bank.explanations[0].explanation);
});
