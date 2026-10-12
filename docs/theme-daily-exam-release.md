# Theme, daily exam and account controls

Implemented against the current CET6 Daily design: existing blue accent, 6px controls, neutral dark surfaces, original typography and section spacing. Product Design index, get-context, user-context preflight and critical overrides were read. No home redesign or UI framework was introduced.

## Changes

- `src/theme.ts`: single shared theme preference (`system`, `light`, `dark`), resolved using matchMedia, live OS/storage subscriptions, document color-scheme and dynamic theme-color. Existing light/dark localStorage values remain valid. Theme preference uses `cet6:theme` and survives logout on the same browser; it is not an account/cloud setting.
- `public/theme-init.js`, `index.html`, manifest: synchronous same-origin pre-paint initialization compatible with script-src self; iOS viewport and standalone status-bar metadata; light fallback launch colors. Manifest/splash rendering remains an OS responsibility and requires real-device checking.
- `src/home.css`, reading CSS: one themed document canvas, safe-area padding at the root, constrained application scrolling, sticky opaque home navigation, and reading workspace sizing within the available safe viewport. The old theme only styled the app shell while the root canvas retained a light background. viewport-fit=cover was already present, but top safe-area space was never reserved. That combination allowed a light canvas above dark content and content painting into the status-bar area. This fixes web layout causes; native Safari chrome cannot be fully controlled by page CSS.
- `src/App.tsx`: lightweight theme/exam selects, all unfinished sessions remain reachable with original paper labels, explicit selected-exam empty state, all-exam statistics labels, Grid/tabular-number accuracy rows. Logout is now a bordered 44px target with a native confirmation dialog, cancel and Escape support.
- `worker/repository.ts`, `worker/app.ts`, shared contracts: reuse existing daily selection, settings, frozen sessions and grading. Exam options come from eligible, non-archived reading groups. CET6/KY1 use careful reading; JLPT N1 uses jlpt_reading. New tasks and due reviews filter the selected exam; each exam has its own Beijing-day first-attempt budget. Switching updates only the user preference, never sessions/attempts/reviews. No second task scheduler/table was added. Completed groups stay excluded, and no exam fallback occurs on exhaustion. Existing statistics remain global and explicitly labeled; their formulas are unchanged.
- `0008_daily_exam.sql`: additive NOT NULL selected_exam with CET6 default and known-exam constraint. Old users, absent settings rows and legacy snapshot exam omissions retain CET6 behavior.

The original dirty worktree was preserved. Its deployed annotation implementation and exact migration 0007 were included as a separate baseline commit because production version 1618b62e-fb28-420e-9cfa-b600535af5c6 already contains them. Omitting them would regress production functionality and break migration hash validation.

## Verification boundaries

Automated iPhone/iPad projects use Chromium with device-sized viewports; they are not real iOS Safari or installed PWA tests. Real-device manual acceptance still needs:

1. iPhone Safari and an installed home-screen PWA: system light/dark, live changes, manual override, cold start, refresh and re-login.
2. Portrait/landscape notch and Dynamic Island: scroll both directions, pull/bounce at both ends, confirm status-bar background continuity and content clearance.
3. Open exam/theme selectors, logout confirmation and reading note dialogs; verify focus, touch targets and no safe-area overlap.
4. Check both exams and resume an older session after switching, then repeat after logging in on another device.

Cloudflare Access protects production; unauthenticated redirects do not prove authenticated production interaction. No production learner test attempts or fake accounts were created.

## Verified release gates (2026-10-13)

- `npm run check`: typecheck passed; 45 tests passed; production build and Worker dry run passed. The project defines no lint script.
- `npm run test:e2e`: 26 passed, 4 skipped (invite/admin scenarios intentionally run once on desktop). Desktop, iPhone-sized and iPad-sized Chromium exercised grading, offline recovery, highlights, navigation, theme updates, exam persistence/resume, numeric alignment and logout confirmation.
- After adapting migration 0008 to Neon's single-statement prepared-query requirement, its focused PostgreSQL tests passed (2/2), and the production migration applied atomically (one new migration).
- Production counts before/after migration matched: sessions 10, attempts 45, review states 25, annotations 21, users 2. Existing migration 0007's working and committed SHA-256 both matched the production ledger.
- Source uses an isolated release worktree; the original workspace's uncommitted files were preserved.
