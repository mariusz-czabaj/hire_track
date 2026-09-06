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

    // HR Recruiter (Tenant A) is not a member of the Tenant B fixture group
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

  test("shows the empty-state message when no candidate matches the search", async ({ page }) => {
    await signInAs(page, "hr");
    await page.goto("/candidates");

    await page.getByLabel("Search candidates by name").fill("Zzzznonexistent");
    await expect(page.getByText("No candidates match this search.")).toBeVisible();
  });

  test("shows the truncation hint when a search exceeds the candidate list cap", async ({ page }) => {
    await signInAs(page, "hr");

    // A dedicated recruitment (rather than a seeded one shared with other
    // specs, e.g. recruitments.spec.ts's candidate-count assertions) keeps
    // this test's 51 candidates from polluting other tests' fixtures.
    const recruitmentResponse = await page.request.post("/api/recruitments", {
      data: {
        title: `Truncation Fixture ${Date.now()}`,
        department: "Engineering",
        location: "Remote",
        employmentType: "full-time",
        openedAt: "2026-01-01",
        groupIds: [1], // HR Recruiter -- see supabase/seed.sql
      },
    });
    expect(recruitmentResponse.ok()).toBe(true);
    const recruitment = (await recruitmentResponse.json()) as { id: number };
    const recruitmentId = recruitment.id;

    // Recruitments default to "draft" status, which would otherwise show up
    // in recruitments.spec.ts's "Draft" status-filter assertions -- flip it
    // to "live" so this fixture stays invisible to that unrelated filter.
    const statusResponse = await page.request.patch(`/api/recruitments/${recruitmentId}`, {
      data: { status: "live" },
    });
    expect(statusResponse.ok()).toBe(true);

    // CANDIDATE_LIST_RESULT_CAP is 50; a shared name prefix + unique suffix
    // per candidate lets one search term match 51 rows without colliding
    // with other tests' candidates or requiring UI-driven creation.
    const namePrefix = `Trunc${Date.now()}`;
    for (let i = 0; i < 51; i++) {
      const response = await page.request.post(`/api/recruitments/${recruitmentId}/candidates`, {
        data: {
          fullName: `${namePrefix} Candidate ${i}`,
          email: `${namePrefix.toLowerCase()}-${i}@example.com`,
        },
      });
      expect(response.ok()).toBe(true);
    }

    await page.goto("/candidates");
    await page.getByLabel("Search candidates by name").fill(namePrefix);
    await expect(page.getByText("Showing the first matches. Refine your search to narrow the list.")).toBeVisible();
  });
});
