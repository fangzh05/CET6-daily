// Test-only Node adapter. Production is exclusively Cloudflare Workers + Neon.
import { createServer } from 'node:http';
import { testDatabase, importFixture } from './database';
import { fixture } from './fixture';
import { createApp } from '../worker/app';
import type { Env } from '../worker/auth';
import { validateKy1Bank } from '../scripts/ky1-bank';
const data=await testDatabase();
if(process.env.KY1_BANK_PATH){const bank=await validateKy1Bank(process.env.KY1_BANK_PATH);if(bank.errors.length)throw new Error('KY1 preview validation failed');for(const group of bank.groups)await importFixture(data.db,group);}
for(const kind of ['careful','matching','cloze'] as const)await importFixture(data.db,fixture(kind,kind));
if(process.env.ANNOTATION_PREVIEW==='true'){
  const ky=fixture('careful','ky1-annotations');ky.paper.exam='KY1';ky.paper.year=2026;ky.paper.month=0;ky.kind='use_of_english';ky.title='考研笔记交互测试 · 合成内容';const baseQuestions=ky.questions,baseAnswers=ky.answers,baseExplanations=ky.explanations;ky.questions=Array.from({length:20},(_,i)=>({...baseQuestions[i%5],id:`ky1-annotations-q${i+1}`,number:i+1}));ky.answers=ky.questions.map((q,i)=>({...baseAnswers[i%5],question_id:q.id}));ky.explanations=ky.questions.map((q,i)=>({...baseExplanations[i%5],question_id:q.id}));ky.passage.paragraphs[0].text='Before {{1}} after blank. '+ky.passage.paragraphs[0].text;await importFixture(data.db,ky);
  for(const kind of ['jlpt_vocab','jlpt_reading'] as const){const n1=fixture('careful',kind+'-annotations');n1.paper.exam='JLPT_N1';n1.paper.set=kind==='jlpt_vocab'?1:2;n1.kind=kind;n1.title='N1 注釈テスト · 合成内容';n1.questions.forEach(q=>{q.stem='この文章について、最も適切な答えを選びなさい。';q.options.forEach((o,i)=>{o.text=['読書の実験について説明している','サッカーの試合について説明している','海外旅行について説明している','料理の教室について説明している'][i];});});await importFixture(data.db,n1);}
}
const preview=fixture('careful','preview');preview.paper.year=2024;preview.title='待核验测试文章 · 非六级真题';preview.release_status='pending';preview.content_status='incomplete';preview.question_status='incomplete';await importFixture(data.db,preview);
// Test-only header overrides let one browser context act as different verified
// emails (activation, admin console). Production identities come from Access.
const app=createApp({db:data.db,authenticate:async req=>({identity:req.headers.get('x-test-user')?`test:${req.headers.get('x-test-user')}`:'isolated-e2e-user',email:(req.headers.get('x-test-email')??'e2e@example.invalid').toLowerCase()})});
const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));
  const body=Buffer.concat(chunks);const url=`http://${req.headers.host}${req.url}`;
  try {
    // Reset only the disposable test engine between browser cases.
    if(req.url==='/__test/reset') {
      await data.pg.exec('TRUNCATE annotations,review_states,attempts,practice_sessions,user_settings,users CASCADE');
      res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');return;
    }
    const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
    const request=new Request(url,{method:req.method,headers,...(body.length?{body}: {})});
    const response=await app.fetch(request,{APP_ENV:'development',ADMIN_EMAILS:'e2e@example.invalid,owner@example.com'} as Env);
    res.writeHead(response.status,Object.fromEntries(response.headers.entries()));res.end(Buffer.from(await response.arrayBuffer()));
  } catch {res.writeHead(500);res.end('test server error');}
});
server.listen(8787,'127.0.0.1',()=>console.log('Isolated E2E PostgreSQL adapter on 8787. Synthetic test data only.'));
process.on('SIGTERM',()=>server.close(()=>{void data.pg.close();}));
