export class RequestError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
const messages: Record<string,string> = {
  AUTH_REQUIRED:'请登录后重试。', INVALID_ACCESS_TOKEN:'登录已过期，请重新登录。', EMAIL_NOT_ALLOWED:'当前邮箱无权访问。',
  HOST_NOT_ALLOWED:'此域名尚未配置访问权限。', ACCESS_NOT_CONFIGURED:'Cloudflare Access 尚未配置。', DATABASE_NOT_CONFIGURED:'尚未连接 Neon 数据库。配置后即可导入真实题库。',
  DEVELOPMENT_DATABASE_MISMATCH:'开发数据库端点未通过隔离检查。', SERVICE_UNAVAILABLE:'服务暂时不可用，请稍后重试。本机草稿仍保留。',
  REVISION_CONFLICT:'此练习已在另一设备更新。请选择要保留的草稿。', GROUP_NOT_VERIFIED:'此题组的答案尚未核验，暂时无法练习。',
  ALREADY_SUBMITTED:'此练习已经提交，请打开结果。', NO_DUE_REVIEWS:'暂无可复习的到期题目。', INVALID_INPUT:'输入格式有误，请检查后重试。',
  INVITE_REQUIRED:'这个邮箱还没有账号，请输入邀请码激活。', ACCOUNT_DISABLED:'账号已被停用，请联系管理员。',
  ADMIN_REQUIRED:'只有管理员可以访问这个页面。', ADMIN_PROTECTED:'管理员账号不能被停用。',
  INVITE_INVALID:'邀请码无效，请核对后重试。', INVITE_EXPIRED:'邀请码已过期，请向管理员索取新的邀请码。',
  INVITE_REVOKED:'邀请码已被撤销。', INVITE_EXHAUSTED:'邀请码已被用完。', EMAIL_ALREADY_REGISTERED:'这个邮箱已经注册过了。',
  INVITE_NOT_FOUND:'邀请码不存在或已被撤销。', USER_NOT_FOUND:'找不到这个用户。'
};
export const friendly = (error: unknown) => error instanceof RequestError ? (messages[error.code] ?? `请求未完成（${error.code}）`) : '网络连接失败。本机草稿已保留，请恢复连接后重试。';
export async function api<T>(path:string,method='GET',body?:unknown):Promise<T> {
  // Every write declares JSON explicitly, including body-less deletes: the
  // Worker rejects non-JSON content types on mutations.
  const headers:Record<string,string>=method==='GET'||method==='HEAD'?{}:{'Content-Type':'application/json'};
  const response=await fetch(`/api${path}`,{method,credentials:'same-origin',cache:'no-store',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if (!response.headers.get('content-type')?.includes('application/json')) throw new RequestError(401,'AUTH_REQUIRED');
  const value=await response.json() as {error?:string}; if(!response.ok) throw new RequestError(response.status,value.error ?? 'SERVICE_UNAVAILABLE'); return value as T;
}
