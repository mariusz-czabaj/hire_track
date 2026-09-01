import { test, expect } from "@playwright/test";
import { signInAs } from "./support/auth";

const DEFAULT_STAGE_ORDER = ["New", "Screening", "Interview", "Offer", "Hired", "Rejected"];

let recruitmentId: number;

test.beforeAll(async ({ browser }) => {
  // A freshly created recruitment has zero candidates by construction --
  // exactly the state the customization gate requires -- so no extra
  // fixture setup is needed, and this spec never touches S-01's seeded
  // "Backend Engineer" recruitment (which has candidates and would refuse).
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, "hr");
  const response = await page.request.post("/api/recruitments", {
    data: {
      title: "Kanban Stages E2E Role",
      department: "Engineering",
      location: "Remote",
      employmentType: "full-time",
      openedAt: "2026-02-01",
      groupIds: [1],
    },
  });
  const created = (await response.json()) as { id: number };
  recruitmentId = created.id;

  // Every fresh recruitment starts "draft" (create_recruitment has no
  // status param) -- move it off "draft" immediately so it doesn't
  // pollute recruitments.spec.ts's "no other draft recruitments" filter
  // assertion, which otherwise runs after this spec (alphabetical file
  // order) and would see this fixture leak across specs.
  await page.request.patch(`/api/recruitments/${recruitmentId}`, { data: { status: "closed" } });

  await context.close();
});

test.describe("HR customizes kanban stages", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "hr");
  });

  test("rename/add/reorder/remove saves and reflects on the board, then reset restores the defaults", async ({
    page,
  }) => {
    await page.goto(`/recruitments/${recruitmentId}`);

    const headings = page.getByRole("heading", { level: 2 });
    await expect(headings).toHaveText(DEFAULT_STAGE_ORDER);

    await page.getByRole("button", { name: "Edit stages" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("This recruitment inherits the global default stages.")).toBeVisible();

    // StageEditor is a client:load island -- same hydration race as every
    // other form on this board (see support/auth.ts) -- retry each fill
    // until the controlled input's value actually sticks.
    await expect(async () => {
      await dialog.getByLabel("Stage 1 name").fill("Applied");
      await expect(dialog.getByLabel("Stage 1 name")).toHaveValue("Applied");
    }).toPass({ timeout: 10_000 });

    // Remove "Rejected" (stage 6).
    await dialog.getByRole("button", { name: "Remove stage 6" }).click();

    // Add a new stage and name it.
    await dialog.getByRole("button", { name: "Add stage" }).click();
    await expect(async () => {
      await dialog.getByLabel("Stage 6 name").fill("Reference Check");
      await expect(dialog.getByLabel("Stage 6 name")).toHaveValue("Reference Check");
    }).toPass({ timeout: 10_000 });

    // Move the new stage up once, ahead of "Hired".
    await dialog.getByRole("button", { name: "Move stage 6 up" }).click();

    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).not.toBeVisible();

    await expect(headings).toHaveText(["Applied", "Screening", "Interview", "Offer", "Reference Check", "Hired"]);

    // Reopen: the editor now reports a custom set and offers reset.
    await page.getByRole("button", { name: "Edit stages" }).click();
    await expect(dialog.getByText("This recruitment uses a custom stage set.")).toBeVisible();
    await dialog.getByRole("button", { name: "Reset to defaults" }).click();
    await expect(dialog).not.toBeVisible();

    await expect(headings).toHaveText(DEFAULT_STAGE_ORDER);
  });
});
