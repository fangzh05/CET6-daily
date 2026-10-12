import { Hono, type Context } from 'hono';
import { z, ZodError } from 'zod';
import { annotationSchema, draftSchema, startSchema, submitSchema, errorCategorySchema, mistakeQuerySchema, redeemSchema, inviteCreateSchema, userStatusSchema } from '../shared/contracts';
import { ApiError, authenticate, checkOrigin, isAdminEmail, adminEmails, type Env, type Identity } from './auth';
import { database, type Database } from './db';
import { Repository, type Account } from './repository';
import { canonicalInviteCode, formatInviteCode, generateInviteCode, isPlausibleInviteCode } from './invites';
type Variables = { repo: Repository; identity: Identity; user: Account | null; admin: boolean };
type Dependencies = { db?: Database; authenticate?: (request: Request, env: Env) => Promise<Identity> };
type AppContext = Context<{ Bindings: Env; Variables: Variables }>;
const uid = (c: AppContext): string => (c.get('user') as Account).id;
const domainErrors: Record<string, number> = {
  SESSION_NOT_FOUND: 404, GROUP_NOT_VERIFIED: 409, REVISION_CONFLICT: 409, ALREADY_SUBMITTED: 409,
  ALREADY_PRACTICED: 409, NO_DUE_REVIEWS: 409, RETRY_REQUIRES_HISTORY: 409, FULL_GROUP_REQUIRED: 400,
  INVALID_PRACTICE_TYPE: 400, INVALID_DRAFT: 400, INVALID_QUESTION: 400, INVALID_ANSWER: 400, DUPLICATE_CLOZE_WORD: 400,
  INVITE_REQUIRED: 403, ACCOUNT_DISABLED: 403, ADMIN_REQUIRED: 403, ADMIN_PROTECTED: 403,
  INVITE_INVALID: 400, INVITE_EXPIRED: 400, INVITE_REVOKED: 400, INVITE_EXHAUSTED: 409,
  EMAIL_ALREADY_REGISTERED: 409, INVITE_NOT_FOUND: 404, USER_NOT_FOUND: 404
};
// /api/me renders the activation screen before any account exists, and redeeming
// an invite is the only way a regular account is created. Every other API path
// requires an existing, active account.
const accountExempt = new Set(['/api/me', '/api/access/redeem']);
export function createApp(deps: Dependencies = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store'); c.header('Vary', 'Cf-Access-Jwt-Assertion, Cookie');
    c.header('X-Content-Type-Options', 'nosniff'); c.header('Referrer-Policy', 'same-origin');
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const identity = await (deps.authenticate ?? authenticate)(c.req.raw, c.env);
    c.set('identity', identity);
    // Authenticate static assets too; assets.run_worker_first prevents alternate paths bypassing this.
    if (c.req.path.startsWith('/api/')) {
      checkOrigin(c.req.raw);
      const repo = new Repository(deps.db ?? database(c.env)); c.set('repo', repo);
      const admin = isAdminEmail(c.env, identity.email);
      let account = await repo.account(identity);
      // Configured administrators are provisioned on first contact so the owner
      // can never be locked out; regular accounts are only created by invites.
      if (!account && admin) account = await repo.provisionAdmin(identity);
      c.set('user', account); c.set('admin', admin);
      if (!accountExempt.has(c.req.path)) {
        if (!account) throw new ApiError(403, 'INVITE_REQUIRED');
        if (account.status !== 'active') throw new ApiError(403, 'ACCOUNT_DISABLED');
      }
    }
    await next();
  });
  app.use('/api/*', async (c, next) => {
    if (Number(c.req.header('Content-Length') ?? 0)>65536) throw new ApiError(413, 'REQUEST_TOO_LARGE');
    if (!['GET','HEAD'].includes(c.req.method)) {
      const body = await c.req.text();
      if (new TextEncoder().encode(body).length>65536) throw new ApiError(413, 'REQUEST_TOO_LARGE');
    }
    await next();
  });
  app.get('/api/me', c => {
    const account = c.get('user');
    const issuer = c.env.ACCESS_ISSUER;
    return c.json({
      id: account?.id ?? null, email: account?.email ?? c.get('identity').email,
      status: account?.status ?? 'invite_required', admin: c.get('admin'),
      logout_url: issuer ? `${issuer}/cdn-cgi/access/logout` : null
    });
  });
  app.post('/api/access/redeem', async c => {
    const body = redeemSchema.parse(await c.req.json());
    const existing = c.get('user');
    if (existing && existing.status !== 'active') throw new ApiError(403, 'ACCOUNT_DISABLED');
    if (existing) return c.json({ id: existing.id, email: existing.email, status: existing.status });
    const code = canonicalInviteCode(body.code);
    if (!isPlausibleInviteCode(code)) throw new ApiError(400, 'INVITE_INVALID');
    const result = await c.get('repo').redeem(c.get('identity'), code);
    return c.json({ id: result.user.id, email: result.user.email, status: result.user.account_status });
  });
  app.use('/api/admin/*', async (c, next) => { if (!c.get('admin')) throw new ApiError(403, 'ADMIN_REQUIRED'); await next(); });
  app.get('/api/admin/overview', async c => {
    const data = await c.get('repo').adminOverview();
    const admins = adminEmails(c.env);
    // Label configured administrators so the UI never offers to disable them.
    return c.json({ ...data, users: data.users.map(u => ({ ...u, admin: admins.includes(u.email.toLowerCase()) })) });
  });
  app.get('/api/admin/invites', async c => c.json(await c.get('repo').adminInvites()));
  app.post('/api/admin/invites', async c => {
    const body = inviteCreateSchema.parse(await c.req.json());
    const expiresAt = body.expires_in_days === null ? null : new Date(Date.now() + body.expires_in_days * 86400000).toISOString();
    const invite = await c.get('repo').adminCreateInvite(uid(c), generateInviteCode(), body.max_uses, expiresAt, body.note || null);
    return c.json({ ...invite, display_code: formatInviteCode(invite.code) }, 201);
  });
  app.delete('/api/admin/invites/:id', async c => c.json(await c.get('repo').adminRevokeInvite(uid(c), z.uuid().parse(c.req.param('id')))));
  app.patch('/api/admin/users/:id', async c => {
    const body = userStatusSchema.parse(await c.req.json());
    return c.json(await c.get('repo').adminSetStatus(z.uuid().parse(c.req.param('id')), body.status, adminEmails(c.env)));
  });
  app.get('/api/library', async c => c.json(await c.get('repo').library()));
  app.get('/api/library/:id', async c => c.json(await c.get('repo').preview(c.req.param('id'))));
  app.get('/api/dashboard', async c => c.json(await c.get('repo').dashboard(uid(c))));
  app.get('/api/questions/daily', async c => c.json(await c.get('repo').daily(uid(c))));
  app.get('/api/groups/:id', async c => c.json(await c.get('repo').group(c.req.param('id'))));
  app.post('/api/sessions', async c => { const body = startSchema.parse(await c.req.json()); return c.json(await c.get('repo').start(uid(c),body.group_id,body.practice_type,body.question_ids)); });
  app.get('/api/sessions/:id', async c => c.json(await c.get('repo').session(uid(c),z.uuid().parse(c.req.param('id')))));
  app.patch('/api/sessions/:id', async c => c.json(await c.get('repo').save(uid(c),z.uuid().parse(c.req.param('id')),draftSchema.parse(await c.req.json()))));
  app.post('/api/sessions/:id/submit', async c => { const b = submitSchema.parse(await c.req.json()); return c.json(await c.get('repo').submit(uid(c),z.uuid().parse(c.req.param('id')),b.submission_id,b.revision)); });
  app.get('/api/sessions/:id/result', async c => c.json(await c.get('repo').result(uid(c),z.uuid().parse(c.req.param('id')))));
  app.get('/api/reviews/due', async c => c.json(await c.get('repo').due(uid(c))));
  app.post('/api/reviews/:id', async c => { const b = z.object({ error_category: errorCategorySchema.optional() }).strict().parse(await c.req.json()); return c.json(await c.get('repo').review(uid(c),c.req.param('id'),b.error_category)); });
  // Review grades use the same atomic session submission; the client cannot send is_correct.
  app.post('/api/reviews/:id/grade', async c => { const b = submitSchema.parse(await c.req.json()); const sid = z.uuid().parse(c.req.param('id')); const s = await c.get('repo').session(uid(c),sid); if (s.practice_type !== 'review') throw new ApiError(400,'REVIEW_SESSION_REQUIRED'); return c.json(await c.get('repo').submit(uid(c),sid,b.submission_id,b.revision)); });
  app.get('/api/stats', async c => c.json(await c.get('repo').stats(uid(c))));
  app.get('/api/mistakes', async c => {const query=mistakeQuerySchema.parse(c.req.query());return c.json(await c.get('repo').mistakes(uid(c),query.day,query.offset));});
  app.patch('/api/settings', async c => { const b = z.object({ daily_goal: z.number().int().min(1).max(50).optional(), selected_exam: z.enum(['CET6','KY1','JLPT_N1']).optional() }).strict().parse(await c.req.json()); if(b.selected_exam!==undefined)await c.get('repo').setExam(uid(c),b.selected_exam); if(b.daily_goal!==undefined)await c.get('repo').setGoal(uid(c),b.daily_goal); return c.json(b); });
  app.get('/api/annotations', async c => c.json(await c.get('repo').annotations(uid(c),c.req.query('passage_id'))));
  app.post('/api/annotations', async c => c.json(await c.get('repo').annotate(uid(c),annotationSchema.parse(await c.req.json())),201));
  app.delete('/api/annotations/:id',async c=>c.json(await c.get('repo').removeAnnotation(uid(c),z.uuid().parse(c.req.param('id')))));
  app.all('/api/*', c => c.json({ error: 'NOT_FOUND' },404));
  app.get('*', async c => { const response = await c.env.ASSETS.fetch(c.req.raw); const headers = new Headers(response.headers); headers.set('Cache-Control','private, no-store'); return new Response(response.body,{ status: response.status,headers }); });
  app.onError((error,c) => {
    if (error instanceof ApiError) return c.json({ error: error.code }, error.status as 400);
    if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ error: 'INVALID_INPUT' },400);
    const message = error.message;
    // Database errors can contain connection details: expose only known domain codes.
    for (const [code,status] of Object.entries(domainErrors)) if (message.includes(code)) return c.json({ error: code },status as 400);
    console.error('cet6_request_failed', { name: error.name });
    return c.json({ error: 'SERVICE_UNAVAILABLE' },503);
  });
  return app;
}
