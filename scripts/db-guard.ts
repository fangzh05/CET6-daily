export function developmentGuard(env: NodeJS.ProcessEnv, direct = false): string {
  const url = direct ? env.DATABASE_DIRECT_URL : env.DATABASE_URL;
  if (!url || env.DATABASE_ENV !== 'development' || !env.DEVELOPMENT_DATABASE_HOST) throw new Error('Set DATABASE_ENV=development and DEVELOPMENT_DATABASE_HOST. These tools never target production.');
  const host = new URL(url).hostname;
  const directHost = host.replace('-pooler.', '.');
  const expected = env.DEVELOPMENT_DATABASE_HOST.replace('-pooler.', '.');
  if (!host.endsWith('.neon.tech') || directHost !== expected) throw new Error('Development endpoint mismatch; refusing database write.');
  if (direct && host.includes('-pooler.')) throw new Error('Migrations require the direct Neon endpoint.');
  return url;
}
export function databaseGuard(env:NodeJS.ProcessEnv,reviewedProduction:boolean,direct=false):string {
  if(!reviewedProduction)return developmentGuard(env,direct);
  const value=direct?env.DATABASE_DIRECT_URL:env.DATABASE_URL;
  if(!value||env.DATABASE_ENV!=='production'||!env.PRODUCTION_DATABASE_HOST)throw new Error('Reviewed production execution requires DATABASE_ENV=production and PRODUCTION_DATABASE_HOST.');
  const host=new URL(value).hostname;const normalized=host.replace('-pooler.','.');
  if(!host.endsWith('.neon.tech')||normalized!==env.PRODUCTION_DATABASE_HOST.replace('-pooler.','.')||normalized===env.DEVELOPMENT_DATABASE_HOST?.replace('-pooler.','.'))throw new Error('Production/development endpoint mismatch.');
  if(direct&&host.includes('-pooler.'))throw new Error('Production migrations require a direct endpoint.');
  return value;
}
