Source: https://english-exam.lazynote.cn/cet6/downloads/

`lazynote.json` contains 1,860 reading explanations for 248 groups. Each group pins its actual section URL and the SHA-256 of the downloaded HTML. The fetcher checks existing verified keys, question/option text, and passage quotations; it does not generate analyses or change keys. `verification_status` means these mechanical source/content checks passed, not an independent human review of every explanation.

Reproduce with `scripts/fetch-explanations.py` after exporting normalized bank groups to `reports/explanation-input.json`. Python dependencies: requests and beautifulsoup4. Raw HTML is cached in ignored `vendor/lazynote`; delete individual cache files to refresh them explicitly. Run bank validation before import.

2021-12 set 3 cloze reuses the set 1 URL under the question bank's existing shared-section audit; full paragraph/word-bank/answer equality is checked. Independent confirmation of that historical sharing claim remains outstanding.
