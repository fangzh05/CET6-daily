import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
export type Env = {
  DATABASE_URL?: string; APP_ENV: string; LOCAL_DEV_AUTH?: string; DEV_EMAIL?: string;
  DEVELOPMENT_DATABASE_HOST?: string; ACCESS_ISSUER?: string; ACCESS_AUDIENCE?: string;
  ALLOWED_EMAILS?: string; ALLOWED_HOSTS?: string; ASSETS: Fetcher;
  IDENTITY_ALIASES?: string;
};
export type Identity = { identity: string; email: string };
export class ApiError extends Error { constructor(public status: number, public code: string) { super(code); } }
const keys = new Map<string, JWTVerifyGetKey>();
const list = (value?: string) => (value ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
// Identity migration support. A user's rows are keyed by the single unique
// column `users.identity`. The Sites deployment used `sites:<openai-id>`;
// standalone Access derives `<issuer>:<sub>`. Signing in with the new value
// would insert a second users row and orphan every session, attempt,
// review_state and annotation of the original user.
// IDENTITY_ALIASES pins a verified email to the pre-existing identity so the
// same users.id is resolved. Format: "email=identity,email=identity".
// Entries are only honoured after the Access JWT (issuer, audience, RS256
// signature, exp and email allowlist) has already been verified.
export function parseIdentityAliases(value?: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of (value ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    const email = entry.slice(0, separator).trim().toLowerCase();
    const identity = entry.slice(separator + 1).trim();
    if (email && identity) map.set(email, identity);
  }
  return map;
}
export async function authenticate(request: Request, env: Env, keyOverride?: JWTVerifyGetKey): Promise<Identity> {
  const url = new URL(request.url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (local && env.APP_ENV === 'development' && env.LOCAL_DEV_AUTH === 'true') {
    return { identity: 'local-development:primary', email: env.DEV_EMAIL || 'local@cet6.invalid' };
  }
  if (env.APP_ENV !== 'production' || env.LOCAL_DEV_AUTH === 'true') throw new ApiError(403, 'AUTH_CONFIGURATION_INVALID');
  if (!list(env.ALLOWED_HOSTS).includes(url.hostname.toLowerCase())) throw new ApiError(403, 'HOST_NOT_ALLOWED');
  if (!env.ACCESS_ISSUER || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER) || !env.ACCESS_AUDIENCE || !list(env.ALLOWED_EMAILS).length) throw new ApiError(503, 'ACCESS_NOT_CONFIGURED');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new ApiError(401, 'AUTH_REQUIRED');
  let jwks = keyOverride ?? keys.get(env.ACCESS_ISSUER);
  if (!jwks) { jwks = createRemoteJWKSet(new URL(`${env.ACCESS_ISSUER}/cdn-cgi/access/certs`), { timeoutDuration: 5000 }); keys.set(env.ACCESS_ISSUER, jwks); }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUDIENCE, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat', 'email'], clockTolerance: 5 });
    if (!payload.sub || typeof payload.email !== 'string') throw new Error('claims');
    if (!list(env.ALLOWED_EMAILS).includes(payload.email.toLowerCase())) throw new ApiError(403, 'EMAIL_NOT_ALLOWED');
    const email = payload.email.toLowerCase();
    // Preserve the original users.id when this email was already migrated.
    const canonical = parseIdentityAliases(env.IDENTITY_ALIASES).get(email);
    return { identity: canonical ?? `${env.ACCESS_ISSUER}:${payload.sub}`, email };
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(401, 'INVALID_ACCESS_TOKEN'); }
}
export function checkOrigin(request: Request): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (request.headers.get('Origin') !== new URL(request.url).origin) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED');
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new ApiError(415, 'JSON_REQUIRED');
}
