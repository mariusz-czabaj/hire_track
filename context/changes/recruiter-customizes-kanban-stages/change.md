---
change_id: recruiter-customizes-kanban-stages
title: Recruiter customizes kanban stages
status: impl_reviewed
created: 2026-09-01
updated: 2026-09-01
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

**Out-of-band CI fix (`1f3a94f`):** during Phase 4/6 verification, the "HR replaces a candidate-free recruitment's stages" integration test flaked once in CI (`expected 422 to be 200`). Root cause: the readiness loop in `.github/workflows/ci.yml` only curled `/` before starting the integration suite, while Astro dev's Vite optimizer was still lazily reloading a dependency bundle (`@supabase/ssr`) for the new `stages.ts` route. Fixed by polling `/api/security-groups` instead (any HTTP response, not just 2xx, since that route is auth-gated). Not part of the plan's file list — flagged here per the impl review (F2) so the workflow diff isn't a surprise.
