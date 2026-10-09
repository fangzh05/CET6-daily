// Test-only Node adapter. Production is exclusively Cloudflare Workers + Neon.
import { createServer } from 'node:http';
import { testDatabase, importFixture } from './database';
import { fixture } from './fixture';
import { createApp } from '../worker/app';
import type { Env } from '../worker/auth';
const data=await testDatabase();
for(const kind of ['careful','matching','cloze'] as const)await importFixture(data.db,fixture(kind,kind));
const preview=fixture('careful','preview');preview.paper.year=2024;preview.title='待核验测试文章 · 非六级真题';preview.release_status='pending';preview.content_status='incomplete';preview.question_status='incomplete';await importFixture(data.db,preview);
const app=createApp({db:data.db,authenticate:async()=>({identity:'isolated-e2e-user',email:'e2e@example.invalid'})});
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
    const response=await app.fetch(request,{APP_ENV:'development'} as Env);
    res.writeHead(response.status,Object.fromEntries(response.headers.entries()));res.end(Buffer.from(await response.arrayBuffer()));
  } catch {res.writeHead(500);res.end('test server error');}
});
server.listen(8787,'127.0.0.1',()=>console.log('Isolated E2E PostgreSQL adapter on 8787. Synthetic test data only.'));
process.on('SIGTERM',()=>server.close(()=>{void data.pg.close();}));
