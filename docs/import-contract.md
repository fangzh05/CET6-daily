# 真实题库导入契约

源路径：`C:/Users/16648/WorkBuddy/2026-10-08-21-27-31`。最初检查 Commit `83fcb8d642480c7ee085672e0d69051ca8ce4c13`；按用户要求使用 WorkBuddy 辅助诊断、重建和测试后，清洗提交为 `ddb578dcb6d83ff33a7b207040ee887c07d222d8`。

必须读取 `docs/markdown-schema.md`（v1）、`docs/structured-schema.md`（v2）、`data/markdown/manifest.json`、`data/structured/index.json`、`data/structured/usable_groups.json`、实际 structured 与独立 answers 文件。两份 Schema 文件哈希固定在 `docs/source-contract.json`；格式变化须审核更新契约后导入，不能默默容错放行。

当前 structured Schema 明确要求消费 JSON。Markdown 是内容来源，导入器读取其 YAML 元数据并保留 Markdown 路径；练习请求不解析 Markdown。structured JSON 和独立 answers 经 Zod 校验、标识核对、规范化后写入 Neon。路径经过 realpath 检查。

题目 ID 保持源 ID，段落 ID 由稳定题组 ID 和原段落索引生成。月份包括 6、7、9、12。`needs_review` 候选答案单独记录待核验，不变成标准答案。日期型 verified_at 规范化为 UTC 零点，原始来源元数据保留，不杜撰核验时刻。

补充来源通过 `data/audit/reference_pins.json` 固定 URL 与 SHA-256，并通过 `reference_completion.json` 对应题组。导入器验证来源与 pin、试卷及题组身份；补充来源写入 source_references.metadata，并参与内容版本哈希。跨套共享内容只接受来源明确说明，保留 provider_claim_needs_review；不能据此自动核验。旧错配题目和答案完整归档在源审计文件，不自动迁移学习历史。

当前题库版本 `23113733907228f74cef5690c39cba6d03625b58` 覆盖 62 套试卷、248 个完整阅读题组（124 仔细阅读、62 匹配、62 选词填空）和 1860 道阅读题。1860 道题均有已核验答案，248 个题组均进入正式练习池。曾有 35 条来源答案冲突，涉及 8 组；逐题裁定结果与被替换记录保存在题库 `data/audit/answer_conflict_adjudication.json`，未解决冲突为 0。2021 年 12 月第 3 套选词填空使用了来源声明的第 1 套共用章节，这一共享关系仍需独立确认。

发布要求同时满足内容与题目完整、所有答案已核验、题组列入源 usable_groups 发布清单。按组开放，不要求整套试卷完成。当前已发布数量 248；用户答题历史使用独立表并保留稳定外键。

`--validate` 不连接数据库，输出 coverage、隔离题组和明确原因。Schema、来源身份或发布清单严重不一致时整批终止；内容不完整的题组隔离，其余允许导入但保持待核验。

`--import` 先完成全部文件校验，再创建 import_batches。每组通过 cet6_import 单次原子 SQL upsert；最多 8 组并发（可通过 `--concurrency` 调整，范围 1–16），不同组有独立事务。失败时等待当前并发批次结束并记录批次失败状态，重新执行创建新批次并用稳定 ID 恢复，不清空题库或学习数据。未出现的旧问题归档；答案/解析降级阻止新的正式练习。已有会话持有答案版本和解析快照，不受题库改动影响。

不允许将已存在 ID 搬到另一文章或题号；段落删除/重排拒绝，需明确数据迁移策略。所有学习历史使用 restrict 外键；不会因重新导入删除成绩。

解析仅允许经过结构校验、逐段原文证据匹配的内容标记 verified。当前真实 source adapter 没有虚构解析；无核验解析时 UI 显示待核验。后续解析数据源须按 shared/contracts.ts 对接并验证原文；不得直接将模型输出作为核验内容。

2026-10-09 补齐解析：`data/explanations/lazynote.json` 保存懒笔记逐题解析，248 个题组、1860 道阅读题，来源 HTML 的 URL 和 SHA-256 按组保留。抓取脚本为 `scripts/fetch-explanations.py`（Python requests、beautifulsoup4）；原始 HTML 缓存在忽略的 `vendor/lazynote`。先将 `validateBank` 的规范化题组导出为 `reports/explanation-input.json` 再抓取，随后 `bank:validate` 会再次检查题干、选项、答案与逐段原文证据，并将解析纳入内容哈希。证据仅允许排版标点/空白归一化匹配，保存的引文始终为题库原文的精确子串。主旨/态度题可从正确项同义改写中的原文片段定位；匹配题/选词题仅保存来源实际提供的邻段/竞争词排除说明，不杜撰其余排除项。2021-12 第 3 套选词使用已有源审计声明的第 1 套共享章节，并再次逐段、逐词、逐答案匹配；这不新增对共享关系的独立认证。

只补解析使用 `scripts/import-explanations.ts --bank <path>` 预检，加 `--import` 执行；生产还需 `--production-reviewed --expected-commit <SHA>`。它在事务内再次核对数据库中的题干、选项、已核验答案和原文证据，原子 upsert 解析及 source_references 中的解析来源。任何题目不匹配则整批拒绝，不修改文章、答案、学习数据或旧会话解析快照。2026-10-09 生产回读确认：1860/1860 已核验解析、0 缺失、0 引文不匹配，248 组来源记录。原有 1 个会话和 5 条答题记录数量不变；旧会话继续使用原快照，新建练习使用补齐后的解析。开发库为旧版文章，完整预检只匹配 451 题，未强行覆盖其段落结构。
