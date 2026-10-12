# Answer workspace and annotations QA

Reference: supplied KY1 mobile screenshot and existing CET6 reading workspace.

Changes: neutral backgrounds and blue selected states; single-row horizontally scrolling question numbers; compact results; mobile answer-pane height adjustment. CET6, KY1 and N1 now share the selection toolbar and note dialog. Article, question-stem and option excerpts use owned frozen-session validation.

Local checks: npm run check passed (typecheck, 43 tests, production build and Worker dry run); git diff --check passed. API regression covers exact question/option excerpts, invalid text/targets, wrong passage, missing owned context and cross-user deletion protection.

Browser checks: CET6 shared workspace, N1 vocabulary entry with Japanese text, and KY1 twenty-question cloze entry used isolated synthetic fixtures. Saved stem notes and option highlights appeared immediately and survived reload. KY1 article text after a rendered blank retained exact source offsets. Selection did not change selected answers. New excerpts did not duplicate an existing note. Mobile viewport (390 x 844) displayed a single-row navigator and independently scrolling questions.

final result: passed
Scope: local UI and persistence on the isolated PostgreSQL fixture service. Exact production content and physical-device touch behavior remain unverified.

Release status: deployed on 2026-10-12. Wrangler OAuth device authorization succeeded and credentials were persisted in the local Wrangler configuration. Production migration 0007_question_annotations.sql applied atomically; before/after counts unchanged: practice_sessions 8, attempts 45, review_states 25, annotations 21. Worker version 1618b62e-fb28-420e-9cfa-b600535af5c6 published to cet6.zehaoo.top and cet6-test.zehaoo.top. Main domain returned the expected Access 302 redirect. Authenticated production interactions and physical-device touch behavior remain unverified.
