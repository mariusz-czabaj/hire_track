# Deferred Findings

> Findings from `research.md` that this change deliberately did not fix, so they stay
> schedulable instead of getting lost. Each row is cleared by the slice that migrates
> its screen off raw Tailwind literals; clearing a row means re-measuring contrast on
> the changed screen and removing it from this table, per the `lessons.md` entry below.

| Finding                                                                 | File:line                                                                                  | WCAG criterion                          | Owning slice |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------ |
| Raw Tailwind color literals instead of design tokens (passes AA today, ~5.38-5.97:1, but untracked by `/dev/design-system`) | `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`, `src/components/auth/SubmitButton.tsx:18`, `src/components/auth/SignUpForm.tsx:59` | 1.4.3 Contrast (Minimum)                 | S-08..S-13   |
| Checkbox group missing `<fieldset>`/`<legend>`                          | `src/components/recruitments/CreateRecruitmentForm.tsx:161-195`                             | 1.3.1 Info and Relationships             | S-08..S-13   |
| Checkbox group missing `<fieldset>`/`<legend>`                          | `src/components/admin/SecurityGroupDetail.tsx:206-221`                                      | 1.3.1 Info and Relationships             | S-08..S-13   |
| `/dev/design-system` tables missing `scope`/`caption`                   | `src/pages/dev/design-system.astro`                                                          | 1.3.1 Info and Relationships (dev-only)  | not scheduled — dev-only surface, not recruiter-facing |
