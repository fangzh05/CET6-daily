import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { createApp } from '../worker/app';
import { testDatabase, importFixture } from './database';
import { fixture } from './fixture';
import type { Env } from '../worker/auth';
import type { Session, Result, Stats } from '../shared/contracts';
describe('Worker API + real PostgreSQL execution (isolated PGlite test engine)',()=>{
  let data:Awaited<ReturnType<typeof testDatabase>>; let app:ReturnType<typeof createApp>;
  const env={APP_ENV:'development'} as Env;
  const request=async(path:string,method='GET',body?:unknown,user='alice')=>app.request(`http://localhost/api${path}`,{method,headers:{Origin:'http://localhost','Content-Type':'application/json','x-test-user':user},body:body===undefined?undefined:JSON.stringify(body)},env);
  const json=async<T>(path:string,method='GET',body?:unknown,user='alice'):Promise<T>=>{const r=await request(path,method,body,user);expect(r.status,await r.clone().text()).toBeLessThan(300);return r.json() as Promise<T>;};
  beforeAll(async()=>{data=await testDatabase();for(const kind of ['careful','matching','cloze'] as const)await importFixture(data.db,fixture(kind,kind));app=createApp({db:data.db,authenticate:async req=>({identity:`test:${req.headers.get('x-test-user')??'alice'}`,email:'test@example.invalid'})});});
  afterAll(async()=>{await data.pg.close();});
  it('starts with real empty statistics and a complete daily reading group',async()=>{
    const dashboard=await json<{remaining:number;stats:Stats;recommendations:{question_count:number}[]}>('/dashboard');expect(dashboard.remaining).toBe(5);expect(dashboard.stats.first_count).toBe(0);expect(dashboard.recommendations[0].question_count).toBe(5);
  });
  it('never returns grading keys, correct flags, or explanations before submission',async()=>{
    const response=await request('/groups/careful-group');const text=await response.text();expect(text).not.toMatch(/correct_answer|is_correct|grading_snapshot|explanations|explanation_snapshot/);
    const session=await json<Session>('/sessions','POST',{group_id:'careful-group',practice_type:'new'});expect(JSON.stringify(session)).not.toMatch(/correct_answer|grading_snapshot|explanation_snapshot/);
    expect((await request(`/sessions/${session.id}/result`)).status).toBe(409);
  });
  it('drafts survive API reload; stale writes fail; private session access is denied',async()=>{
    const s=await json<Session>('/sessions','POST',{group_id:'careful-group',practice_type:'new'});
    const b={revision:s.revision,choices:{'careful-q1':{answer:'A',uncertain:true,duration_ms:1200}},cursor:1,scroll:123,elapsed_ms:1200,paused:false};
    const saved=await json<Session>(`/sessions/${s.id}`,'PATCH',b);expect(saved.revision).toBe(s.revision+1);
    const reload=await json<Session>(`/sessions/${s.id}`);expect(reload.choices['careful-q1'].answer).toBe('A');expect(reload.scroll).toBe(123);
    expect((await request(`/sessions/${s.id}`,'PATCH',b)).status).toBe(409);
    expect((await request(`/sessions/${s.id}`,'GET',undefined,'bob')).status).toBe(404);
    expect((await request(`/sessions/${s.id}/submit`,'POST',{submission_id:crypto.randomUUID(),revision:saved.revision},'bob')).status).toBe(404);
  });
  it('grades deterministically, persists unanswered/uncertain, idempotency and frozen evidence',async()=>{
    let s=await json<Session>('/sessions','POST',{group_id:'careful-group',practice_type:'new'});
    const choices=Object.fromEntries(s.question_ids.slice(0,4).map((id,i)=>[id,{answer:i===0?'B':'A',uncertain:i===1,duration_ms:1500}]));
    s=await json<Session>(`/sessions/${s.id}`,'PATCH',{revision:s.revision,choices,cursor:0,scroll:100,elapsed_ms:6500,paused:false});
    const token=crypto.randomUUID();const body={submission_id:token,revision:s.revision};
    const one=await json(`/sessions/${s.id}/submit`,'POST',body);expect(await json(`/sessions/${s.id}/submit`,'POST',body)).toEqual(one);
    expect((await request(`/sessions/${s.id}/submit`,'POST',{...body,submission_id:crypto.randomUUID()})).status).toBe(409);
    const r=await json<Result>(`/sessions/${s.id}/result`);expect(r.score).toBe(3);expect(r.total).toBe(5);expect(r.attempts[4].submitted_answer).toBeNull();expect(r.attempts[0].answer_version).toBe('test-key-v1');expect(r.attempts[0].explanation?.evidence[0].text).toContain('Students read');
    const rows=await data.pg.query('select * from review_states');expect(rows.rows.length).toBe(3);
    expect((await request(`/sessions/${s.id}`,'PATCH',{revision:s.revision,choices,cursor:0,scroll:0,elapsed_ms:2500,paused:false})).status).toBe(409);
  });
  it('review keeps full passage context and appends history without replacing first results',async()=>{
    await data.pg.exec("update review_states set review_due_at=now()-interval '1 hour'");
    const due=await json<{question_id:string}[]>('/reviews/due');expect(due.length).toBe(3);
    let s=await json<Session>('/sessions','POST',{group_id:'careful-group',practice_type:'review',question_ids:due.map(q=>q.question_id)});expect(s.snapshot.passage.paragraphs.length).toBe(4);expect(s.question_ids.length).toBe(3);
    s=await json<Session>(`/sessions/${s.id}`,'PATCH',{revision:s.revision,choices:Object.fromEntries(s.question_ids.map(id=>[id,{answer:'A',uncertain:false,duration_ms:1000}])),cursor:0,scroll:0,elapsed_ms:3000,paused:false});
    await json(`/reviews/${s.id}/grade`,'POST',{revision:s.revision,submission_id:crypto.randomUUID()});
    const stats=await json<Stats>('/stats');expect(stats.first_count).toBe(5);expect(stats.first_correct).toBe(3);expect(stats.review_count).toBe(3);expect(stats.review_correct).toBe(3);
    const states=await data.pg.query<{step:number;review_count:number}>('select step,review_count from review_states');expect(states.rows.every(r=>r.step===1&&r.review_count===1)).toBe(true);
    const first=await data.pg.query<{n:number}>("select count(*)::int n from attempts where practice_type='new' and not is_correct");expect(first.rows[0].n).toBe(2);
  });
  it('rolls back every table if an attempt insertion fails midway',async()=>{
    let s=await json<Session>('/sessions','POST',{group_id:'careful-group',practice_type:'retry'});
    s=await json<Session>(`/sessions/${s.id}`,'PATCH',{revision:s.revision,choices:Object.fromEntries(s.question_ids.map(id=>[id,{answer:'B',uncertain:false,duration_ms:100}])),cursor:0,scroll:0,elapsed_ms:500,paused:false});
    await data.pg.exec("CREATE FUNCTION test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.question_id='careful-q3' THEN RAISE EXCEPTION 'INJECTED_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_fail BEFORE INSERT ON attempts FOR EACH ROW EXECUTE FUNCTION test_fail();");
    const before=await data.pg.query('select * from review_states order by question_id');const token=crypto.randomUUID();expect((await request(`/sessions/${s.id}/submit`,'POST',{revision:s.revision,submission_id:token})).status).toBe(503);
    const rows=await data.pg.query<{n:number}>('select count(*)::int n from attempts where session_id=$1',[s.id]);expect(rows.rows[0].n).toBe(0);expect((await json<Session>(`/sessions/${s.id}`)).status).toBe('active');expect((await data.pg.query('select * from review_states order by question_id')).rows).toEqual(before.rows);
    await data.pg.exec('DROP TRIGGER test_fail ON attempts; DROP FUNCTION test_fail();');await json(`/sessions/${s.id}/submit`,'POST',{revision:s.revision,submission_id:token});
  });
  it('matching allows repeated paragraph letters; cloze rejects repeated words',async()=>{
    let s=await json<Session>('/sessions','POST',{group_id:'matching-group',practice_type:'new'});
    s=await json<Session>(`/sessions/${s.id}`,'PATCH',{revision:s.revision,choices:Object.fromEntries(s.question_ids.map(id=>[id,{answer:'A',uncertain:false,duration_ms:100}])),cursor:0,scroll:0,elapsed_ms:1000,paused:false});
    await json(`/sessions/${s.id}/submit`,'POST',{revision:s.revision,submission_id:crypto.randomUUID()});expect((await json<Result>(`/sessions/${s.id}/result`)).score).toBe(10);
    const c=await json<Session>('/sessions','POST',{group_id:'cloze-group',practice_type:'new'});
    expect((await request(`/sessions/${c.id}`,'PATCH',{revision:0,choices:{'cloze-q1':{answer:'A',uncertain:false,duration_ms:0},'cloze-q2':{answer:'A',uncertain:false,duration_ms:0}},cursor:0,scroll:0,elapsed_ms:0,paused:false})).status).toBe(400);
  });
  it('import is idempotent, updates stable contents, preserves existing session snapshots',async()=>{
    const original=fixture('careful','careful');const s=await json<Session>('/sessions','POST',{group_id:'careful-group',practice_type:'retry'});
    original.passage.paragraphs[0].text+=' Updated content.';original.version='test-v2';original.answers[0].correct_answer='B';original.answers[0].answer_version='test-key-v2';
    await importFixture(data.db,original);await importFixture(data.db,original);
    const frozen=await json<Session>(`/sessions/${s.id}`);expect(frozen.snapshot.version).toBe('test-v1');expect(frozen.snapshot.passage.paragraphs[0].text).not.toContain('Updated content');
    expect((await data.pg.query<{n:number}>('select count(*)::int n from questions where group_id=$1',['careful-group'])).rows[0].n).toBe(5);
    original.answers=[];original.explanations=[];await importFixture(data.db,original);
    expect((await request('/groups/careful-group')).status).toBe(404);expect((await request('/sessions','POST',{group_id:'careful-group',practice_type:'new'},'charlie')).status).toBe(409);
  });
  it('annotations require actual owned paragraph text; other users cannot read notes',async()=>{
    await json('/annotations','POST',{passage_id:'careful-passage',paragraph_id:'careful-p0',selected_text:'Students read complete articles',note:'test note',kind:'sentence'});
    expect((await json<unknown[]>('/annotations')).length).toBe(1);expect((await json<unknown[]>('/annotations','GET',undefined,'bob')).length).toBe(0);
    expect((await request('/annotations','POST',{passage_id:'careful-passage',paragraph_id:'careful-p0',selected_text:'Invented quote',note:'',kind:'note'})).status).toBe(400);
  });
  it('rejects client user_id and cross-origin writes; prevents direct history mutation',async()=>{
    expect((await request('/sessions','POST',{group_id:'matching-group',practice_type:'new',user_id:crypto.randomUUID()})).status).toBe(400);
    expect((await app.request('http://localhost/api/settings',{method:'PATCH',headers:{Origin:'https://evil.invalid','Content-Type':'application/json'},body:'{"daily_goal":10}'},env)).status).toBe(403);
    await expect(data.pg.exec('update attempts set is_correct=true')).rejects.toThrow('ATTEMPT_HISTORY_IMMUTABLE');
  });
});
