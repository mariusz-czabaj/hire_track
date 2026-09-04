---
change_id: admin-manages-security-groups
title: Administrator manages security groups and users
roadmap_id: S-07
milestone_id: first-recruiter-workflow-mvp
status: implementing
created: 2026-09-04
updated: 2026-09-04
prd_refs: [FR-017, FR-018]
---

# S-07: Administrator manages security groups and users

## Outcome

An administrator creates security groups, assigns allowed operations to them, and
adds/removes users from groups.

## PRD references

- FR-017 — Administrator can create security groups and assign operations to groups.
- FR-018 — Administrator can add/remove users from groups.
- Access Control — RBAC with security groups; an operation is available to a user
  when they belong to a group holding that operation.

## Prerequisites

- F-01 (`core-recruitment-data-foundation`) — group/membership/operation schema and RLS.

## Artifacts

- `research.md` — codebase research (this change)
