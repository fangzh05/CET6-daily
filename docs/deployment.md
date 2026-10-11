# 部署、认证、数据库隔离与恢复

## Neon

创建专用 CET6 Daily 项目。production 正式分支、development 开发分支分别记录精确 endpoint host。不要复用 WordLoop 数据库。当前专用项目为 lingering-sound-78376612，AWS Singapore，PostgreSQL 18；production 与 development 分支已建立并分别迁移。已验证真实 HTTP 连接和事务失败回滚。

development `.env.local` 使用 `.env.example`，`DATABASE_ENV=development`；生产命令使用独立未提交 `.env.production.local`：`DATABASE_ENV=production`、`DATABASE_URL`、直接连接 `DATABASE_DIRECT_URL`、`PRODUCTION_DATABASE_HOST`、`DEVELOPMENT_DATABASE_HOST`。

```sh
npx tsx --env-file=.env.production.local scripts/migrate.ts --production-reviewed
npx tsx --env-file=.env.production.local scripts/import-bank.ts --import --bank /path/to/bank --production-reviewed --expected-commit EXACT_REVIEWED_SOURCE_COMMIT
```

上线前先在 development 应用全部迁移，检查重复迁移、导入、并发草稿、重复提交与故障回滚。生产迁移须审核 SQL；禁止 destructive schema push。迁移器检查已部署哈希，所有待迁移 SQL 与 journal 在同一个 HTTP transaction 内执行，advisory lock 防并发；失败重新执行。2026-10-09 已在 development 验证 HTTP 事务内建表、插入后故意除零失败，确认表也回滚不存在。

## Sites（当前选择）

`.openai/hosting.json` 已绑定专用私有站点，不能创建替代站点。用户已同意 ChatGPT 登录、仅本人访问。runtime 配置存 Sites 环境管理：`APP_ENV=production`、`LOCAL_DEV_AUTH=false`、精确 `ALLOWED_HOSTS` 和 secret `DATABASE_URL`。没有 D1。

`npm run build` 生成 dist/client 静态资源与 dist/server/index.js Worker。通过 Sites workflow 推送准确源码并打包，再保存版本、私有部署。环境变更也需要重新部署。平台 dispatcher 执行登录和 owner-only 策略并注入稳定身份；应用校验存在身份、host 与生产配置，每个业务 SQL 继续校验用户归属。

Sites 专用入口必须只在该 dispatcher 后运行。身份 header 的安全性依赖平台移除/覆盖外来 header 和私有访问策略，不能把 worker/sites.ts 部署到可被直接调用的公共 Worker。独立入口不会接受 Sites 身份 header。服务凭证没有用户身份，不能用于读取个人学习记录。

## 独立 Cloudflare Access

使用 wrangler.jsonc 的 production。配置应用域名并启用 Access self-hosted application，仅 allow 指定邮箱；任何公开别名都需同等保护。workers.dev 和 preview URL 已关闭。

自有域名 `zehaoo.top` 已托管于 Cloudflare（zone `170f612abe27b88962aa0a957b7310db`，NS 已由 Spaceship 切至 `devin/gemma.ns.cloudflare.com`）。CET6 Daily 使用独立子域，先在 `cet6-test.zehaoo.top` 验收，通过后再启用 `cet6.zehaoo.top`（wrangler.jsonc 的 routes 已按此顺序分阶段书写）。同一 zone 下的其他项目不受影响：路由是精确主机名，不覆盖通配符。

设置 secret DATABASE_URL；设置 `ACCESS_ISSUER=https://TEAM.cloudflareaccess.com`、`ACCESS_AUDIENCE`、`ADMIN_EMAILS`（管理员邮箱，历史名称为 `ALLOWED_EMAILS`，仍兼容）、`ALLOWED_HOSTS`。Worker 校验 RS256 签名、issuer、audience、exp、iat、sub 和 email。所有静态请求也运行 Worker 验证，API 默认 private,no-store。禁止浏览器数据库直连或生产 LOCAL_DEV_AUTH。

`ALLOWED_HOSTS` 必须逐字列出实际使用的主机；未列入的 Host 直接 403 HOST_NOT_ALLOWED。Access 应用需覆盖静态资源与全部 `/api` 路径，否则静态资源不会被保护。

`npm run deploy` 先完整 check 再部署。

### 身份迁移：Sites → Access

`users.identity` 是唯一键。Sites 入口写入 `sites:<openai-user-id>`，Access 入口推导 `<issuer>:<sub>`。两者不同，若直接以 Access 身份登录会插入第二条 users 记录，使历史 sessions、attempts、review_states、annotations 全部孤立。

`IDENTITY_ALIASES` 把**已通过签名与邮箱校验**的 email 固定到既有 identity，从而复用原 `users.id`。格式为逗号分隔的 `email=identity`：

```
IDENTITY_ALIASES="owner@example.com=sites:XXXXXXXXXXXXXXXX"
```

该值必须来自既有生产数据（`select identity from users`），不得猜测。它是纯配置、不改数据库：移除该 secret 即回到未映射状态，原 users 行与其历史始终不变。未配置时行为与之前完全一致。若生产 `users` 表为空，则无需任何映射。

## 多用户与邀请码（invite-only）

账号准入分两层。**Cloudflare Access 只负责证明邮箱归属**：应用策略允许任意邮箱使用 One-time PIN 登录（`Everyone` + Allow）。**应用层决定谁拥有账号**，只有两类身份能获得 `users` 行：

1. **管理员**：`ADMIN_EMAILS` 中列出的邮箱，首次请求由 Worker 自动建档（`provisionAdmin`）。管理员是纯配置，不存数据库、不可被停用（接口返回 `ADMIN_PROTECTED`）。
2. **受邀用户**：任何其他邮箱登录后只能看到激活页。必须在 `/api/access/redeem` 提交邀请码，由 SQL 函数 `cet6_redeem_invite` 在一个事务内校验并建档（行锁保证并发下不重复消费）。

未建档或已停用的身份访问其他所有 `/api/*` 路由返回 `403 INVITE_REQUIRED` / `ACCOUNT_DISABLED`，静态资源不受影响但读取不到任何数据；`/api/me` 与 `/api/access/redeem` 是仅有的两个例外。

邀请码由管理员在应用内「管理」页签发：`CET6-XXXX-XXXX-XXXX` 形式，12 位随机字符（32 字符无歧义字母表，约 60 bit），可选可用次数（1–50）与有效期（7/30 天或长期），可随时撤销。码在库中以去分隔符的大写形式存储（`invites.code`），前端输入时自动归一化。兑换记录写入 `invite_redemptions`，管理台显示每个码的兑换人。

运维要点：

- **切换既有单用户为多用户时**，需要在 Cloudflare Zero Trust 控制台做三处调整：
  1. **Settings → Authentication → Login methods**：确认 **One-time PIN** 已启用（这是让任意邮箱自助登录的前提；只保留 Cloudflare 账户登录时，只有 Cloudflare 用户能进来）。
  2. **Access → Applications → CET6 Daily → Authentication（Identity providers）**：把 **One-time PIN** 加入该应用的登录方式。
  3. **Access → Applications → CET6 Daily → Policies**：把原来的单邮箱策略改为 Decision=Allow、Include=**Everyone**（如仍想收紧，可保留邮箱清单，此时邀请码成为第二道闸门）。
  这一步改变了安全边界：任何人都能通过邮箱验证到达激活页，但**没有邀请码就拿不到任何数据**。
- 每个通过 Access 验证的邮箱都计入免费版 50 用户额度（含只停在激活页的人），必要时在 Zero Trust 中清理。
- `users.status`（`active`/`disabled`）由管理台切换；停用立即生效（每个请求重新校验），数据保留。
- 邀请码是 bearer 凭证，等同口令：不要在公开渠道张贴超过所需范围的码；泄露后立即在管理台撤销。
- 回滚：删除 `ADMIN_EMAILS` 并不能恢复旧行为，需同时把 Access 策略改回单邮箱 allow 并重新部署上一个版本；数据库新增列与表**不删除**，旧代码会忽略它们（`users.status` 有默认值 `active`）。

### 迁移校验与换行符（Windows 工作副本）

`drizzle.__drizzle_migrations` 记录的是每个迁移文件的 **sha256（精确字节）**，`.gitattributes` 因此把 `/db/migrations/*.sql` 标为 `-text`。若历史上曾在 CRLF 工作副本上执行过迁移，而仓库中保存的是 LF，`scripts/migrate.ts` 会以 `Applied migration changed` 拒绝继续。

处理方式（已在本仓库生产库执行过一次）：先用本地脚本逐行核对，确认差异**仅是换行符**（`sha256(CRLF 变体) === 库中记录值`），把旧值备份到本地文件，再在单个事务里把记录更新为仓库规范字节的哈希。不要通过改写迁移文件或改写工作副本来绕过校验。

### 多用户表结构（Migration 0005）

```sql
users.status text not null default 'active' check (status in ('active','disabled'))
invites(id, code unique, note, created_by → users, max_uses 1..50, used_count, expires_at, revoked_at, created_at)
invite_redemptions(invite_id, user_id, redeemed_at)  -- 主键 (invite_id,user_id)
```

`cet6_redeem_invite(identity, email, code)` 的失败码直接映射 HTTP 状态：`INVITE_INVALID`/`INVITE_EXPIRED`/`INVITE_REVOKED` 400、`INVITE_EXHAUSTED`/`EMAIL_ALREADY_REGISTERED` 409。已建档身份重复提交任意码是幂等的（返回自己的账号，不消耗码）。

## 备份与恢复

启用并确认当前 Neon 套餐的 point-in-time restore 保留窗口，不假设免费套餐长期保留。重要迁移前创建数据库恢复分支，记录源 branch 和恢复时间。定期用 PostgreSQL 官方 pg_dump 的 custom 格式输出到加密、访问受限的独立备份位置；连接字符串通过未提交环境传递，不写命令历史或日志。

恢复时从时间点创建新的隔离分支，或 pg_restore 到新的 development 数据库；先验证用户、会话、attempts、review_states 数量和外键、migration journal、典型成绩。只在确认后切换生产 DATABASE_URL 并重新部署；保留原端点作短期回退。不得覆盖生产或删除旧分支后才开始验证。备份需包含个人学习表和题库版本快照，源码 Commit 与导入来源另行保存。本文是操作流程，未声称已执行远程备份。

## 上线验证

实际验证登录/未授权/别名，Neon HTTP 连通与迁移、重复提交和注入故障回滚，数据库冷启动延迟、超时恢复，iOS Safari 与两设备草稿同步。记录实际延迟数据后再决定是否增加基础设施。当前没有 Redis/Hyperdrive 或额外缓存层。
