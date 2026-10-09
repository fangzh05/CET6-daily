export class RequestError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
const messages: Record<string,string> = {
  AUTH_REQUIRED:'请登录后重试。', INVALID_ACCESS_TOKEN:'登录已过期，请重新登录。', EMAIL_NOT_ALLOWED:'当前邮箱无权访问。',
  HOST_NOT_ALLOWED:'此域名尚未配置访问权限。', ACCESS_NOT_CONFIGURED:'Cloudflare Access 尚未配置。', DATABASE_NOT_CONFIGURED:'尚未连接 Neon 数据库。配置后即可导入真实题库。',
  DEVELOPMENT_DATABASE_MISMATCH:'开发数据库端点未通过隔离检查。', SERVICE_UNAVAILABLE:'服务暂时不可用，请稍后重试。本机草稿仍保留。',
  REVISION_CONFLICT:'此练习已在另一设备更新。请选择要保留的草稿。', GROUP_NOT_VERIFIED:'此题组的答案尚未核验，暂时无法练习。',
  ALREADY_SUBMITTED:'此练习已经提交，请打开结果。', NO_DUE_REVIEWS:'暂无可复习的到期题目。', INVALID_INPUT:'输入格式有误，请检查后重试。'
};
export const friendly = (error: unknown) => error instanceof RequestError ? (messages[error.code] ?? `请求未完成（${error.code}）`) : '网络连接失败。本机草稿已保留，请恢复连接后重试。';
export async function api<T>(path:string,method='GET',body?:unknown):Promise<T> {
  const response=await fetch(`/api${path}`,{method,credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if (!response.headers.get('content-type')?.includes('application/json')) throw new RequestError(401,'AUTH_REQUIRED');
  const value=await response.json() as {error?:string}; if(!response.ok) throw new RequestError(response.status,value.error ?? 'SERVICE_UNAVAILABLE'); return value as T;
}
