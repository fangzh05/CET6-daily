# CET6 Daily

个人六级阅读训练。React / TypeScript / Vite / Tailwind，Hono Worker API，Neon PostgreSQL、Drizzle。浏览器只访问同源 `/api`，业务数据库只用 Neon。

## 当前交付状态

已实现完整文章做题、三种阅读交互、未提交答案即时反馈与排队保存、刷新恢复、离线待同步草稿、版本冲突处理、服务端确定性评分、幂等原子提交、证据定位、笔记、错题间隔复习和真实数据统计。首次成绩追加保存，复习不会覆盖它。

源题库真实检查：62 套试卷、193 个阅读题组；66 组能规范化，127 组隔离并报告。源仓库目前没有获准发布的题组，正式推荐池为 0。不能把测试合成文章当成六级真题。测试验证练习流程，尚不等于经过核验的真实五题验收。

生产部署选择已调整为 **Sites 私有托管 + ChatGPT 身份**；独立 Wrangler 部署保留 Cloudflare Access。Neon 专用项目和 production/development 分支已建立，真实 HTTP 连接、双环境迁移、重复迁移和事务故障回滚已通过。线上已登录首页确认从 Neon 读取真实空状态；跨设备练习仍待已核验题组开放后验收。

## 安装与本地运行

需要 Node.js 22+，`npm ci`。

1. 创建 CET6 Daily 专用 Neon 项目，production 与 development 使用不同分支及 endpoint。
2. 复制 `.env.example` 为未提交的 `.env.local`，填入 development 连接；复制 `.dev.vars.example` 为 `.dev.vars.development`，填入同一个 development endpoint。
3. `npm run db:migrate`。脚本校验环境与精确 endpoint；使用版本化 Migration，不运行 schema push。
4. `npm run bank:validate -- --bank "C:/Users/16648/WorkBuddy/2026-10-08-21-27-31"`；审核 `reports/import-validation.json` 后 `npm run bank:import -- --bank "该路径"`。
5. 两个终端运行 `npm run dev:api` 和 `npm run dev`，访问 `http://127.0.0.1:5173`。

没有 Neon 凭据时，也可以运行自动化测试；测试数据库是隔离的 PGlite PostgreSQL 引擎，不是业务数据库。`tests/test-server.ts` 和合成题仅属于测试，绝不部署。

## 检查

```sh
npm run check
npx playwright install chromium
npm run test:e2e
npm run deploy:dry
```

Playwright 验证桌面、iPhone 和 iPad 尺寸的 Chromium；不是实体设备或 iOS Safari 的证明。API 集成测试包括提交中途故障回滚、重复提交、权限隔离、评分、草稿版本冲突、追加历史、证据和导入。

## 工程边界

- `src/`：阅读 UI、草稿队列、真实统计。未提交页面不接收答案或解析。
- `worker/`：认证、Zod 请求校验、权限检查、Neon HTTP + Drizzle 查询。
- `db/schema.ts`：关系模型；`db/migrations/`：版本化 SQL；`db/functions.sql` 与 `db/import.sql` 是函数参考源，修改后必须新增 Migration。
- `shared/contracts.ts`：题组、答案、证据和请求契约。
- `scripts/bank.ts`：读取真实 Markdown 元数据和 structured JSON，校验独立答案与发布清单。
- `worker/sites.ts`：只用于私有 Sites dispatcher。`worker/index.ts`：独立 Cloudflare Access 入口。

操作 SQL 函数一次完成提交或单题组导入；不使用 neon-http 不支持的交互式 `db.transaction()`。迁移使用 Neon 原生非交互式 HTTP transaction 批处理。

部署、备份、数据契约与验收限制见 [部署指南](docs/deployment.md)、[题库契约](docs/import-contract.md)、[测试记录](docs/verification.md)。
