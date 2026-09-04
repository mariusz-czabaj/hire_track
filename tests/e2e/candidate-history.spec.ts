import { test, expect } from "@playwright/test";
import { signInAs } from "./support/auth";

// Uses the Julia Wojcik cross-tenant fixture seeded for S-06 (plan.md
// Phase 1): she belongs to both the Backend Engineer (Tenant A) and Data
// Analyst (Tenant B) recruitments, each with a multi-step transition
// chain, so a single spec can prove FR-014 -> FR-015 -> FR-016 end to end
// without creating its own fixtures.

test.describe("Candidates history search", () => {
  test("HR finds the cross-tenant candidate by name and reads the Backend Engineer recruitment's full history", async ({
    page,
  }) => {
    await signInAs(page, "hr");
    await page.goto("/candidates");

    await page.getByLabel("Search candidates by name").fill("Wojcik");
    await expect(page.getByTestId("candidate-list").getByText("Julia Wojcik")).toBeVisible();

    await page.getByTestId("candidate-list").getByText("Julia Wojcik").click();
    await expect(page).toHaveURL(/\/candidates\/\d+$/);

    // HR/Rekruter (Tenant A) is not a member of the Tenant B fixture group
    // that Data Analyst is scoped to -- this is the truncation boundary
    // itself, not an oversight: only Backend Engineer is visible here.
    await expect(page.getByText("Backend Engineer")).toBeVisible();
    await expect(page.getByText("Data Analyst")).not.toBeVisible();

    await expect(page.getByText("Added to New")).toBeVisible();
    await expect(page.getByText(/New\s*→\s*Screening/)).toBeVisible();
  });

  test("Tenant B principal sees the same candidate but only the Data Analyst recruitment and its history", async ({
    page,
  }) => {
    await signInAs(page, "hr");
    await page.goto("/candidates");
    await page.getByLabel("Search candidates by name").fill("Wojcik");
    await page.getByTestId("candidate-list").getByText("Julia Wojcik").click();
    await expect(page).toHaveURL(/\/candidates\/\d+$/);
    const url = page.url();

    await signInAs(page, "tenantPeer");
    await page.goto(url);
    await expect(page.getByText("Julia Wojcik")).toBeVisible();
    await expect(page.getByText("Data Analyst")).toBeVisible();
    await expect(page.getByText("Backend Engineer")).not.toBeVisible();
    await expect(page.getByText("Added to New")).toBeVisible();
  });
});
