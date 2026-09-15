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

    // 6, not 5: the S-06 cross-tenant seed fixture (Julia Wojcik) also
    // belongs to this recruitment (supabase/seed.sql).
    const addedDates = page.getByText(/^Added \d{4}-\d{2}-\d{2}$/);
    await expect(addedDates).toHaveCount(6);
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

  // recruiter-manages-candidate-status (S-04) added a per-card move button,
  // and the plan carries forward S-02's "no client-side capability gating"
  // decision -- so the Hiring Manager does see it, same as the status
  // control below. Denial on click (rather than the button being absent)
  // is exercised in candidates.spec.ts's hiring-manager case.
  await expect(page.getByTestId("kanban-columns").getByRole("button", { name: /^Move candidate/ })).not.toHaveCount(0);

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
  await expect(statusControl.getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "true");
});

test("Administrator sees an empty list and a not-found board", async ({ page }) => {
  await signInAs(page, "admin");

  await page.goto("/recruitments");
  // The list defaults to the "Live" filter, which renders a "no match"
  // message instead of the "no access at all" one this test checks -- clear
  // the filter first so the assertion reflects the admin's actual access.
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByText("No recruitments are visible to you.")).toBeVisible();

  await page.goto(`/recruitments/${recruitmentId}`);
  await expect(page.getByText("This recruitment could not be found.")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Recruitments" }),
  ).toBeVisible();
});

test.describe("HR creates a recruitment and manages its status", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "hr");
  });

  test("create -> appears in list -> status change persists", async ({ page }) => {
    const title = `E2E Test Role ${Date.now()}`;

    await page.goto("/recruitments/new");

    const titleInput = page.getByLabel("Title");
    const departmentInput = page.getByLabel("Department");
    const locationInput = page.getByLabel("Location");
    const openedAtInput = page.getByLabel("Opened date");
    const groupCheckbox = page.getByLabel("HR Recruiter");

    // CreateRecruitmentForm is a client:load island -- same hydration race
    // as SignInForm (see support/auth.ts): retry until values actually
    // stick past React attaching its controlled-input onChange handlers.
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
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByText("Department: Engineering")).toBeVisible();
    await expect(page.getByText("Location: Remote")).toBeVisible();
    await expect(page.getByText("Employment type: Full-time")).toBeVisible();
    await expect(page.getByText("Opened: 2026-02-01")).toBeVisible();
    await expect(page.locator('[data-slot="badge"]')).toHaveCount(1);
    await expect(page.locator('[data-slot="badge"]')).toHaveText("Draft");

    await page.goto("/recruitments");
    // New recruitments are created as "Draft", but the list defaults to the
    // "Live" filter -- switch to "All" so the freshly created draft shows up.
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByText(title)).toBeVisible();

    await page.getByText(title).click();
    await page.getByRole("button", { name: "Live", exact: true }).click();
    await expect(page.locator('[data-slot="badge"]')).toHaveText("Live");

    await page.reload();
    await expect(page.locator('[data-slot="badge"]')).toHaveText("Live");
  });
});

test.describe("HR edits recruitment details from the header menu", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "hr");
  });

  // Protects the recruitment-edit-details risk: the header (a client:load
  // island separate from the edit dialog) must repaint title and metadata
  // in place, with no navigation, and the change must survive a real reload
  // -- not just live in the dialog's own component state.
  test("edit details from the ... menu updates the header without reload and persists", async ({ page }) => {
    const originalTitle = `E2E Edit Role ${Date.now()}`;

    await page.goto("/recruitments/new");
    await expect(async () => {
      await page.getByLabel("Title").fill(originalTitle);
      await page.getByLabel("Department").fill("Engineering");
      await page.getByLabel("Location").fill("Remote");
      await page.getByLabel("Opened date").fill("2026-02-01");
      await page.getByLabel("HR Recruiter").check();
      await expect(page.getByLabel("Title")).toHaveValue(originalTitle);
    }).toPass({ timeout: 10_000 });
    await page.getByRole("button", { name: "Create recruitment" }).click();
    await expect(page).toHaveURL(/\/recruitments\/\d+$/);
    const recruitmentUrl = page.url();

    const updatedTitle = `${originalTitle} (edited)`;

    // RecruitmentHeader is a client:load island; the menu trigger can be
    // clicked before Radix's dropdown finishes attaching, closing again with
    // no visible menu -- retry the open until the item actually appears
    // (same hydration race documented in support/auth.ts).
    await expect(async () => {
      await page.getByRole("button", { name: "Recruitment actions" }).click();
      await expect(page.getByRole("menuitem", { name: "Edit details" })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 10_000 });
    await page.getByRole("menuitem", { name: "Edit details" }).click();

    const dialog = page.getByTestId("edit-recruitment-dialog");
    await expect(dialog.getByRole("heading", { name: "Edit details" })).toBeVisible();

    const titleInput = dialog.getByLabel("Title");
    const departmentInput = dialog.getByLabel("Department");
    await expect(titleInput).toHaveValue(originalTitle);
    await expect(departmentInput).toHaveValue("Engineering");

    await titleInput.fill(updatedTitle);
    await departmentInput.fill("Platform");
    await dialog.getByRole("button", { name: "Save" }).click();

    // Dialog closes and the header (a different subtree) repaints in place --
    // no navigation happened, proving the cross-island event, not a reload,
    // delivered the update.
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(recruitmentUrl);
    await expect(page.getByRole("heading", { name: updatedTitle })).toBeVisible();
    await expect(page.getByText("Department: Platform")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: updatedTitle })).toBeVisible();
    await expect(page.getByText("Department: Platform")).toBeVisible();

    // Cleanup: no delete-recruitment capability exists, so move the fixture
    // out of Draft like the create test above, keeping later Draft-filter
    // assertions from picking up stray fixtures.
    await page.getByRole("button", { name: "Live", exact: true }).click();
    await expect(page.locator('[data-slot="badge"]')).toHaveText("Live");
  });
});
