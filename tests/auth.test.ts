import { beforeAll, describe, it, expect } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { authenticate, adminEmails, isAdminEmail, parseIdentityAliases, type Env } from '../worker/auth';
import { database } from '../worker/db';
import { developmentGuard } from '../scripts/db-guard';
describe('Access JWT and production isolation',()=>{
  let privateKey:CryptoKey;let resolver:ReturnType<typeof createLocalJWKSet>;
  const env={APP_ENV:'production',LOCAL_DEV_AUTH:'false',ACCESS_ISSUER:'https://test.cloudflareaccess.com',ACCESS_AUDIENCE:'test-aud',ADMIN_EMAILS:'owner@example.com',ALLOWED_HOSTS:'cet6.example.com'} as Env;
  const req=(token?:string,url='https://cet6.example.com/api/me')=>new Request(url,{headers:token?{'Cf-Access-Jwt-Assertion':token}:{}});
  const token=(override:Record<string,unknown>={})=>new SignJWT({email:'owner@example.com',...override}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('stable-subject').setIssuer(env.ACCESS_ISSUER!).setAudience(env.ACCESS_AUDIENCE!).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  beforeAll(async()=>{const keys=await generateKeyPair('RS256');privateKey=keys.privateKey;resolver=createLocalJWKSet({keys:[{...await exportJWK(keys.publicKey),kid:'test',alg:'RS256'}]});});
  it('accepts a verified stable subject and permitted email',async()=>{const u=await authenticate(req(await token()),env,resolver);expect(u.identity).toBe('https://test.cloudflareaccess.com:stable-subject');});
  it('rejects absent, forged, expired and wrong issuer/audience tokens',async()=>{
    await expect(authenticate(req(),env,resolver)).rejects.toThrow('AUTH_REQUIRED');await expect(authenticate(req('forged'),env,resolver)).rejects.toThrow('INVALID_ACCESS_TOKEN');
    for(const signed of [await new SignJWT({email:'owner@example.com'}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('s').setIssuer(env.ACCESS_ISSUER!).setAudience('wrong').setIssuedAt().setExpirationTime('5m').sign(privateKey),await new SignJWT({email:'owner@example.com'}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('s').setIssuer('https://wrong.cloudflareaccess.com').setAudience('test-aud').setIssuedAt().setExpirationTime('5m').sign(privateKey),await new SignJWT({email:'owner@example.com'}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('s').setIssuer(env.ACCESS_ISSUER!).setAudience('test-aud').setIssuedAt().setExpirationTime(1).sign(privateKey)]) await expect(authenticate(req(signed),env,resolver)).rejects.toThrow('INVALID_ACCESS_TOKEN');
  });
  it('authenticates any Access-verified email; authorization belongs to the account layer',async()=>{
    // Multi-user: the token layer only proves the email. Whether an account
    // exists is decided per request in the routes (invite redemption), and
    // administrators are resolved from configuration only.
    const friend=await authenticate(req(await token({email:'friend@example.com'})),env,resolver);
    expect(friend).toEqual({identity:'https://test.cloudflareaccess.com:stable-subject',email:'friend@example.com'});
    expect(isAdminEmail(env,'FRIEND@example.com')).toBe(false);expect(isAdminEmail(env,'owner@example.com')).toBe(true);
    expect(adminEmails({...env,ADMIN_EMAILS:undefined})).toEqual([]);
    // The legacy single-owner name keeps older deployments working.
    expect(adminEmails({...env,ADMIN_EMAILS:undefined,ALLOWED_EMAILS:'legacy@example.com, second@example.com'})).toEqual(['legacy@example.com','second@example.com']);
  });
  it('rejects dev identity on any remote hostname and on production localhost',async()=>{
    await expect(authenticate(req(undefined,'https://remote.invalid'),{...env,APP_ENV:'development',LOCAL_DEV_AUTH:'true'})).rejects.toThrow('AUTH_CONFIGURATION_INVALID');
    await expect(authenticate(req(undefined,'http://localhost'),{...env,LOCAL_DEV_AUTH:'true'})).rejects.toThrow('AUTH_CONFIGURATION_INVALID');
    await expect(authenticate(req(undefined,'https://cet6.workers.dev'),env)).rejects.toThrow('HOST_NOT_ALLOWED');
    expect((await authenticate(req(undefined,'http://localhost'),{...env,APP_ENV:'development',LOCAL_DEV_AUTH:'true'})).identity).toBe('local-development:primary');
  });
  it('preserves the original users.id when Sites identities migrate to Access',async()=>{
    // The canonical identity must be resolved from the alias map, otherwise the
    // new Access identity inserts a second users row and orphans prior history.
    const migrated={...env,IDENTITY_ALIASES:'owner@example.com=sites:legacy-openai-id'};
    expect((await authenticate(req(await token()),migrated,resolver)).identity).toBe('sites:legacy-openai-id');
    // With no alias the derivable Access identity is used unchanged.
    expect((await authenticate(req(await token()),env,resolver)).identity).toBe('https://test.cloudflareaccess.com:stable-subject');
    // Aliases only apply to the exact verified email, never to others.
    const both={...migrated,ADMIN_EMAILS:'owner@example.com,other@example.com'};
    expect((await authenticate(req(await token({email:'other@example.com'})),both,resolver)).identity).toBe('https://test.cloudflareaccess.com:stable-subject');
    expect((await authenticate(req(await token({email:'stranger@example.com'})),migrated,resolver)).identity).toBe('https://test.cloudflareaccess.com:stable-subject');
    // Malformed entries are ignored instead of failing the request.
    expect((await authenticate(req(await token()),{...env,IDENTITY_ALIASES:'=x,owner@example.com=,nonsense'},resolver)).identity).toBe('https://test.cloudflareaccess.com:stable-subject');
    expect(parseIdentityAliases('A@Example.com=sites:1, b@example.com = https://t.cloudflareaccess.com:2 ')).toEqual(new Map([['a@example.com','sites:1'],['b@example.com','https://t.cloudflareaccess.com:2']]));
  });
  it('refuses mismatched development endpoints and unmarked production migrations',()=>{
    expect(()=>database({...env,APP_ENV:'development',DATABASE_URL:'postgresql://u:p@ep-production.aws.neon.tech/db',DEVELOPMENT_DATABASE_HOST:'ep-dev.aws.neon.tech'})).toThrow('DEVELOPMENT_DATABASE_MISMATCH');
    expect(()=>developmentGuard({DATABASE_ENV:'production'})).toThrow('never target production');
    expect(()=>developmentGuard({DATABASE_ENV:'development',DATABASE_URL:'postgresql://u:p@ep-prod.aws.neon.tech/db',DEVELOPMENT_DATABASE_HOST:'ep-dev.aws.neon.tech'})).toThrow('mismatch');
  });
});
