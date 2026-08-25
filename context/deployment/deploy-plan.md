---
project: system-wspomagajacy-rekrutacje
platform: Cloudflare Workers
planned_at: 2026-08-25
status: approved
---

## Target

- **Platform**: Cloudflare Workers (NOT Cloudflare Pages — `@astrojs/cloudflare` v13+ dropped Pages support).
- **Account**: `Mariusz.czabaj@gmail.com's Account` (`2f6dbd191320b38194fadd3c5b3d7e16`), confirmed via `wrangler whoami`.
- **Worker name**: `10x-astro-starter` (from `wrangler.jsonc`).
- **Adapter**: `@astrojs/cloudflare` (already installed, `output: "server"` in `astro.config.mjs`).

## Pre-flight status (checked against infrastructure.md's risk register)

| Item | Status |
|---|---|
| `wrangler.jsonc` shaped for Workers (`main` entrypoint, not `pages_build_output_dir`) | ✅ Already correct |
| `.env` + `.dev.vars` populated with `SUPABASE_URL` / `SUPABASE_KEY` for local dev | ✅ Already set |
| `.dev.vars.example` present for onboarding | ❌ Missing — housekeeping item below |
| Scoped Cloudflare API token (Workers Scripts: Edit only) for CI use | ❌ Not created — manual gate below |
| Production Worker secrets (`SUPABASE_URL`/`SUPABASE_KEY`) set via `wrangler secret put` | ❌ Not set — automated step below |
| CV upload architecture decided (direct-to-Supabase presigned URL, not Worker-proxied) | ❌ Not decided — blocks FR-012 implementation, not this deploy |
| `tech-stack.md` `ci_provider` matches actual `.github/workflows/ci.yml` (GitHub Actions, lint+build only, no deploy step) | ✅ Corrected — `ci_provider: github-actions` |

## Manual gates (human-only, panel operations)

1. **Create a scoped Cloudflare API token** for CI/agent use: Cloudflare dashboard → My Profile → API Tokens → Create Token → permission `Workers Scripts: Edit`, scoped to this account only. Do not use an account-level Global API Key. Store it in the CI secret vault (GitHub Actions secrets) — never commit it.
   - Local deploys from this machine can continue using the existing `wrangler` OAuth login; the scoped token is specifically for CI/automation.
2. **Decide CV-upload architecture before implementing FR-012**: browser → Supabase Storage direct upload via presigned URL. Do NOT proxy file bytes through the Worker — `workerd` has strict body-size/timeout behavior that silently drops uploads above ~5MB. This is a pre-requisite for that feature, not for this deploy.

## Automated steps (each requires explicit go-ahead before I run it — production-affecting)

1. `npm run build` — produces `./dist`, which `wrangler.jsonc`'s `assets.directory` serves.
2. `wrangler secret put SUPABASE_URL` and `wrangler secret put SUPABASE_KEY` — one-time; each prompts interactively for the value (same values already in `.dev.vars`, typed directly into the `wrangler` prompt — not passed as a shell argument, not pasted into chat).
3. `wrangler deploy` — first production deploy. Do NOT use `wrangler pages deploy` (incompatible with this project's config shape).
4. `wrangler tail --format json` — stream logs post-deploy to confirm the Worker is serving requests without runtime errors.

## Rollback

- `wrangler rollback` — reverts to the previous deployment version (near-instant).
- `wrangler rollback [VERSION_ID]` — roll back to a specific version.
- Supabase schema migrations do **not** roll back automatically — a schema rollback is a separate manual operation, independent of the Worker rollback.

## Verification steps (after first deploy)

1. Confirm the Worker URL responds (`curl -I <worker-url>` → expect `200`).
2. Confirm Supabase connectivity from a *deployed* request (not just local) — e.g. hit an app route that calls `createClient()` and check it doesn't fall back to the `null` client (missing-env-var path in `src/lib/supabase.ts`).
3. Confirm `wrangler tail` streams live logs with no immediate errors.
4. Confirm rollback works: `wrangler rollback` once, verify the previous version serves, then re-deploy forward.

## Housekeeping (follow-up, not blocking first deploy)

- Add `.dev.vars.example` (mirror `.env.example`) to close the onboarding-confusion risk between `.env` (Node) and `.dev.vars` (Cloudflare local dev via `wrangler dev`).
- CI/CD deploy-on-merge is still not wired — `.github/workflows/ci.yml` currently only runs lint + build.

## Out of scope

Carried from `infrastructure.md`:
- Docker image configuration.
- Full CI/CD deploy-on-merge wiring (GitHub Actions currently only runs lint + build).
- Production-scale architecture (multi-region, HA, DR).

## Approval

Reviewed and approved via Plan Mode on 2026-08-25. Automated steps above (secret setup, first deploy) are executed as separate explicit actions after this plan, per the project's irreversible/production-action confirmation rule — not auto-chained from writing this document.
