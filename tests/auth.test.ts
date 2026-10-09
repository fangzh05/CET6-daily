import { beforeAll, describe, it, expect } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { authenticate, type Env } from '../worker/auth';
import { database } from '../worker/db';
import { developmentGuard } from '../scripts/db-guard';
describe('Access JWT and production isolation',()=>{
  let privateKey:CryptoKey;let resolver:ReturnType<typeof createLocalJWKSet>;
  const env={APP_ENV:'production',LOCAL_DEV_AUTH:'false',ACCESS_ISSUER:'https://test.cloudflareaccess.com',ACCESS_AUDIENCE:'test-aud',ALLOWED_EMAILS:'owner@example.com',ALLOWED_HOSTS:'cet6.example.com'} as Env;
  const req=(token?:string,url='https://cet6.example.com/api/me')=>new Request(url,{headers:token?{'Cf-Access-Jwt-Assertion':token}:{}});
  const token=(override:Record<string,unknown>={})=>new SignJWT({email:'owner@example.com',...override}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('stable-subject').setIssuer(env.ACCESS_ISSUER!).setAudience(env.ACCESS_AUDIENCE!).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  beforeAll(async()=>{const keys=await generateKeyPair('RS256');privateKey=keys.privateKey;resolver=createLocalJWKSet({keys:[{...await exportJWK(keys.publicKey),kid:'test',alg:'RS256'}]});});
  it('accepts a verified stable subject and permitted email',async()=>{const u=await authenticate(req(await token()),env,resolver);expect(u.identity).toBe('https://test.cloudflareaccess.com:stable-subject');});
  it('rejects absent, forged, expired, wrong issuer/audience and disallowed email tokens',async()=>{
    await expect(authenticate(req(),env,resolver)).rejects.toThrow('AUTH_REQUIRED');await expect(authenticate(req('forged'),env,resolver)).rejects.toThrow('INVALID_ACCESS_TOKEN');
    for(const signed of [await new SignJWT({email:'owner@example.com'}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('s').setIssuer(env.ACCESS_ISSUER!).setAudience('wrong').setIssuedAt().setExpirationTime('5m').sign(privateKey),await new SignJWT({email:'owner@example.com'}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('s').setIssuer('https://wrong.cloudflareaccess.com').setAudience('test-aud').setIssuedAt().setExpirationTime('5m').sign(privateKey),await new SignJWT({email:'owner@example.com'}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('s').setIssuer(env.ACCESS_ISSUER!).setAudience('test-aud').setIssuedAt().setExpirationTime(1).sign(privateKey)]) await expect(authenticate(req(signed),env,resolver)).rejects.toThrow('INVALID_ACCESS_TOKEN');
    await expect(authenticate(req(await token({email:'stranger@example.com'})),env,resolver)).rejects.toThrow('EMAIL_NOT_ALLOWED');
  });
  it('rejects dev identity on any remote hostname and on production localhost',async()=>{
    await expect(authenticate(req(undefined,'https://remote.invalid'),{...env,APP_ENV:'development',LOCAL_DEV_AUTH:'true'})).rejects.toThrow('AUTH_CONFIGURATION_INVALID');
    await expect(authenticate(req(undefined,'http://localhost'),{...env,LOCAL_DEV_AUTH:'true'})).rejects.toThrow('AUTH_CONFIGURATION_INVALID');
    await expect(authenticate(req(undefined,'https://cet6.workers.dev'),env)).rejects.toThrow('HOST_NOT_ALLOWED');
    expect((await authenticate(req(undefined,'http://localhost'),{...env,APP_ENV:'development',LOCAL_DEV_AUTH:'true'})).identity).toBe('local-development:primary');
  });
  it('refuses mismatched development endpoints and unmarked production migrations',()=>{
    expect(()=>database({...env,APP_ENV:'development',DATABASE_URL:'postgresql://u:p@ep-production.aws.neon.tech/db',DEVELOPMENT_DATABASE_HOST:'ep-dev.aws.neon.tech'})).toThrow('DEVELOPMENT_DATABASE_MISMATCH');
    expect(()=>developmentGuard({DATABASE_ENV:'production'})).toThrow('never target production');
    expect(()=>developmentGuard({DATABASE_ENV:'development',DATABASE_URL:'postgresql://u:p@ep-prod.aws.neon.tech/db',DEVELOPMENT_DATABASE_HOST:'ep-dev.aws.neon.tech'})).toThrow('mismatch');
  });
});
