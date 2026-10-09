# 考研英语一题库

独立 exam=KY1，稳定题号 `ky1-<年>-q<题号>`；不改写 CET6 数据或学习记录。

## 已接入范围

- 2010–2026：17 套、153 题组、884 题。
- 765 个双源核验答案；884 份逐题解析，3163 个来源解析单元。
- 完形、阅读、新题型共 102 组可正式练习，服务端确定性评分。
- 翻译与大小作文共 51 组仅参考学习，不自动评分、不写入学习统计。
- 客观题预览和未提交会话不返回答案或解析；提交时冻结答案与完整来源解析。
- 保留 options/verdicts、翻译 chunks、writing 等原始结构，不生成替代解析。

## 导入

先阅读来源 `KY1_HANDOFF.md` 与 `docs/ky1-markdown-schema.md`。
契约指纹在 `docs/ky1-source-contract.json`；内容、答案、解析、审计必须已提交。

```powershell
npx tsx scripts/import-bank.ts --validate --exam KY1 --bank <WorkBuddy目录>
# 先用版本化迁移更新目标数据库，再导入；连接由现有数据库护栏校验。
npx tsx --env-file=.env.local scripts/import-bank.ts --import --exam KY1 --bank <WorkBuddy目录> --concurrency 1
# 生产另需 --production-reviewed --expected-commit <已审核来源完整SHA>
```

导入按题组事务 upsert，可安全重跑；不会删除已提交历史或改写会话快照。
网络失败会将该批标记 failed，排查后重跑，不视为完整成功。

## 本次校验

来源 SHA：`e5dae8994d3626cb471c44b08184bdea9c284887`。
完整来源测试见 `tests/ky1.test.ts`（环境有来源目录时执行；可用 `KY1_BANK_PATH` 指定）。
覆盖全部 153 组导入、20 题完形评分、未提交答案隐私、主观题禁止正式评分及重复导入历史不变。
生产克隆先迁移并完整导入，再执行开发/生产迁移与导入。
生产核对：17 套、884 题、765 答案、884 份解析、102 个可练习组；原有作答 5、会话 1、标注 6 均未变化。
手机宽度 Chromium 已走通真实完形作答、提交、显式展开解析，无横向溢出；不代表 iPhone Safari 真机验收。
