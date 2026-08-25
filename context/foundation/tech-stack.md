---
starter_id: 10x-astro-starter
package_manager: npm
project_name: system-wspomagajacy-rekrutacje
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
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
---

## Why this stack

The 10x Astro Starter (Astro 6 + React 19 + TypeScript + Tailwind CSS 4 + Supabase + Cloudflare Pages) is the vetted recommended default for a JavaScript/TypeScript web-app. Supabase ships PostgreSQL, auth, and file storage out of the box — covering the recruitment system's three main data concerns (user sessions, candidate profiles, and CV file uploads) without any additional services. TypeScript end-to-end and Astro's file-based routing give AI agents clear conventions to reason over. Cloudflare Pages aligns with the 2-week MVP timeline: zero infra to provision, git-push deploy. Bitbucket Pipelines handles CI with manual promotion after merge, which matches an after-hours solo project where a deliberate deploy gate reduces accidental pushes to production.
