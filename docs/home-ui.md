# Unified home and reliable practice entry

2026-10-09: Home, library, stats and notes now share the reader palette, border treatment, restrained typography and light/dark preference. The home page uses an editorial layout with the current reading as the main action. Layout captures: `home-screenshots/desktop-light.png`, `desktop-dark.png`, `iphone-light.png`, `ipad-light.png`.

The live site reproduced a failure where clicking resume left the page at home while in-app tab switching worked. Careful reading now mounts the existing FormalReadingSession within App, using the existing #session history contract. It no longer depends on a full-document redirect to enter practice. Direct /reading/:id bookmarks remain supported. Save-and-home flushes and pauses; explicit reopen resumes; reload restores the same session. No database schema or source-bank change.

A second entry failure affected already-practiced library groups: starting as new returns ALREADY_PRACTICED. The client now retries that specific server response as practice_type retry, preserving first-score semantics and labeling the round as repeated practice. Other errors are not retried as a different practice type. The library start button is disabled while opening.

Checks: TypeScript, unit/API tests and production build. Actual browser checks use the isolated PGlite server: start, answer change, save/home/resume, refresh, incomplete submit, server review, already-practiced library retry and statistics. Desktop1440x900, iPhone390x844, iPad820x1180 were inspected. The automated E2E selectors follow the restored hash contract, but that suite was not run. Production acceptance checks only open/resume the user's existing session, without selecting answers or submitting results.
