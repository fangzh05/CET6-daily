import { describe,it,expect } from 'vitest';
import { sitesIdentity } from '../worker/sites';
import { authenticate,type Env } from '../worker/auth';
describe('isolated Sites entry point',()=>{
  const env={APP_ENV:'production',LOCAL_DEV_AUTH:'false',ALLOWED_HOSTS:'cet6.example.chatgpt.site'} as Env;
  const request=(host='cet6.example.chatgpt.site',identity=true)=>new Request(`https://${host}/api/me`,{headers:identity?{'oai-authenticated-user-id':'stable-owner','oai-authenticated-user-email':'owner@example.com'}:{}});
  it('requires dispatch identity and the exact configured host',async()=>{
    expect(await sitesIdentity(request(),env)).toEqual({identity:'sites:stable-owner',email:'owner@example.com'});
    await expect(sitesIdentity(request(undefined,false),env)).rejects.toThrow('AUTH_REQUIRED');
    await expect(sitesIdentity(request('alternate.workers.dev'),env)).rejects.toThrow('HOST_NOT_ALLOWED');
    await expect(sitesIdentity(request(),{...env,LOCAL_DEV_AUTH:'true'})).rejects.toThrow('AUTH_CONFIGURATION_INVALID');
  });
  it('standalone Access entry never accepts Sites headers',async()=>{
    await expect(authenticate(request(),{...env,ACCESS_ISSUER:'https://owner.cloudflareaccess.com',ACCESS_AUDIENCE:'a',ALLOWED_EMAILS:'owner@example.com'})).rejects.toThrow('AUTH_REQUIRED');
  });
});
