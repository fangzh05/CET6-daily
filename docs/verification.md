# 验收记录（2026-10-09）

- TypeScript 检查、Vite build 与 Wrangler Worker dry-run 已执行通过。
- Vitest 20 项通过（包含新增 Sites 认证隔离测试）：真实 JWT 校验、权限隔离、确定性评分、幂等提交、提交中途故障回滚、草稿版本冲突、历史不可改写、证据、三题型规则和 upsert。
- Playwright 6 项通过：桌面、iPhone 13、iPad 尺寸的 Chromium；完整五题流程、刷新恢复、证据定位、正确统计、断网后本地草稿恢复并重新同步。全部使用明确标记的合成测试文章。
- 实际题库 62 份校验完成，193 阅读组、66 规范化、127 隔离、0 正式发布；详细报告位于忽略提交的 reports/import-validation.json。
- 实际规范化题库在隔离 PGlite 重复导入两次成功：40 试卷、66 题组、513 题、219 已核验答案；推荐池保持 0。
- PGlite 是测试引擎；这些结果不能证明 Neon 网络连接、Neon HTTP 事务、远程迁移、生产跨设备保存或实体 iOS Safari。另已执行下方 Neon 远程检查；Cloudflare Access 配置未执行，本次采用经用户同意的 Sites 私有认证。
- Sites 私有部署成功，生产环境 revision 2 已配置 Neon secret；已有登录浏览器点击重试后，显示学习记录保存在 Neon、真实 0 学习时长/题数以及无已核验文章。
- Neon production/development 的4份迁移全部真实执行成功；重复 development 迁移为0新版本。
- Development 实际导入66题组、513题；HTTP 非交互式事务故障回滚通过，attempts=0、eligible=0。三次请求耗时416/416/196ms，这是连续请求样本，不是空闲冷启动性能结论。

尚未满足：真实已核验文章五题验收（源发布池为空）；Neon 空闲冷启动与超时故障性能测量；真实登录后的跨设备练习；实体设备 Safari；完整真实练习的生产运行检查。不会用合成数据或未核验题目冒充这些验收。

题库清洗基线与待执行任务见本机 reports/reading-cleanup-queue.json、reports/question-bank-baseline.json、reports/workbuddy-cleanup-task.md。WorkBuddy 调用超时，独立 CLI 提示需要登录；尚未修改源题库或声称清洗完成。
