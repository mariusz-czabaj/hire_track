import { test, expect } from "@playwright/test";
import { signInAs } from "./support/auth";

let recruitmentId: number;

test.beforeAll(async ({ browser }) => {
  // Seed a dedicated recruitment so this spec never touches S-01's seeded
  // "Backend Engineer" recruitment (whose board STAGE_ORDER and 5-candidate
  // count recruitments.spec.ts asserts on). Group 1 is "HR Recruiter" and
  // group 2 is "Hiring Manager" (seed.sql insertion order) -- both are
  // needed so the hiring-manager case below can see this recruitment at all.
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, "hr");
  const response = await page.request.post("/api/recruitments", {
    data: {
      title: "Candidates E2E Role",
      department: "Engineering",
      location: "Remote",
      employmentType: "full-time",
      openedAt: "2026-02-01",
      groupIds: [1, 2],
    },
  });
  const created = (await response.json()) as { id: number };
  recruitmentId = created.id;

  // Every fresh recruitment starts "draft" -- move it off "draft" so it
  // doesn't pollute recruitments.spec.ts's "no other draft recruitments"
  // filter assertion (see kanban-stages.spec.ts for the same fixture hazard).
  await page.request.patch(`/api/recruitments/${recruitmentId}`, { data: { status: "closed" } });

  await context.close();
});

test.describe("HR recruiter manages candidate status", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "hr");
  });

  test("adds a candidate, blocks a note-less move, moves forward and backward, and shows the note on the detail page", async ({
    page,
  }) => {
    await page.goto(`/recruitments/${recruitmentId}`);

    // AddCandidateDialog is a client:load island -- same hydration race as
    // every other form on this board (see support/auth.ts) -- retry each
    // fill until the controlled input's value actually sticks.
    await page.getByTestId("add-candidate-trigger").click();
    const addDialog = page.getByTestId("add-candidate-dialog");
    await expect(async () => {
      await addDialog.getByLabel("Full name").fill("Ada Lovelace");
      await addDialog.getByLabel("Email").fill("ada.lovelace.e2e@example.com");
      await expect(addDialog.getByLabel("Full name")).toHaveValue("Ada Lovelace");
      await expect(addDialog.getByLabel("Email")).toHaveValue("ada.lovelace.e2e@example.com");
    }).toPass({ timeout: 10_000 });
    await addDialog.getByRole("button", { name: "Add candidate" }).click();
    await expect(addDialog).not.toBeVisible();

    const newColumn = page.getByTestId("kanban-columns").locator("> div").nth(0);
    await expect(newColumn.getByText("Ada Lovelace")).toBeVisible();
    await expect(newColumn.getByText(/^Added \d{4}-\d{2}-\d{2}$/)).toBeVisible();

    // Attempt a move with no note -- refused with an actionable message.
    await page.getByRole("button", { name: /^Move candidate \d+: Ada Lovelace$/ }).click();
    const moveDialog = page.getByTestId("move-candidate-dialog");
    await expect(moveDialog.getByLabel("Target stage")).toBeVisible();
    await moveDialog.getByLabel("Target stage").selectOption({ label: "Screening" });
    await moveDialog.getByRole("button", { name: "Move" }).click();
    await expect(moveDialog.getByText("A note for the stage being left is required before moving")).toBeVisible();
    await expect(moveDialog).toBeVisible();

    // Fill the note in the same dialog and complete the move.
    await expect(async () => {
      await moveDialog.getByLabel("Note for the stage being left").fill("Strong technical screen, moving forward.");
      await expect(moveDialog.getByLabel("Note for the stage being left")).toHaveValue(
        "Strong technical screen, moving forward.",
      );
    }).toPass({ timeout: 10_000 });
    await moveDialog.getByRole("button", { name: "Move" }).click();
    await expect(moveDialog).not.toBeVisible();

    const headings = page.getByRole("heading", { level: 2 });
    await expect(headings).toHaveText(["New", "Screening", "Interview", "Offer", "Hired", "Rejected"]);
    const screeningColumn = page.getByTestId("kanban-columns").locator("> div").nth(1);
    await expect(screeningColumn.getByText("Ada Lovelace")).toBeVisible();

    // Move it backwards -- the gate is per stage being left, so the note
    // just written for "New" doesn't carry over: the candidate is now in
    // Screening, which has no note yet, so the textarea starts blank and a
    // note is required again before the backward move is allowed.
    await page.getByRole("button", { name: /^Move candidate \d+: Ada Lovelace$/ }).click();
    await expect(moveDialog.getByLabel("Note for the stage being left")).toHaveValue("");
    await moveDialog.getByLabel("Target stage").selectOption({ label: "New" });
    await moveDialog.getByRole("button", { name: "Move" }).click();
    await expect(moveDialog.getByText("A note for the stage being left is required before moving")).toBeVisible();

    await expect(async () => {
      await moveDialog
        .getByLabel("Note for the stage being left")
        .fill("Screening went well, sending back for a re-interview.");
      await expect(moveDialog.getByLabel("Note for the stage being left")).toHaveValue(
        "Screening went well, sending back for a re-interview.",
      );
    }).toPass({ timeout: 10_000 });
    await moveDialog.getByRole("button", { name: "Move" }).click();
    await expect(moveDialog).not.toBeVisible();

    const newColumnAfterBackwardMove = page.getByTestId("kanban-columns").locator("> div").nth(0);
    await expect(newColumnAfterBackwardMove.getByText("Ada Lovelace")).toBeVisible();

    // Open the detail page and see both notes, one per stage.
    await page.getByText("Ada Lovelace").click();
    await expect(page).toHaveURL(/\/recruitments\/\d+\/candidates\/\d+$/);
    await expect(page.getByText("Strong technical screen, moving forward.")).toBeVisible();
    await expect(page.getByText("Screening went well, sending back for a re-interview.")).toBeVisible();
  });

  test("hiring manager sees the controls but is cleanly denied, and nothing persists after reload", async ({
    page,
  }) => {
    await page.goto(`/recruitments/${recruitmentId}`);
    await page.getByTestId("add-candidate-trigger").click();
    const addDialog = page.getByTestId("add-candidate-dialog");
    await expect(async () => {
      await addDialog.getByLabel("Full name").fill("Grace Hopper");
      await addDialog.getByLabel("Email").fill("grace.hopper.e2e@example.com");
      await expect(addDialog.getByLabel("Full name")).toHaveValue("Grace Hopper");
    }).toPass({ timeout: 10_000 });
    await addDialog.getByRole("button", { name: "Add candidate" }).click();
    await expect(addDialog).not.toBeVisible();

    await signInAs(page, "hiringManager");
    await page.goto(`/recruitments/${recruitmentId}`);
    await expect(page.getByText("Grace Hopper")).toBeVisible();

    await page.getByRole("button", { name: /^Move candidate \d+: Grace Hopper$/ }).click();
    const moveDialog = page.getByTestId("move-candidate-dialog");
    await expect(moveDialog.getByLabel("Target stage")).toBeVisible();
    await moveDialog.getByLabel("Target stage").selectOption({ label: "Screening" });
    await moveDialog.getByLabel("Note for the stage being left").fill("Attempted note by a hiring manager.");
    await moveDialog.getByRole("button", { name: "Move" }).click();
    await expect(moveDialog.getByText("You are not allowed to perform this action")).toBeVisible();

    await page.reload();
    const headings = page.getByRole("heading", { level: 2 });
    const newColumn = page.getByTestId("kanban-columns").locator("> div").nth(0);
    await expect(newColumn.getByText("Grace Hopper")).toBeVisible();
    await expect(headings.nth(1)).toHaveText("Screening");
    const screeningColumn = page.getByTestId("kanban-columns").locator("> div").nth(1);
    await expect(screeningColumn.getByText("Grace Hopper")).not.toBeVisible();
  });
});
