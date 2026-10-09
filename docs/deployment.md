# 部署、认证、数据库隔离与恢复

## Neon

创建专用 CET6 Daily 项目。production 正式分支、development 开发分支分别记录精确 endpoint host。不要复用 WordLoop 数据库。账户、区域和连接须在 Neon 实际建立后验证；目前没有远程连接验收。

development `.env.local` 使用 `.env.example`，`DATABASE_ENV=development`；生产命令使用独立未提交 `.env.production.local`：`DATABASE_ENV=production`、`DATABASE_URL`、直接连接 `DATABASE_DIRECT_URL`、`PRODUCTION_DATABASE_HOST`、`DEVELOPMENT_DATABASE_HOST`。

```sh
npx tsx --env-file=.env.production.local scripts/migrate.ts --production-reviewed
npx tsx --env-file=.env.production.local scripts/import-bank.ts --import --bank /path/to/bank --production-reviewed --expected-commit EXACT_REVIEWED_SOURCE_COMMIT
```

上线前先在 development 应用全部迁移，检查重复迁移、导入、并发草稿、重复提交与故障回滚。生产迁移须审核 SQL；禁止 destructive schema push。迁移器检查已部署哈希，所有待迁移 SQL 与 journal 在同一个 HTTP transaction 内执行，advisory lock 防并发；失败重新执行。Neon HTTP 实际事务行为仍需远程验收。

## Sites（当前选择）

`.openai/hosting.json` 已绑定专用私有站点，不能创建替代站点。用户已同意 ChatGPT 登录、仅本人访问。runtime 配置存 Sites 环境管理：`APP_ENV=production`、`LOCAL_DEV_AUTH=false`、精确 `ALLOWED_HOSTS` 和 secret `DATABASE_URL`。没有 D1。

`npm run build` 生成 dist/client 静态资源与 dist/server/index.js Worker。通过 Sites workflow 推送准确源码并打包，再保存版本、私有部署。环境变更也需要重新部署。平台 dispatcher 执行登录和 owner-only 策略并注入稳定身份；应用校验存在身份、host 与生产配置，每个业务 SQL 继续校验用户归属。

Sites 专用入口必须只在该 dispatcher 后运行。身份 header 的安全性依赖平台移除/覆盖外来 header 和私有访问策略，不能把 worker/sites.ts 部署到可被直接调用的公共 Worker。独立入口不会接受 Sites 身份 header。服务凭证没有用户身份，不能用于读取个人学习记录。

## 独立 Cloudflare Access

使用 wrangler.jsonc 的 production。配置应用域名并启用 Access self-hosted application，仅 allow 指定邮箱；任何公开别名都需同等保护。workers.dev 和 preview URL 已关闭。

设置 secret DATABASE_URL；设置 `ACCESS_ISSUER=https://TEAM.cloudflareaccess.com`、`ACCESS_AUDIENCE`、`ALLOWED_EMAILS`、`ALLOWED_HOSTS`。Worker 校验 RS256 签名、issuer、audience、exp、iat、sub 和 email。所有静态请求也运行 Worker 验证，API 默认 private,no-store。禁止浏览器数据库直连或生产 LOCAL_DEV_AUTH。

`npm run deploy` 先完整 check 再部署。当前账号没有 Access 配置权限，Access 应用/域名尚未远程配置。

## 备份与恢复

启用并确认当前 Neon 套餐的 point-in-time restore 保留窗口，不假设免费套餐长期保留。重要迁移前创建数据库恢复分支，记录源 branch 和恢复时间。定期用 PostgreSQL 官方 pg_dump 的 custom 格式输出到加密、访问受限的独立备份位置；连接字符串通过未提交环境传递，不写命令历史或日志。

恢复时从时间点创建新的隔离分支，或 pg_restore 到新的 development 数据库；先验证用户、会话、attempts、review_states 数量和外键、migration journal、典型成绩。只在确认后切换生产 DATABASE_URL 并重新部署；保留原端点作短期回退。不得覆盖生产或删除旧分支后才开始验证。备份需包含个人学习表和题库版本快照，源码 Commit 与导入来源另行保存。本文是操作流程，未声称已执行远程备份。

## 上线验证

实际验证登录/未授权/别名，Neon HTTP 连通与迁移、重复提交和注入故障回滚，数据库冷启动延迟、超时恢复，iOS Safari 与两设备草稿同步。记录实际延迟数据后再决定是否增加基础设施。当前没有 Redis/Hyperdrive 或额外缓存层。
