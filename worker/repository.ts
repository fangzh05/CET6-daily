import { sql } from 'drizzle-orm';
import type { Database } from './db';
import { ApiError, type Identity } from './auth';
import type { Session, Result, Stats, GroupSummary, Choice } from '../shared/contracts';

export type Account = { id: string; email: string; status: 'active' | 'disabled' };
export type AdminUserRow = { id: string; email: string; status: string; created_at: string; attempts: number; sessions: number; last_active: string | null };
export type AdminInviteRow = { id: string; code: string; note: string | null; max_uses: number; used_count: number; expires_at: string | null; revoked_at: string | null; created_at: string; created_by: string; redemptions: { email: string; redeemed_at: string }[] };
export type AdminTotals = { users: number; active: number; disabled: number; attempts: number; active_invites: number };

export class Repository {
  constructor(private db: Database) {}
  // Read-only account lookup. Multi-user access never auto-creates a row for a
  // regular visitor: only provisionAdmin (configured administrators) and
  // cet6_redeem_invite (a usable invite code) can create users.
  async account(identity: Identity): Promise<Account | null> {
    const [row] = await this.db.query<Account>(sql`select id,email,status from users where identity=${identity.identity}`);
    return row ?? null;
  }
  async provisionAdmin(identity: Identity): Promise<Account> {
    const [row] = await this.db.query<Account>(sql`insert into users(identity,email) values(${identity.identity},${identity.email}) on conflict(identity) do update set email=excluded.email returning id,email,status`);
    return row;
  }
  // Test and local tooling only. Request handlers must never call this: real
  // accounts are created exclusively by cet6_redeem_invite (invite redemption)
  // and provisionAdmin (configured administrators).
  async provisionTestUser(identity: Identity) {
    const [row] = await this.db.query<Account>(sql`insert into users(identity,email) values(${identity.identity},${identity.email}) on conflict(identity) do update set email=excluded.email returning id,email,status`);
    return row;
  }
  async redeem(identity: Identity, code: string) {
    const [row] = await this.db.query(sql`select cet6_redeem_invite(${identity.identity},${identity.email},${code}) data`);
    return row.data as { status: 'redeemed' | 'existing'; user: { id: string; email: string; account_status: string } };
  }
  async daily(uid: string, limit = 1, exam?: string) {
    exam ??= await this.selectedExam(uid);
    return this.db.query<GroupSummary & Record<string, unknown>>(sql`
      select g.id,g.title,g.kind,p.exam,p.year,p.month,p.set,(select count(*)::int from questions q where q.group_id=g.id and not q.archived) question_count
      from question_groups g join papers p on p.id=g.paper_id
      where g.eligible and not g.archived and p.exam=${exam} and (g.kind='careful' or (p.exam='JLPT_N1' and g.kind='jlpt_reading'))
        and not exists(select 1 from questions q join attempts a on a.question_id=q.id where q.group_id=g.id and a.user_id=${uid}::uuid and a.practice_type='new')
      order by p.year desc,p.month desc,p.set,g.id limit ${limit}`);
  }
  async group(gid: string) {
    const [row] = await this.db.query(sql`select cet6_group(id) data from question_groups where id=${gid} and eligible and not archived`);
    if (!row) throw new ApiError(404, 'GROUP_NOT_AVAILABLE');
    return row.data;
  }
  async library() {
    return this.db.query(sql`select g.id,g.title,g.kind,p.exam,p.year,p.month,p.set,g.eligible,
      (select count(*)::int from questions q where q.group_id=g.id and not q.archived) question_count
      from question_groups g join papers p on p.id=g.paper_id where not g.archived
      order by p.year desc,p.month desc,p.set,g.id`);
  }
  async preview(gid: string) {
    const [row]=await this.db.query(sql`select cet6_group(id) data,eligible from question_groups where id=${gid} and not archived`);
    if(!row)throw new ApiError(404,'GROUP_NOT_AVAILABLE');
    // Project an explicit public allowlist: no answer keys or explanations, even for released groups.
    const g=row.data as Record<string,unknown>;
    const analyses=['translation','writing'].includes(String(g.kind))?await this.db.query(sql`select e.question_id,e.explanation,e.keyword_relation,e.evidence,e.distractors distractor_explanations,e.skill_tags,e.verification_status,e.analysis
      from explanations e join questions q on q.id=e.question_id where q.group_id=${gid} and not q.archived and e.verification_status='verified' order by q.number`):[];
    return {id:g.id,kind:g.kind,title:g.title,paper:g.paper,passage:g.passage,questions:g.questions,version:g.version,source:g.source,eligible:row.eligible,analyses:Object.fromEntries(analyses.map(e=>[e.question_id,e]))};
  }
  async active(uid: string) {
    const rows = await this.db.query(sql`select cet6_session_public(s) data from practice_sessions s where user_id=${uid}::uuid and status in ('active','paused') order by started_at desc`);
    return rows.map(r => r.data as Session);
  }
  async session(uid: string, sid: string) {
    const [row] = await this.db.query(sql`select cet6_session_public(s) data from practice_sessions s where id=${sid}::uuid and user_id=${uid}::uuid`);
    if (!row) throw new ApiError(404, 'SESSION_NOT_FOUND');
    return row.data as Session;
  }
  async start(uid: string, group: string, type: string, ids?: string[]) {
    const [r] = await this.db.query(sql`select cet6_start(${uid}::uuid,${group},${type},${ids ? JSON.stringify(ids) : null}::jsonb) data`);
    return r.data as Session;
  }
  async save(uid: string, sid: string, draft: { revision: number; choices: Record<string, Choice>; cursor: number; scroll: number; elapsed_ms: number; paused: boolean }) {
    const [r] = await this.db.query(sql`select cet6_save(${uid}::uuid,${sid}::uuid,${draft.revision},${JSON.stringify(draft)}::jsonb) data`);
    return r.data as Session;
  }
  async submit(uid: string, sid: string, token: string, revision: number) {
    const [r] = await this.db.query(sql`select cet6_submit(${uid}::uuid,${sid}::uuid,${token}::uuid,${revision}) data`);
    return r.data;
  }
  async result(uid: string, sid: string): Promise<Result> {
    const s = await this.session(uid, sid);
    if (s.status !== 'submitted') throw new ApiError(409, 'RESULT_NOT_SUBMITTED');
    const [score] = await this.db.query(sql`select score,total from practice_sessions where id=${sid}::uuid and user_id=${uid}::uuid`);
    const rows = await this.db.query(sql`select a.question_id,a.submitted_answer,a.correct_answer,a.is_correct,a.uncertain,a.answer_version,coalesce(nullif(s.explanation_snapshot->a.question_id,'null'::jsonb),supplement.explanation) explanation
      from attempts a join practice_sessions s on s.id=a.session_id and s.user_id=a.user_id
      -- Old sessions can predate an explanation import. Supplement only missing
      -- explanations after submission; never rewrite frozen history or grading.
      left join lateral (
        select jsonb_build_object('question_id',e.question_id,'explanation',e.explanation,'keyword_relation',e.keyword_relation,
          'evidence',e.evidence,'distractor_explanations',e.distractors,'skill_tags',e.skill_tags,'verification_status',e.verification_status,'analysis',e.analysis) explanation
        from explanations e join questions q on q.id=e.question_id and q.group_id=s.group_id and not q.archived
        join question_groups g on g.id=q.group_id and not g.archived
        join answer_keys k on k.question_id=q.id and k.verification_status='verified' and k.verified_at is not null
        where e.question_id=a.question_id and e.verification_status='verified'
          and nullif(s.explanation_snapshot->a.question_id,'null'::jsonb) is null
          and k.correct_answer=a.correct_answer and k.answer_version=a.answer_version
          and s.snapshot->'passage'=(cet6_group(s.group_id)->'passage')
          and exists(select 1 from jsonb_array_elements(s.snapshot->'questions') frozen
            where frozen->>'id'=q.id and frozen->>'stem'=q.stem and frozen->'options'=q.options
              and (frozen->>'number')::int=q.number and frozen->'paragraph_ids'=q.paragraph_ids)
          and jsonb_array_length(e.evidence)>0
          and not exists(select 1 from jsonb_array_elements(e.evidence) ev where not exists(
            select 1 from jsonb_array_elements(s.snapshot->'passage'->'paragraphs') p
              where p->>'id'=ev->>'paragraph_id' and length(ev->>'text')>0 and position(ev->>'text' in p->>'text')>0))
      ) supplement on true
      where s.status='submitted' and a.session_id=${sid}::uuid and a.user_id=${uid}::uuid order by a.question_id`);
    return { session: s, score: Number(score.score), total: Number(score.total), attempts: rows as unknown as Result['attempts'] };
  }
  async due(uid: string, exam?: string) {
    exam ??= await this.selectedExam(uid);
    return this.db.query<{ question_id: string; group_id: string; title: string; review_due_at: string }>(sql`
      select r.question_id,q.group_id,g.title,r.review_due_at from review_states r join questions q on q.id=r.question_id join question_groups g on g.id=q.group_id
      where exists(select 1 from papers p where p.id=g.paper_id and p.exam=${exam}) and r.user_id=${uid}::uuid and r.review_due_at<=now() and g.eligible and not g.archived and not q.archived order by r.review_due_at,r.question_id`);
  }
  async selectedExam(uid: string): Promise<string> {
    const [r]=await this.db.query(sql`select selected_exam from user_settings where user_id=${uid}::uuid`);
    return String(r?.selected_exam ?? 'CET6');
  }
  async availableExams(): Promise<string[]> {
    const rows=await this.db.query(sql`select distinct p.exam from papers p join question_groups g on g.paper_id=p.id where g.eligible and not g.archived and (g.kind='careful' or (p.exam='JLPT_N1' and g.kind='jlpt_reading')) order by p.exam`);
    return rows.map(r=>String(r.exam));
  }
  async setExam(uid: string, exam: string) {
    if(!(await this.availableExams()).includes(exam))throw new ApiError(400,'EXAM_NOT_AVAILABLE');
    await this.db.query(sql`insert into user_settings(user_id,selected_exam) values(${uid}::uuid,${exam}) on conflict(user_id) do update set selected_exam=excluded.selected_exam`);
  }
  async settings(uid: string) {
    const [r] = await this.db.query(sql`select daily_goal from user_settings where user_id=${uid}::uuid`);
    return Number(r?.daily_goal ?? 5);
  }
  async setGoal(uid: string, goal: number) {
    await this.db.query(sql`insert into user_settings(user_id,daily_goal) values(${uid}::uuid,${goal}) on conflict(user_id) do update set daily_goal=excluded.daily_goal`);
  }
  async stats(uid: string): Promise<Stats> {
    // All windows use UTC instants derived from Asia/Shanghai. First, retry and review are distinct.
    const [summary] = await this.db.query(sql`
      with windows as(select (date_trunc('day',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai') d,
        (date_trunc('week',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai') w,
        ((date_trunc('day',now() at time zone 'Asia/Shanghai') - interval '6 days') at time zone 'Asia/Shanghai') seven),
      a as(select * from attempts where user_id=${uid}::uuid)
      select (select count(*)::int from a,windows where submitted_at>=d) today_count,
        (select count(*)::int from a,windows where submitted_at>=w) week_count,
        (select coalesce(sum(elapsed_ms),0)::float8 from practice_sessions,windows where user_id=${uid}::uuid and status='submitted' and submitted_at>=w) week_ms,
        (select count(*)::int from a,windows where practice_type='new' and submitted_at>=seven) first_count,
        (select count(*)::int from a,windows where practice_type='new' and is_correct and submitted_at>=seven) first_correct,
        (select count(*)::int from a where practice_type='review') review_count,
        (select count(*)::int from a where practice_type='review' and is_correct) review_correct,
        (select coalesce(avg(response_duration),0)::float8 from a where practice_type='new') average_ms`);
    const trend = await this.db.query(sql`select (a.submitted_at at time zone 'Asia/Shanghai')::date::text AS "day",s.id session_id,s.snapshot->>'title' title,s.snapshot->'paper' paper,s.snapshot->>'kind' kind,count(*)::int count,count(*) filter(where a.is_correct)::int correct
      from attempts a join practice_sessions s on s.id=a.session_id and s.user_id=a.user_id
      where a.user_id=${uid}::uuid and a.practice_type='new' and a.submitted_at >= ((date_trunc('day',now() at time zone 'Asia/Shanghai')-interval '6 days') at time zone 'Asia/Shanghai')
      group by "day",s.id order by "day" desc,s.submitted_at desc`);
    const by_kind = await this.db.query(sql`select s.snapshot->>'kind' kind,count(*)::int count,count(*) filter(where a.is_correct)::int correct from attempts a join practice_sessions s on s.id=a.session_id where a.user_id=${uid}::uuid and a.practice_type='new' group by s.snapshot->>'kind'`);
    const by_year = await this.db.query(sql`select p.year,(select count(distinct a.question_id)::int from attempts a join questions q on q.id=a.question_id join question_groups g on g.id=q.group_id where a.user_id=${uid}::uuid and a.practice_type='new' and g.paper_id=p.id) count,(select count(*)::int from questions q join question_groups g on g.id=q.group_id where g.paper_id=p.id and g.eligible and not g.archived and not q.archived) total from papers p order by p.year desc`);
    const errors = await this.db.query(sql`select error_category category,count(*)::int count from review_states where user_id=${uid}::uuid group by error_category`);
    const [reviewCompletion] = await this.db.query(sql`select count(*) filter(where last_reviewed_at >= (date_trunc('day',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'))::int completed, count(*) filter(where review_due_at<=now())::int due from review_states where user_id=${uid}::uuid`);
    const yearly = Object.values(by_year.reduce<Record<string, { year: number; count: number; total: number }>>((acc, row) => {
      const key = String(row.year); acc[key] ??= { year: Number(row.year), count: 0, total: 0 }; acc[key].count += Number(row.count); acc[key].total += Number(row.total); return acc;
    }, {})).sort((a,b) => b.year-a.year);
    return { ...summary, trend, by_kind, by_year: yearly, errors, review_completion: reviewCompletion } as unknown as Stats;
  }
  async dashboard(uid: string) {
    const selected_exam=await this.selectedExam(uid);
    const [daily_goal, stats, due, active, available_exams] = await Promise.all([this.settings(uid), this.stats(uid), this.due(uid,selected_exam), this.active(uid), this.availableExams()]);
    // Goal counts first attempts only; repeats do not remove today's new reading task.
    const [today] = await this.db.query(sql`select count(*)::int n from attempts a join practice_sessions s on s.id=a.session_id where a.user_id=${uid}::uuid and coalesce(s.snapshot->'paper'->>'exam','CET6')=${selected_exam} and a.practice_type='new' and a.submitted_at >= (date_trunc('day',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')`);
    const remaining = Math.max(0, daily_goal-Number(today.n));
    const recommendations = remaining > 0 ? await this.daily(uid, Math.ceil(remaining/5), selected_exam) : [];
    return { selected_exam, available_exams, daily_goal, remaining, recommendations, due, active, stats };
  }
  async review(uid: string, qid: string, category?: string) {
    const [r] = await this.db.query(sql`
      insert into review_states(user_id,question_id,review_due_at,wrong_count,review_count,step,mastery_state,error_category)
      select ${uid}::uuid,${qid},now()+interval '1 day',0,0,0,'learning',${category ?? null}
      where exists(select 1 from attempts where user_id=${uid}::uuid and question_id=${qid})
      on conflict(user_id,question_id) do update set error_category=coalesce(excluded.error_category,review_states.error_category) returning question_id`);
    if (!r) throw new ApiError(404, 'ATTEMPT_NOT_FOUND');
    return r;
  }
  async annotations(uid: string, passage?: string) {
    return this.db.query(sql`select a.id,a.passage_id,coalesce(a.paragraph_id,a.target_id) paragraph_id,a.selected_text,a.note,a.kind,a.created_at,a.updated_at,
      (select s.snapshot->>'title' from practice_sessions s where s.user_id=a.user_id and s.snapshot->'passage'->>'id'=a.passage_id order by s.started_at desc limit 1) title
      from annotations a where a.user_id=${uid}::uuid ${passage ? sql`and a.passage_id=${passage}` : sql``} order by a.created_at desc limit 1000`);
  }
  async mistakes(uid:string,day:string,offset:number) {
    const condition=sql`a.user_id=${uid}::uuid and not a.is_correct and s.status='submitted'
      and a.submitted_at>=(${day}::date::timestamp at time zone 'Asia/Shanghai')
      and a.submitted_at< ((${day}::date+1)::timestamp at time zone 'Asia/Shanghai')`;
    const [count]=await this.db.query(sql`select count(*)::int total from attempts a join practice_sessions s on s.id=a.session_id and s.user_id=a.user_id where ${condition}`);
    const items=await this.db.query(sql`select s.id session_id,a.question_id,(q->>'number')::int number,q->>'stem' stem,a.submitted_answer,a.correct_answer,a.submitted_at,a.practice_type,s.snapshot->'paper' paper,s.snapshot->>'kind' kind,s.snapshot->>'title' title
      from attempts a join practice_sessions s on s.id=a.session_id and s.user_id=a.user_id
      join lateral jsonb_array_elements(s.snapshot->'questions') q on q->>'id'=a.question_id
      where ${condition} order by a.submitted_at desc,a.question_id limit 50 offset ${offset}`);
    return {day,offset,total:Number(count.total),items};
  }
  async removeAnnotation(uid:string,id:string) {
    const [row]=await this.db.query(sql`delete from annotations where id=${id}::uuid and user_id=${uid}::uuid returning id`);
    if(!row)throw new ApiError(404,'ANNOTATION_NOT_FOUND');return row;
  }
  async annotate(uid: string, value: { passage_id: string; paragraph_id: string; selected_text: string; note: string; kind: string }) {
    // Only exact text from this user's frozen session is eligible for annotation.
    const [r] = await this.db.query(sql`insert into annotations(user_id,passage_id,paragraph_id,target_id,selected_text,note,kind)
      select ${uid}::uuid,${value.passage_id},t.paragraph_id,t.target_id,${value.selected_text},${value.note},${value.kind}
      from (
        select p->>'id' paragraph_id,null::text target_id,p->>'text' body
        from practice_sessions s,jsonb_array_elements(s.snapshot->'passage'->'paragraphs') p
        where s.user_id=${uid}::uuid and s.snapshot->'passage'->>'id'=${value.passage_id}
        union all
        select null::text,'question:'||(q->>'id')||':stem',q->>'stem'
        from practice_sessions s,jsonb_array_elements(s.snapshot->'questions') q
        where s.user_id=${uid}::uuid and s.snapshot->'passage'->>'id'=${value.passage_id}
        union all
        select null::text,'question:'||(q->>'id')||':option:'||(o->>'key'),o->>'text'
        from practice_sessions s,jsonb_array_elements(s.snapshot->'questions') q,jsonb_array_elements(q->'options') o
        where s.user_id=${uid}::uuid and s.snapshot->'passage'->>'id'=${value.passage_id}
      ) t where coalesce(t.paragraph_id,t.target_id)=${value.paragraph_id} and position(${value.selected_text} in t.body)>0
      limit 1 returning id,created_at`);
    if (!r) throw new ApiError(400, 'ANNOTATION_CONTEXT_INVALID');
    return r;
  }
  // ---- Administration (owner-only; every route re-checks the configured email) ----
  async adminOverview() {
    const [users, totals] = await Promise.all([
      this.db.query<AdminUserRow>(sql`
        select u.id,u.email,u.status,u.created_at,
          (select count(*)::int from attempts a where a.user_id=u.id) attempts,
          (select count(*)::int from practice_sessions s where s.user_id=u.id) sessions,
          (select max(x)::text from (select max(a.submitted_at) x from attempts a where a.user_id=u.id
            union all select max(s.started_at) from practice_sessions s where s.user_id=u.id) t) last_active
        from users u order by u.created_at`),
      this.db.query<AdminTotals>(sql`
        select (select count(*)::int from users) users,
          (select count(*)::int from users where status='active') active,
          (select count(*)::int from users where status='disabled') disabled,
          (select count(*)::int from attempts) attempts,
          (select count(*)::int from invites where revoked_at is null and used_count<max_uses and (expires_at is null or expires_at>now())) active_invites`)
    ]);
    return { users, totals: totals[0] };
  }
  async adminSetStatus(uid: string, status: 'active' | 'disabled', protectedEmails: string[] = []) {
    const [target] = await this.db.query<{ email: string }>(sql`select email from users where id=${uid}::uuid`);
    if (!target) throw new ApiError(404, 'USER_NOT_FOUND');
    // Configured administrators can never be disabled from the UI; the owner
    // must not be able to lock themselves (or a co-admin) out by accident.
    if (status === 'disabled' && protectedEmails.includes(target.email.toLowerCase())) throw new ApiError(403, 'ADMIN_PROTECTED');
    const [row] = await this.db.query(sql`update users set status=${status} where id=${uid}::uuid returning id,email,status`);
    return row;
  }
  async adminInvites() {
    return this.db.query<AdminInviteRow>(sql`
      select i.id,i.code,i.note,i.max_uses,i.used_count,i.expires_at,i.revoked_at,i.created_at,u.email created_by,
        (select coalesce(jsonb_agg(jsonb_build_object('email',r.email,'redeemed_at',ir.redeemed_at) order by ir.redeemed_at),'[]'::jsonb)
          from invite_redemptions ir join users r on r.id=ir.user_id where ir.invite_id=i.id) redemptions
      from invites i join users u on u.id=i.created_by order by i.created_at desc limit 200`);
  }
  async adminCreateInvite(createdBy: string, code: string, maxUses: number, expiresAt: string | null, note: string | null) {
    const [row] = await this.db.query<AdminInviteRow>(sql`
      insert into invites(code,note,created_by,max_uses,expires_at) values(${code},${note},${createdBy}::uuid,${maxUses},${expiresAt}::timestamptz)
      returning id,code,note,max_uses,used_count,expires_at,revoked_at,created_at`);
    return row;
  }
  async adminRevokeInvite(uid: string, id: string) {
    const [row] = await this.db.query(sql`update invites set revoked_at=now() where id=${id}::uuid and revoked_at is null and created_by=${uid}::uuid returning id,revoked_at`);
    if (!row) throw new ApiError(404, 'INVITE_NOT_FOUND');
    return row;
  }
}

