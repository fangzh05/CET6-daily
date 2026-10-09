# Design QA — compact reading review

Status: PASS (2026-10-09)

Scope: preserve the existing typography, neutral surfaces, blue selection outline, and green/red review colors while giving questions more room.

Visual comparison: `reports/compact/comparison.jpg` combines the live source and implementation at 1280×800. Reviewed side by side: the desktop summary shrinks from 203px to 91px; the navigation retains its existing style. Different question content comes from the local original practice fixture, not a production data change.

The saved-score / retry row now follows question pagination inside normal scroll content on all sizes. No pinned footer remains.

Responsive interaction checks: at 390×844, dragging stops at 57.82% workspace height; at portrait iPad 820×1180, dragging stops at 41.79%. No preset snapping. The saved fractional height survives reload. Home/End keyboard controls, collapse/expand click, evidence jump and return work. Screenshots: `reports/compact/phone-custom.jpg`, `reports/compact/ipad-custom.jpg`.

Validation: typecheck, 33 tests, production build and Worker dry run pass; browser console has no errors. Pointer dragging was checked in Chromium device-sized viewports; physical iPhone/iPad Safari touch behavior was not tested.
