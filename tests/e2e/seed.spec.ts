import { test, expect } from "@playwright/test";
import { signInAs } from "./support/auth";

/**
 * Seed exemplar for /10x-e2e generated tests in this repo — not itself a
 * regression test, but the pattern every generated spec is modeled on:
 * role-based locators, real auth via signInAs (no UI-independent bypass
 * exists here), a fully independent flow (own setup/action/assertion/
 * cleanup), a unique data value per run, and waiting for state rather than
 * time. See .claude/skills/10x-e2e/references/seed-test-pattern.md.
 */
test("created recruitment persists after page reload", async ({ page }) => {
  await signInAs(page, "hr");

  const title = `Seed Recruitment ${Date.now()}`;
  await page.goto("/recruitments/new");

  const titleInput = page.getByLabel("Title");
  const departmentInput = page.getByLabel("Department");
  const locationInput = page.getByLabel("Location");
  const openedAtInput = page.getByLabel("Opened date");
  const groupCheckbox = page.getByLabel("HR Recruiter");

  // CreateRecruitmentForm is a client:load island; retry until the fill
  // survives React attaching its controlled-input handlers (see support/auth.ts).
  await expect(async () => {
    await titleInput.fill(title);
    await departmentInput.fill("Engineering");
    await locationInput.fill("Remote");
    await openedAtInput.fill("2026-02-01");
    await groupCheckbox.check();
    await expect(titleInput).toHaveValue(title);
    await expect(departmentInput).toHaveValue("Engineering");
    await expect(locationInput).toHaveValue("Remote");
    await expect(openedAtInput).toHaveValue("2026-02-01");
    await expect(groupCheckbox).toBeChecked();
  }).toPass({ timeout: 10_000 });

  await page.getByRole("button", { name: "Create recruitment" }).click();
  await expect(page).toHaveURL(/\/recruitments\/\d+$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  // Cleanup: this app has no delete-recruitment capability, so — mirroring
  // the convention in recruitments.spec.ts's own create test — cleanup means
  // moving the seed recruitment out of Draft status. Leaving it in Draft
  // would otherwise leak into every later run of the Draft-status-filter
  // test, since the local Supabase DB isn't reset between local test runs.
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(page.locator('[data-slot="badge"]')).toHaveText("Live");
});
