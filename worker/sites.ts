import { createApp } from './app';
import { ApiError, type Env } from './auth';

// This entry point is hosted only behind the owner-private Sites dispatcher.
// It is never used by the standalone Wrangler configuration.
export async function sitesIdentity(request: Request, env: Env) {
  if (env.APP_ENV !== 'production' || env.LOCAL_DEV_AUTH === 'true') throw new ApiError(403,'AUTH_CONFIGURATION_INVALID');
  if (!(env.ALLOWED_HOSTS ?? '').split(',').includes(new URL(request.url).hostname)) throw new ApiError(403,'HOST_NOT_ALLOWED');
  const id=request.headers.get('oai-authenticated-user-id');
  const email=request.headers.get('oai-authenticated-user-email');
  if (!id || !email) throw new ApiError(401,'AUTH_REQUIRED');
  return {identity:`sites:${id}`,email:email.toLowerCase()};
}
export default createApp({authenticate:sitesIdentity});
