import { test, expect } from "@playwright/test";
import { signInAs } from "./support/auth";

const STAGE_ORDER = ["New", "Screening", "Interview", "Offer", "Hired", "Rejected"];

let recruitmentId: number;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, "hr");
  const response = await page.request.get("/api/recruitments");
  const recruitments = (await response.json()) as { id: number }[];
  recruitmentId = recruitments[0].id;
  await context.close();
});

test("redirects an unauthenticated visitor to sign-in", async ({ page }) => {
  await page.goto("/recruitments");
  await expect(page).toHaveURL(/\/auth\/signin$/);
});

test.describe("HR recruiter", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "hr");
  });

  test("sees the recruitment and opens it as a fully-populated board", async ({ page }) => {
    await page.goto("/recruitments");
    await expect(page.getByText("Backend Engineer")).toBeVisible();

    await page.getByText("Backend Engineer").click();
    await expect(page).toHaveURL(/\/recruitments\/\d+$/);

    const headings = page.getByRole("heading", { level: 2 });
    await expect(headings).toHaveText(STAGE_ORDER);

    await expect(page.getByText("Rejected")).toBeVisible();
    await expect(page.getByText("No candidates")).toBeVisible();

    const addedDates = page.getByText(/^Added \d{4}-\d{2}-\d{2}$/);
    await expect(addedDates).toHaveCount(5);
  });

  test("status filter narrows results and persists across reload", async ({ page }) => {
    await page.goto("/recruitments");
    await expect(page.getByText("Backend Engineer")).toBeVisible();

    await page.getByRole("button", { name: "Draft", exact: true }).click();
    await expect(page.getByText("No recruitments match this filter.")).toBeVisible();
    await expect(page).toHaveURL(/status=draft/);

    await page.reload();
    await expect(page.getByText("No recruitments match this filter.")).toBeVisible();
    await expect(page).toHaveURL(/status=draft/);

    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByText("Backend Engineer")).toBeVisible();
    await expect(page).not.toHaveURL(/status=/);
  });
});

test("Hiring Manager sees the identical read-only board", async ({ page }) => {
  await signInAs(page, "hiringManager");
  await page.goto(`/recruitments/${recruitmentId}`);

  const headings = page.getByRole("heading", { level: 2 });
  await expect(headings).toHaveText(STAGE_ORDER);
  await expect(page.getByTestId("kanban-columns").getByRole("button")).toHaveCount(0);

  // StatusControl has no client-side role gating (RLS is the enforcement
  // boundary, per the plan's "no client-side capability check" decision),
  // so the Hiring Manager does see the status buttons. Clicking a status
  // other than the current one must surface a clean denial (the API's
  // 404-for-forbidden-or-missing rule) rather than crashing or silently
  // succeeding. The seed data seeds this recruitment as "live".
  const statusControl = page.getByTestId("status-control");
  await expect(statusControl.getByRole("button")).not.toHaveCount(0);

  const draftButton = statusControl.getByRole("button", { name: "Draft" });
  await draftButton.click();
  await expect(statusControl.getByText(/not found|denied|error/i)).toBeVisible();

  // Confirm the denial didn't silently persist: the recruitment's status
  // is still "live" after a reload.
  await page.reload();
  await expect(statusControl.getByRole("button", { name: "Live" })).toHaveClass(/bg-white\/20/);
});

test("Administrator sees an empty list and a not-found board", async ({ page }) => {
  await signInAs(page, "admin");

  await page.goto("/recruitments");
  await expect(page.getByText("No recruitments are visible to you.")).toBeVisible();

  await page.goto(`/recruitments/${recruitmentId}`);
  await expect(page.getByText("This recruitment could not be found.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Back to recruitments/ }).first()).toBeVisible();
});

test.describe("HR creates a recruitment and manages its status", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "hr");
  });

  test("create -> appears in list -> status change persists", async ({ page }) => {
    await page.goto("/recruitments/new");

    const titleInput = page.getByLabel("Title");
    const departmentInput = page.getByLabel("Department");
    const locationInput = page.getByLabel("Location");
    const openedAtInput = page.getByLabel("Opened date");
    const groupCheckbox = page.getByLabel("HR/Rekruter");

    // CreateRecruitmentForm is a client:load island -- same hydration race
    // as SignInForm (see support/auth.ts): retry until values actually
    // stick past React attaching its controlled-input onChange handlers.
    await expect(async () => {
      await titleInput.fill("E2E Test Role");
      await departmentInput.fill("Engineering");
      await locationInput.fill("Remote");
      await openedAtInput.fill("2026-02-01");
      await groupCheckbox.check();
      await expect(titleInput).toHaveValue("E2E Test Role");
      await expect(departmentInput).toHaveValue("Engineering");
      await expect(locationInput).toHaveValue("Remote");
      await expect(openedAtInput).toHaveValue("2026-02-01");
      await expect(groupCheckbox).toBeChecked();
    }).toPass({ timeout: 10_000 });

    await page.getByRole("button", { name: "Create recruitment" }).click();

    await expect(page).toHaveURL(/\/recruitments\/\d+$/);
    await expect(page.getByRole("heading", { name: "E2E Test Role" })).toBeVisible();
    await expect(page.locator('[data-slot="badge"]')).toHaveText("Draft");

    await page.goto("/recruitments");
    await expect(page.getByText("E2E Test Role")).toBeVisible();

    await page.getByText("E2E Test Role").click();
    await page.getByRole("button", { name: "Live", exact: true }).click();
    await expect(page.locator('[data-slot="badge"]')).toHaveText("Live");

    await page.reload();
    await expect(page.locator('[data-slot="badge"]')).toHaveText("Live");
  });
});
