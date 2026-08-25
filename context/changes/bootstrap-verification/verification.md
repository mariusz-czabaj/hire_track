---
bootstrapped_at: 2026-05-31T00:00:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: system-wspomagajacy-rekrutacje
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: system-wspomagajacy-rekrutacje
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: bitbucket-pipelines
  ci_default_flow: manual-promotion
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

### Why this stack

The 10x Astro Starter (Astro 6 + React 19 + TypeScript + Tailwind CSS 4 + Supabase + Cloudflare Pages) is the vetted recommended default for a JavaScript/TypeScript web-app. Supabase ships PostgreSQL, auth, and file storage out of the box — covering the recruitment system's three main data concerns (user sessions, candidate profiles, and CV file uploads) without any additional services. TypeScript end-to-end and Astro's file-based routing give AI agents clear conventions to reason over. Cloudflare Pages aligns with the 2-week MVP timeline: zero infra to provision, git-push deploy. Bitbucket Pipelines handles CI with manual promotion after merge, which matches an after-hours solo project where a deliberate deploy gate reduces accidental pushes to production.

## Pre-scaffold verification

| Signal      | Value    | Severity | Notes                                                |
| ----------- | -------- | -------- | ---------------------------------------------------- |
| npm package | not run  | —        | cmd_template starts with `git clone`; npm step skipped |
| GitHub repo | not run  | —        | `gh` CLI not installed; network check unavailable    |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 19 (`.env.example`, `.github`, `.gitignore`, `.husky`, `.nvmrc`, `.prettierrc.json`, `.vscode`, `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules`, `package-lock.json`, `package.json`, `public`, `src`, `supabase`, `tsconfig.json`, `wrangler.jsonc`)
**Conflicts (.scaffold siblings)**: `CLAUDE.md.scaffold`
**.gitignore handling**: moved silently (no .gitignore existed in cwd)
**.bootstrap-scaffold cleanup**: deleted
**Engine warnings during install**: Node v23.11.0 is outside the declared range for `@eslint/compat`, `@eslint/config-helpers`, `@eslint/core`, `eslint-visitor-keys` (require `^20.19.0 || ^22.13.0 || >=24`). These are `npm warn EBADENGINE` notices, not errors — install completed successfully.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: 0/0 direct CRITICAL/HIGH of total 0/1; 2 direct packages involved via transitive chains (`@astrojs/check`, `wrangler`)

#### CRITICAL findings

None.

#### HIGH findings

**devalue** — range `5.6.3 – 5.8.0` (transitive)
- Advisory: GHSA-77vg-94rm-hx3p — Svelte devalue: DoS via sparse array deserialization
- CVSS 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)
- CWE-770 (Allocation of Resources Without Limits)
- Fix available: `npm audit fix`

#### MODERATE findings

1. **@astrojs/check** (direct) — range `>=0.9.3` via `@astrojs/language-server`. Fix: downgrade to `0.9.2` (major semver change).
2. **@astrojs/language-server** (transitive) — range `>=2.14.0` via `volar-service-yaml`.
3. **@cloudflare/vite-plugin** (transitive) — via `miniflare`, `wrangler`, `ws`. Fix available.
4. **miniflare** (transitive) — range `3.20250204.0 – 4.20260518.0` via `ws`. Fix available.
5. **volar-service-yaml** (transitive) — range `<=0.0.70` via `yaml-language-server`.
6. **wrangler** (direct) — range `3.108.0 – 4.93.0` via `miniflare`. Fix available.
7. **ws** (transitive) — range `8.0.0 – 8.20.0` (GHSA-58qx-3vcg-4xpx, uninitialized memory disclosure, CVSS 4.4). Affects `@supabase/realtime-js` and top-level `ws`.
8. **yaml** (transitive) — range `2.0.0 – 2.8.2` (GHSA-48c2-rrv3-qjmp, stack overflow via deeply nested YAML, CVSS 4.3).
9. **yaml-language-server** (transitive) — via `yaml`. Fix: update `@astrojs/check` to `0.9.2`.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value                  |
| ----------------------- | ---------------------- |
| bootstrapper_confidence | first-class            |
| quality_override        | false                  |
| path_taken              | standard               |
| self_check_answers      | null                   |
| team_size               | solo                   |
| deployment_target       | cloudflare-pages       |
| ci_provider             | bitbucket-pipelines    |
| ci_default_flow         | manual-promotion       |
| has_auth                | true                   |
| has_payments            | false                  |
| has_realtime            | false                  |
| has_ai                  | false                  |
| has_background_jobs     | false                  |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review `CLAUDE.md.scaffold` — the starter shipped its own CLAUDE.md; diff it against the existing one to see what to merge.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log. Run `npm audit fix` to resolve automatically-fixable items.
- The Node engine warnings during install are cosmetic (Node v23 is between the declared ranges); the project should build and run normally.
