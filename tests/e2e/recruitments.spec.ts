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
});

test("Administrator sees an empty list and a not-found board", async ({ page }) => {
  await signInAs(page, "admin");

  await page.goto("/recruitments");
  await expect(page.getByText("No recruitments are visible to you.")).toBeVisible();

  await page.goto(`/recruitments/${recruitmentId}`);
  await expect(page.getByText("This recruitment could not be found.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Back to recruitments/ }).first()).toBeVisible();
});
