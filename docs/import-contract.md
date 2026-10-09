# 真实题库导入契约

源路径：`C:/Users/16648/WorkBuddy/2026-10-08-21-27-31`，检查 Commit `83fcb8d642480c7ee085672e0d69051ca8ce4c13`。没有修改源仓库。

必须读取 `docs/markdown-schema.md`（v1）、`docs/structured-schema.md`（v2）、`data/markdown/manifest.json`、`data/structured/index.json`、`data/structured/usable_groups.json`、实际 structured 与独立 answers 文件。两份 Schema 文件哈希固定在 `docs/source-contract.json`；格式变化须审核更新契约后导入，不能默默容错放行。

当前 structured Schema 明确要求消费 JSON。Markdown 是内容来源，导入器读取其 YAML 元数据并保留 Markdown 路径；练习请求不解析 Markdown。structured JSON 和独立 answers 经 Zod 校验、标识核对、规范化后写入 Neon。路径经过 realpath 检查。

题目 ID 保持源 ID，段落 ID 由稳定题组 ID 和原段落索引生成。月份包括 6、7、9、12。源答案有 19 条 `needs_review` 候选答案，单独记录待核验，不变成标准答案。日期型 verified_at 规范化为 UTC 零点，原始来源元数据保留，不杜撰核验时刻。

发布要求同时满足内容与题目完整、所有答案已核验、题组列入源 usable_groups 发布清单。按组开放，不要求整套试卷完成。当前源清单为空，发布数量 0。

`--validate` 不连接数据库，输出 coverage、隔离题组和明确原因。Schema、来源身份或发布清单严重不一致时整批终止；内容不完整的题组隔离，其余允许导入但保持待核验。

`--import` 先完成全部文件校验，再创建 import_batches。每组通过 cet6_import 单次原子 SQL upsert；失败时记录批次失败状态，重新执行创建新批次并用稳定 ID 恢复，不清空题库或学习数据。未出现的旧问题归档；答案/解析降级阻止新的正式练习。已有会话持有答案版本和解析快照，不受题库改动影响。

不允许将已存在 ID 搬到另一文章或题号；段落删除/重排拒绝，需明确数据迁移策略。所有学习历史使用 restrict 外键；不会因重新导入删除成绩。

解析仅允许经过结构校验、逐段原文证据匹配的内容标记 verified。当前真实 source adapter 没有虚构解析；无核验解析时 UI 显示待核验。后续解析数据源须按 shared/contracts.ts 对接并验证原文；不得直接将模型输出作为核验内容。
