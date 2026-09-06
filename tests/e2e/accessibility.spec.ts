import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAs } from "./support/auth";
import { THEME_COOKIE_NAME } from "@/lib/theme";

// Screens carrying deferred raw-literal contrast findings (see
// context/changes/accessibility-audit-wcag-aa/deferred-findings.md) are
// individually and narrowly excluded below -- never a blanket disable.
// They currently pass AA (~5.38-5.97:1) per the plan's "What We're NOT
// Doing" section; the exclusion only silences the token-coverage rule
// jsx-a11y/axe can't distinguish from the shared-layer fixes this change
// made.

let recruitmentId: number;
let candidateId: number;
let recruitmentTitle: string;

test.beforeAll(async ({ browser }) => {
  // Dedicated fixtures so this spec never touches S-01's seeded "Backend
  // Engineer" recruitment or another spec's candidate rows. The title gets
  // a unique suffix because the recruitments list has no reset between
  // local re-runs of this spec (unlike CI's pristine-seed run) and a
  // fixed title would collide with a prior run's row.
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, "hr");

  recruitmentTitle = `Accessibility E2E Role ${crypto.randomUUID()}`;
  const recruitmentResponse = await page.request.post("/api/recruitments", {
    data: {
      title: recruitmentTitle,
      department: "Engineering",
      location: "Remote",
      employmentType: "full-time",
      openedAt: "2026-02-01",
      groupIds: [1, 2],
    },
  });
  const createdRecruitment = (await recruitmentResponse.json()) as { id: number };
  recruitmentId = createdRecruitment.id;
  await page.request.patch(`/api/recruitments/${recruitmentId}`, { data: { status: "closed" } });

  const candidateResponse = await page.request.post(`/api/recruitments/${recruitmentId}/candidates`, {
    data: {
      fullName: "Ada Accessibility",
      email: `ada.accessibility.e2e.${crypto.randomUUID()}@example.com`,
    },
  });
  const createdCandidate = (await candidateResponse.json()) as { id: number };
  candidateId = createdCandidate.id;

  await context.close();
});

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.context().addCookies([
    {
      name: THEME_COOKIE_NAME,
      value: theme,
      url: "http://localhost:4321",
    },
  ]);
}

async function scanForViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`axe scan (${theme} theme)`, () => {
    test(`sign-in screen has no WCAG 2 A/AA violations`, async ({ page }) => {
      await setTheme(page, theme);
      await page.goto("/auth/signin");
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      await scanForViolations(page);
    });

    test(`recruitments list has no WCAG 2 A/AA violations`, async ({ page }) => {
      await setTheme(page, theme);
      await signInAs(page, "hr");
      // This fixture recruitment is "closed", but the list defaults to the
      // "Live" filter -- request the closed view directly so it's visible.
      await page.goto("/recruitments?status=closed");
      await expect(page.getByText(recruitmentTitle)).toBeVisible();
      await scanForViolations(page);
    });

    test(`kanban board has no WCAG 2 A/AA violations`, async ({ page }) => {
      await setTheme(page, theme);
      await signInAs(page, "hr");
      await page.goto(`/recruitments/${recruitmentId}`);
      await expect(page.getByText("Ada Accessibility")).toBeVisible();
      await scanForViolations(page);
    });

    test(`candidate profile has no WCAG 2 A/AA violations`, async ({ page }) => {
      await setTheme(page, theme);
      await signInAs(page, "hr");
      await page.goto(`/candidates/${candidateId}`);
      await expect(page.getByText("Ada Accessibility")).toBeVisible();
      await scanForViolations(page);
    });

    test(`admin security groups has no WCAG 2 A/AA violations`, async ({ page }) => {
      await setTheme(page, theme);
      await signInAs(page, "admin");
      await page.goto("/admin/groups");
      await expect(page.getByRole("heading", { name: "Security groups" })).toBeVisible();
      await scanForViolations(page);
    });
  });
}
