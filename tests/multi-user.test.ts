import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createApp } from '../worker/app';
import { testDatabase, importFixture } from './database';
import { fixture } from './fixture';
import type { Env } from '../worker/auth';
import type { AdminInvite, AdminOverview, Me } from '../shared/contracts';
import { canonicalInviteCode, formatInviteCode, generateInviteCode, isPlausibleInviteCode } from '../worker/invites';
describe('multi-user invites and account isolation (isolated PGlite engine)',()=>{
  let data:Awaited<ReturnType<typeof testDatabase>>; let app:ReturnType<typeof createApp>;
  const env={APP_ENV:'development',ADMIN_EMAILS:'owner@example.com'} as Env;
  const request=(path:string,method='GET',body?:unknown,user='owner',email='owner@example.com')=>app.request(`http://localhost/api${path}`,{method,headers:{Origin:'http://localhost','Content-Type':'application/json','x-test-user':user,'x-test-email':email},body:body===undefined?undefined:JSON.stringify(body)},env);
  const json=async <T>(path:string,method='GET',body?:unknown,user='owner',email='owner@example.com'):Promise<T>=>{const r=await request(path,method,body,user,email);expect(r.status,await r.clone().text()).toBeLessThan(300);return r.json() as Promise<T>;};
  const count=async(table:string)=>{const rows=await data.pg.query<{n:number}>(`select count(*)::int n from ${table}`);return rows.rows[0].n;};
  const invite=async(maxUses=1,days:number|null=7,note='')=>json<AdminInvite>('/admin/invites','POST',{max_uses:maxUses,expires_in_days:days,note});
  beforeAll(async()=>{data=await testDatabase();for(const kind of ['careful','matching','cloze'] as const)await importFixture(data.db,fixture(kind,kind));app=createApp({db:data.db,authenticate:async req=>({identity:`test:${req.headers.get('x-test-user')??'owner'}`,email:(req.headers.get('x-test-email')??'owner@example.com').toLowerCase()})});});
  afterAll(async()=>{await data.pg.close();});
  it('generates readable, high-entropy canonical codes',()=>{
    const generated=generateInviteCode();expect(generated).toMatch(/^CET6[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/);
    expect(formatInviteCode(generated)).toMatch(/^CET6-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(canonicalInviteCode('  cet6-abcd efgh-jkmn ')).toBe('CET6ABCDEFGHJKMN');
    expect(isPlausibleInviteCode(canonicalInviteCode('CET6-ABCD-EFGH-JKMN'))).toBe(true);
    expect(new Set(Array.from({length:50},generateInviteCode)).size).toBe(50);
  });
  it('provisions configured administrators only, and strangers see the activation screen',async()=>{
    const owner=await json<Me>('/me');
    expect(owner).toMatchObject({status:'active',admin:true});expect(owner.id).toBeTruthy();expect(owner.logout_url).toBeNull();
    expect(await count('users')).toBe(1);
    await json<Me>('/me'); // repeated contact must not duplicate the account
    expect(await count('users')).toBe(1);
    const stranger=await json<Me>('/me','GET',undefined,'newcomer','newcomer@example.com');
    expect(stranger).toEqual({id:null,email:'newcomer@example.com',status:'invite_required',admin:false,logout_url:null});
    expect((await request('/dashboard','GET',undefined,'newcomer','newcomer@example.com')).status).toBe(403);
    expect((await request('/library','GET',undefined,'newcomer','newcomer@example.com')).status).toBe(403);
    expect((await request('/admin/overview','GET',undefined,'newcomer','newcomer@example.com')).status).toBe(403);
    expect(await count('users')).toBe(1);
  });
  it('lets only administrators issue and list invites',async()=>{
    const first=await invite(1,7,'给小周');
    expect(first.display_code).toMatch(/^CET6-/);expect(first.code).toBe(canonicalInviteCode(first.code));expect(first.used_count).toBe(0);
    // A redeemed member may use the app but not the console.
    const memberInvite=await invite();
    await json('/access/redeem','POST',{code:memberInvite.code},'member1','member1@example.com');
    expect((await request('/admin/invites','POST',{max_uses:1},'member1','member1@example.com')).status).toBe(403);
    expect((await request('/admin/overview','GET',undefined,'member1','member1@example.com')).status).toBe(403);
    expect((await request('/admin/invites/00000000-0000-0000-0000-000000000000','DELETE',undefined,'member1','member1@example.com')).status).toBe(403);
    const overview=await json<AdminOverview>('/admin/overview');
    expect(overview.totals).toMatchObject({users:2,active:2,disabled:0,active_invites:1});
    expect(overview.users.filter(u=>u.admin).map(u=>u.email)).toEqual(['owner@example.com']);
    const invites=await json<AdminInvite[]>('/admin/invites');
    expect(invites.map(i=>i.id)).toEqual(expect.arrayContaining([first.id,memberInvite.id]));
    expect(invites.find(i=>i.id===first.id)?.note).toBe('给小周');
  });
  it('activates an account by redeeming a code and keeps every user fully isolated',async()=>{
    const created=await invite(1,7,'给阿伟');
    const local=await app.request('http://localhost/api/access/redeem',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json','x-test-user':'friend','x-test-email':'Friend@Example.com'},body:JSON.stringify({code:created.display_code!.toLowerCase().replace(/-/g,' ')})},env);
    expect(local.status).toBe(200);
    const redeemed=await local.json() as {id:string;email:string;status:string};
    expect(redeemed.status).toBe('active');expect(redeemed.email).toBe('friend@example.com');
    const me=await json<Me>('/me','GET',undefined,'friend','friend@example.com');
    expect(me).toMatchObject({status:'active',admin:false});expect(me.id).toBe(redeemed.id);
    const dashboard=await json<{remaining:number}>('/dashboard','GET',undefined,'friend','friend@example.com');
    expect(dashboard.remaining).toBe(5);
    const session=await json<{id:string;revision:number;question_ids:string[]}>('/sessions','POST',{group_id:'careful-group',practice_type:'new'},'friend','friend@example.com');
    await json(`/sessions/${session.id}`,'PATCH',{revision:session.revision,choices:Object.fromEntries(session.question_ids.map(id=>[id,{answer:'A',uncertain:false,duration_ms:600}])),cursor:0,scroll:0,elapsed_ms:3000,paused:false},'friend','friend@example.com');
    await json(`/sessions/${session.id}/submit`,'POST',{submission_id:crypto.randomUUID(),revision:session.revision+1},'friend','friend@example.com');
    const mine=await json<{first_count:number}>('/stats','GET',undefined,'friend','friend@example.com');
    const owners=await json<{first_count:number}>('/stats');
    expect(mine.first_count).toBe(5);expect(owners.first_count).toBe(0);
    // The owner cannot read the member's session, and vice versa.
    expect((await request(`/sessions/${session.id}`)).status).toBe(404);
    expect(await count('users')).toBe(3);
  });
  it('rejects malformed, unknown, expired, revoked, exhausted and duplicate-redemption codes',async()=>{
    expect((await request('/access/redeem','POST',{code:'ab'},'r1','r1@example.com')).status).toBe(400);
    expect((await request('/access/redeem','POST',{code:'CET6-ZZZZ-ZZZZ-ZZZZ'},'r1','r1@example.com')).status).toBe(400);
    expect(await count('users')).toBe(3);
    const expiring=await invite();
    await data.pg.query("update invites set expires_at=now()-interval '1 hour' where code=$1",[expiring.code]);
    expect((await request('/access/redeem','POST',{code:expiring.code},'r2','r2@example.com')).status).toBe(400);
    const revoked=await invite();
    await json(`/admin/invites/${revoked.id}`,'DELETE');
    expect((await request('/access/redeem','POST',{code:revoked.code},'r3','r3@example.com')).status).toBe(400);
    expect((await request(`/admin/invites/${revoked.id}`,'DELETE')).status).toBe(404);
    const single=await invite();
    await json('/access/redeem','POST',{code:single.code},'r4','r4@example.com');
    const reused=await request('/access/redeem','POST',{code:single.code},'r5','r5@example.com');
    expect(reused.status).toBe(409);expect(await reused.json()).toEqual({error:'INVITE_EXHAUSTED'});
    // Redeeming with an existing account is idempotent, not a second account.
    const again=await json<{id:string;status:string}>('/access/redeem','POST',{code:single.code},'r4','r4@example.com');
    expect(again.status).toBe('active');
    const shared=await invite(2,7,'两人份');
    await json('/access/redeem','POST',{code:shared.code},'r6','r6@example.com');
    await json('/access/redeem','POST',{code:shared.code},'r7','r7@example.com');
    expect((await request('/access/redeem','POST',{code:shared.code},'r8','r8@example.com')).status).toBe(409);
    expect((await request('/access/redeem','POST',{code:shared.code},'r9','r9@example.com')).status).toBe(409);
    // One verified email belongs to exactly one account.
    const duplicate=await invite();
    expect((await request('/access/redeem','POST',{code:duplicate.code},'other-identity','r4@example.com')).status).toBe(409);
  });
  it('disables and restores accounts without touching their data, and protects administrators',async()=>{
    const target=await json<Me>('/me','GET',undefined,'friend','friend@example.com');
    const attemptsBefore=(await data.pg.query<{n:number}>('select count(*)::int n from attempts where user_id=$1',[target.id])).rows[0].n;
    expect(attemptsBefore).toBe(5);
    const disabled=await json<{status:string}>(`/admin/users/${target.id}`,'PATCH',{status:'disabled'});
    expect(disabled.status).toBe('disabled');
    const me=await json<Me>('/me','GET',undefined,'friend','friend@example.com');
    expect(me).toMatchObject({status:'disabled',id:target.id});
    expect((await request('/dashboard','GET',undefined,'friend','friend@example.com')).status).toBe(403);
    expect((await request('/access/redeem','POST',{code:(await invite()).code},'friend','friend@example.com')).status).toBe(403);
    const active=await json<{status:string}>(`/admin/users/${target.id}`,'PATCH',{status:'active'});
    expect(active.status).toBe('active');
    expect((await request('/dashboard','GET',undefined,'friend','friend@example.com')).status).toBe(200);
    expect((await data.pg.query<{n:number}>('select count(*)::int n from attempts where user_id=$1',[target.id])).rows[0].n).toBe(attemptsBefore);
    const owner=await json<Me>('/me');
    const protectedAttempt=await request(`/admin/users/${owner.id}`,'PATCH',{status:'disabled'});
    expect(protectedAttempt.status).toBe(403);expect(await protectedAttempt.json()).toEqual({error:'ADMIN_PROTECTED'});
    expect((await request(`/admin/users/${crypto.randomUUID()}`,'PATCH',{status:'disabled'})).status).toBe(404);
  });
});
