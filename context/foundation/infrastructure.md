---
project: system-wspomagajacy-rekrutacje
researched_at: 2026-05-31
recommended_platform: Cloudflare Workers
runner_up: Render
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 + React 19
  runtime: Cloudflare Workers (workerd / V8 isolates)
  database: Supabase (external — PostgreSQL + Auth + Storage)
---

## Recommendation

**Deploy on Cloudflare Workers.**

The project's `@astrojs/cloudflare` adapter already targets the `workerd` runtime — zero adapter migration cost. The Workers free tier (100k requests/day, ~3M/month) covers MVP traffic with no billing required. Cloudflare has the strongest agent integration story of any candidate: official MCP servers (GA), a dedicated Claude Code integration page, and a `wrangler` CLI that covers every operational action without a browser. One required correction before the first deploy: `tech-stack.md` records `deployment_target: cloudflare-pages`, but `@astrojs/cloudflare` v13+ dropped Pages support — the deploy command must be `wrangler deploy`, not `wrangler pages deploy`.

## Platform Comparison

| Platform               | CLI-first | Managed/Serverless | Agent docs | Stable deploy API | MCP / Integration | Total       |
| ---------------------- | --------- | ------------------ | ---------- | ----------------- | ----------------- | ----------- |
| **Cloudflare Workers** | Pass      | Pass               | Pass       | Pass              | Pass              | **5 / 5**   |
| **Vercel**             | Pass      | Pass               | Pass       | Pass              | Pass              | **5 / 5**   |
| **Render**             | Pass      | Partial            | Pass       | Pass              | Pass              | **4.5 / 5** |
| **Railway**            | Pass      | Partial            | Pass       | Pass              | Partial           | **4 / 5**   |
| **Netlify**            | Partial   | Pass               | Pass       | Partial           | Pass              | **4 / 5**   |
| **Fly.io**             | Pass      | Partial            | Pass       | Pass              | Partial           | **4 / 5**   |

**Scoring notes**:

- **Cloudflare Workers**: Full Pass on all five criteria. `wrangler` CLI covers deploy (`wrangler deploy`), rollback (`wrangler rollback [VERSION_ID]`), and log-tailing (`wrangler tail`). Docs are GitHub-hosted markdown. Deploy is deterministic with structured output. Official MCP servers across Workers, R2, and observability — GA. MCP covers 2,500+ API endpoints and integrates with Claude Code natively (`developers.cloudflare.com/agent-setup/claude-code/`).

- **Vercel**: Ties Cloudflare on raw criteria. `vercel` CLI is comprehensive; `vercel logs` was explicitly rebuilt for agent workflows. Official MCP server at `mcp.vercel.com` (GA, OAuth-gated). Full `llms.txt` + `llms-full.txt`. Penalised in soft-weight scoring because: (a) requires adapter swap from `@astrojs/cloudflare` to `@astrojs/vercel`; (b) native Postgres and KV products deprecated in favor of Marketplace integrations; (c) user unfamiliar with Vercel specifically.

- **Render**: Persistent Node.js process (no cold starts on paid tiers), GA MCP server at `mcp.render.com` (20+ tools), `llms.txt` + `llms-full.txt`. Partial on Managed/Serverless because it runs persistent VMs, not pure serverless. $7/mo Starter tier. User has hands-on familiarity. Requires adapter swap to `@astrojs/node`.

- **Railway**: $5/mo resource-based billing, Nixpacks auto-detects Node, co-located Postgres, good `railway` CLI. Partial on MCP (work-in-progress, not GA) and Managed/Serverless (persistent containers). No native object storage — CV files would need external service (Supabase Storage already handles this). User familiar.

- **Netlify**: Partial on CLI (no `netlify rollback` CLI command — UI-only rollback) and Stable deploy API for the same reason. GA MCP server. Free tier hard-pauses production at 300 credits/month cap — risky. Netlify Database (Postgres) not on free plan.

- **Fly.io**: Persistent VMs, WebSocket-native, `flyctl` comprehensive. Managed Postgres starts at $38/mo (expensive for MVP). Tigris storage is beta. MCP server is experimental. No free tier — $7–15/mo realistic.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Native adapter — no migration work. Free tier covers 100k requests/day. Strongest agent story in the candidate pool (official MCP + Claude Code integration). `wrangler` CLI covers the full operational loop. Supabase handles DB/auth/storage externally, so the lack of co-located database is not a gap. Critical: Pages support dropped in adapter v13+ — deploy command must be `wrangler deploy`.

#### 2. Render

User has hands-on familiarity. Persistent Node.js process means no cold starts on the $7/mo Starter tier. Official GA MCP server exposes deploy, log, and service management tools. Good agent-readable docs. Would require adapter swap to `@astrojs/node` and `HOST=0.0.0.0` binding — straightforward but not zero work.

#### 3. Railway

Most cost-effective paid option ($5/mo Hobby plan, resource-based). Nixpacks handles Node.js auto-detection. User familiar. Co-located Postgres available. Main gaps: MCP server is work-in-progress, no native object storage (not a blocker since Supabase Storage is already in use), requires adapter swap.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **workerd runtime incompatibilities with npm packages**: The `workerd` V8 isolate runtime lacks full Node.js API surface. npm dependencies using Node-specific APIs break at runtime (not build time) — a 500 in production with no local warning. The `nodejs_compat` flag reduces but does not eliminate this risk.

2. **CV file upload via Worker proxying is unreliable**: The PRD requires reliable CV upload (PDF/DOCX, size unspecified). Routing large files through a Worker is fragile — `workerd` has strict request body limits and timeout behavior that cause silent failures on files above ~5MB. The correct architecture is direct-to-Supabase presigned URL uploads from the browser, bypassing the Worker entirely. This must be decided before writing the upload feature.

3. **Pages → Workers migration is undocumented required work**: `tech-stack.md` records `deployment_target: cloudflare-pages`, but `@astrojs/cloudflare` v13+ dropped Pages support. `wrangler pages deploy` → `wrangler deploy`, `wrangler.toml` shape changes (`pages_build_output_dir` → `main` entrypoint), CI/CD commands — all need updating before the first deploy will succeed.

4. **New per-Worker-per-day billing (GA, effective 2026-05-26)**: A new pricing axis charges per named Dynamic Worker per day, including idle Workers. Preview deployments and staging environments each count as a separate Worker. Not reflected in tutorials; check current pricing page before creating multiple environments.

5. **`.env` vs `.dev.vars` confusion**: The bootstrapped `.env.example` targets Node.js env vars. Cloudflare local dev (`wrangler dev`) reads from `.dev.vars`, not `.env`. The `astro:env/server` schema maps to Worker bindings, not `.env` values. Every new developer on the project will hit this on day one.

### Pre-mortem — How This Could Fail

The team bootstrapped with `deployment_target: cloudflare-pages` and developed locally with `wrangler dev`. Everything worked. On the first production deploy, `wrangler pages deploy` failed — `@astrojs/cloudflare` v13 no longer supports Pages and emits a confusing error about a missing `_worker.js` entrypoint. After an evening of debugging, the team found the migration guide, switched to `wrangler deploy`, updated `wrangler.toml`, and shipped.

Two weeks later, during recruiter acceptance testing, the CV upload feature failed silently on files larger than ~8MB. The Worker received the multipart body, began proxying it to Supabase Storage, and hit the `workerd` request body timeout. No error was surfaced to the user — the upload appeared to succeed, then the file was missing from the candidate profile. Three days of debugging culminated in a refactor to presigned Supabase URLs, pushing the kanban delivery by a week. The 2-week MVP became a 4-week MVP.

A month after launch, a surprise line item appeared on the Cloudflare bill: the per-Worker-per-day charge on three environments (production, staging, preview) added $15/month the team hadn't budgeted for. Small, but unexpected.

### Unknown Unknowns

- **`wrangler pages deploy` and `wrangler deploy` are completely non-interchangeable**: different `wrangler.toml` keys (`pages_build_output_dir` vs `main`), different deploy pipelines, different rollback commands. The bootstrapped project likely has the wrong `wrangler.toml` shape — audit before any deploy.
- **CV uploads must bypass the Worker via presigned URLs**: For the PRD's reliability guardrail ("upload CV musi być niezawodny"), browser → Supabase Storage direct upload via presigned URL is the only viable path for files of unknown size. Worker-proxied uploads are unreliable above ~5MB. Decide this before building the upload feature.
- **Compatibility date gates runtime APIs silently**: The `compatibility_date` in `wrangler.toml` must be set to a recent date to enable the full `nodejs_compat` API surface. An outdated date silently disables APIs — runtime failures only, no build error.
- **Supabase client creates new connections on each cold start**: The Supabase JS client initializes fresh per Worker invocation. Under low traffic (MVP), most requests will be cold starts, adding 200–500ms to TTFB. The PRD's <2s load requirement is achievable but must be validated under realistic traffic patterns.
- **Cloudflare MCP server must use a scoped API token**: A broad account-level Cloudflare token gives agents access to DNS, billing, Zero Trust, and unrelated projects. Create a project-scoped token limited to Workers for this project only. Store it in Claude Code's MCP config, not in the repo.

## Operational Story

- **Preview deploys**: `wrangler deploy --env preview` (or configure a staging environment in `wrangler.toml`). Preview Workers get a distinct subdomain. No automatic branch-deploy UI like Vercel/Netlify — preview environments are manually triggered or wired via CI. No built-in access protection for preview URLs; add Cloudflare Access (Zero Trust) if preview URLs must be private.
- **Secrets**: Runtime secrets go in Cloudflare Workers Secrets (`wrangler secret put SECRET_NAME`). Local dev secrets go in `.dev.vars` (gitignored). Never put secrets in `wrangler.toml` `[env.vars]` — those are committed to the repo. CI/CD uses Cloudflare API tokens stored in the CI secret vault.
- **Rollback**: `wrangler rollback` (reverts to previous deployment version); `wrangler rollback [VERSION_ID]` to roll back to a specific version. Rollback is near-instant (seconds). DB migrations (Supabase) do not roll back automatically — schema rollback is a separate manual operation.
- **Approval**: Deployment to production may be performed by the agent via `wrangler deploy`. Destructive operations — deleting a Worker, rotating a Supabase service role key, dropping a database table — are human-only panel operations. Creating or modifying Cloudflare Access policies is human-only.
- **Logs**: `wrangler tail` streams live logs in JSON or pretty format with optional filters (`--status`, `--search`). Historical logs are available via the Cloudflare dashboard or via the Cloudflare MCP server's observability tools. Structured JSON output is available for agent parsing: `wrangler tail --format json`.

## Risk Register

| Risk                                                                      | Source           | Likelihood | Impact | Mitigation                                                                                                                                                        |
| ------------------------------------------------------------------------- | ---------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wrangler pages deploy` fails on first deploy due to Pages deprecation    | Research finding | High       | Medium | Audit `wrangler.toml` before deploying; switch to `wrangler deploy` + Workers-style config. Document in deploy-plan.md.                                           |
| CV upload silently drops files >5MB proxied through Worker                | Devil's advocate | High       | High   | Implement direct-to-Supabase presigned URL upload from the browser. Do not proxy file bytes through the Worker. Decide before building the upload feature.        |
| workerd runtime breaks npm dependency at runtime (not build time)         | Devil's advocate | Medium     | Medium | Test each new npm package with `wrangler dev` before merging. Pin `nodejs_compat` in `compatibility_flags`. Add integration smoke test for critical dependencies. |
| Per-Worker-per-day billing adds unexpected cost across environments       | Unknown unknowns | Medium     | Low    | Check current pricing page before creating staging/preview environments. Consider a single "preview" Worker environment instead of per-branch Workers.            |
| `.dev.vars` vs `.env` confusion blocks new developer setup                | Unknown unknowns | High       | Low    | Document the difference in CLAUDE.md and onboarding. Confirm `.dev.vars.example` exists alongside `.env.example`.                                                 |
| Supabase cold start adds 200–500ms TTFB; PRD requires <2s loads           | Unknown unknowns | Medium     | Medium | Validate under realistic traffic early. Consider connection reuse patterns with `@supabase/ssr`. Monitor with `wrangler tail`.                                    |
| Scoped API token not configured; agent has overly broad Cloudflare access | Unknown unknowns | Low        | High   | Create a project-scoped Cloudflare API token limited to Workers. Store in Claude Code MCP config, not in repo.                                                    |
| Compatibility date outdated; runtime APIs silently disabled               | Unknown unknowns | Low        | Medium | Set `compatibility_date` to a recent date (2024-09-23 or later for full nodejs_compat). Review on each major dependency upgrade.                                  |

## Getting Started

1. **Audit `wrangler.toml` before deploying**: the bootstrapped config likely targets Cloudflare Pages (`pages_build_output_dir`). Workers deployment requires a `main` entrypoint pointing to the adapter output. Reference: [Astro on Cloudflare Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/).

2. **Rename `.env` secrets to `.dev.vars`** for Cloudflare local dev: copy `.env` values to `.dev.vars` (gitignored). Keep `.env.example` for documentation; add `.dev.vars.example` for the Cloudflare dev workflow.

3. **Set a scoped Cloudflare API token**: in the Cloudflare dashboard, create an API token with "Workers Scripts: Edit" permission scoped to this account only. Use this token in CI and Claude Code MCP config — not an account-level Global API Key.

4. **Wire Supabase secrets as Workers Secrets**: `wrangler secret put SUPABASE_URL` and `wrangler secret put SUPABASE_KEY`. These become available as `env.SUPABASE_URL` in the Worker and are picked up by the `astro:env/server` schema.

5. **First deploy**: `npm run build && wrangler deploy`. Verify the Worker URL is live, logs stream via `wrangler tail`, and rollback works via `wrangler rollback`. Do not use `wrangler pages deploy`.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration
- CI/CD pipeline setup (GitHub Actions / Bitbucket Pipelines wiring)
- Production-scale architecture (multi-region, HA, DR)
