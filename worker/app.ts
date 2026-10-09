import { Hono } from 'hono';
import { z, ZodError } from 'zod';
import { annotationSchema, draftSchema, startSchema, submitSchema, errorCategorySchema } from '../shared/contracts';
import { ApiError, authenticate, checkOrigin, type Env, type Identity } from './auth';
import { database, type Database } from './db';
import { Repository } from './repository';
type Variables = { repo: Repository; user: { id: string; email: string } };
type Dependencies = { db?: Database; authenticate?: (request: Request, env: Env) => Promise<Identity> };
const domainErrors: Record<string, number> = {
  SESSION_NOT_FOUND: 404, GROUP_NOT_VERIFIED: 409, REVISION_CONFLICT: 409, ALREADY_SUBMITTED: 409,
  ALREADY_PRACTICED: 409, NO_DUE_REVIEWS: 409, RETRY_REQUIRES_HISTORY: 409, FULL_GROUP_REQUIRED: 400,
  INVALID_PRACTICE_TYPE: 400, INVALID_DRAFT: 400, INVALID_QUESTION: 400, INVALID_ANSWER: 400, DUPLICATE_CLOZE_WORD: 400
};
export function createApp(deps: Dependencies = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store'); c.header('Vary', 'Cf-Access-Jwt-Assertion, Cookie');
    c.header('X-Content-Type-Options', 'nosniff'); c.header('Referrer-Policy', 'same-origin');
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const identity = await (deps.authenticate ?? authenticate)(c.req.raw, c.env);
    // Authenticate static assets too; assets.run_worker_first prevents alternate paths bypassing this.
    if (c.req.path.startsWith('/api/')) {
      checkOrigin(c.req.raw);
      const repo = new Repository(deps.db ?? database(c.env)); c.set('repo', repo); c.set('user', await repo.user(identity));
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
  app.get('/api/me', c => c.json(c.get('user')));
  app.get('/api/library', async c => c.json(await c.get('repo').library()));
  app.get('/api/library/:id', async c => c.json(await c.get('repo').preview(c.req.param('id'))));
  app.get('/api/dashboard', async c => c.json(await c.get('repo').dashboard(c.get('user').id)));
  app.get('/api/questions/daily', async c => c.json(await c.get('repo').daily(c.get('user').id)));
  app.get('/api/groups/:id', async c => c.json(await c.get('repo').group(c.req.param('id'))));
  app.post('/api/sessions', async c => { const body = startSchema.parse(await c.req.json()); return c.json(await c.get('repo').start(c.get('user').id,body.group_id,body.practice_type,body.question_ids)); });
  app.get('/api/sessions/:id', async c => c.json(await c.get('repo').session(c.get('user').id,z.uuid().parse(c.req.param('id')))));
  app.patch('/api/sessions/:id', async c => c.json(await c.get('repo').save(c.get('user').id,z.uuid().parse(c.req.param('id')),draftSchema.parse(await c.req.json()))));
  app.post('/api/sessions/:id/submit', async c => { const b = submitSchema.parse(await c.req.json()); return c.json(await c.get('repo').submit(c.get('user').id,z.uuid().parse(c.req.param('id')),b.submission_id,b.revision)); });
  app.get('/api/sessions/:id/result', async c => c.json(await c.get('repo').result(c.get('user').id,z.uuid().parse(c.req.param('id')))));
  app.get('/api/reviews/due', async c => c.json(await c.get('repo').due(c.get('user').id)));
  app.post('/api/reviews/:id', async c => { const b = z.object({ error_category: errorCategorySchema.optional() }).strict().parse(await c.req.json()); return c.json(await c.get('repo').review(c.get('user').id,c.req.param('id'),b.error_category)); });
  // Review grades use the same atomic session submission; the client cannot send is_correct.
  app.post('/api/reviews/:id/grade', async c => { const b = submitSchema.parse(await c.req.json()); const sid = z.uuid().parse(c.req.param('id')); const s = await c.get('repo').session(c.get('user').id,sid); if (s.practice_type !== 'review') throw new ApiError(400,'REVIEW_SESSION_REQUIRED'); return c.json(await c.get('repo').submit(c.get('user').id,sid,b.submission_id,b.revision)); });
  app.get('/api/stats', async c => c.json(await c.get('repo').stats(c.get('user').id)));
  app.patch('/api/settings', async c => { const b = z.object({ daily_goal: z.number().int().min(1).max(50) }).strict().parse(await c.req.json()); await c.get('repo').setGoal(c.get('user').id,b.daily_goal); return c.json(b); });
  app.get('/api/annotations', async c => c.json(await c.get('repo').annotations(c.get('user').id,c.req.query('passage_id'))));
  app.post('/api/annotations', async c => c.json(await c.get('repo').annotate(c.get('user').id,annotationSchema.parse(await c.req.json())),201));
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
