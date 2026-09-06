import { test, expect, type Locator, type Page } from "@playwright/test";
import { signInAs } from "./support/auth";

/**
 * Covers the risk this slice (S-11) introduces: dnd-kit's pointer/keyboard
 * sensors drive KanbanBoard's onDragEnd, which must open MoveCandidateDialog
 * pre-filled with the dropped-on column's stage rather than writing anything
 * directly -- the mandatory move-note rule (FR-013) stays gated behind the
 * dialog's own confirm step. See plan.md Phase 4.
 */

async function addCandidate(page: Page, recruitmentId: number, fullName: string, email: string): Promise<void> {
  const response = await page.request.post(`/api/recruitments/${recruitmentId}/candidates`, {
    data: { fullName, email },
  });
  expect(response.ok()).toBe(true);
}

// dnd-kit's PointerSensor needs a real sequence of intermediate pointer
// moves past its activation distance -- Playwright's dragTo() moves in a
// single jump and never crosses that threshold, so onDragEnd sees the same
// column it started in. Stepping the mouse mirrors an actual drag gesture.
async function dragCardOnto(page: Page, card: Locator, target: Locator): Promise<void> {
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("Could not resolve drag source/target bounding boxes");

  const fromX = from.x + from.width / 2;
  const fromY = from.y + from.height / 2;
  const toX = to.x + to.width / 2;
  const toY = to.y + to.height / 2;

  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(fromX + ((toX - fromX) * i) / steps, fromY + ((toY - fromY) * i) / steps);
  }
  await page.mouse.up();
}

test.describe("HR recruiter drags a candidate card between kanban columns", () => {
  let recruitmentId: number;

  test.beforeAll(async ({ browser }) => {
    // A dedicated recruitment isolates this spec from other kanban specs'
    // board assertions (see kanban-stages.spec.ts / candidates.spec.ts for
    // the same fixture-leak hazard).
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAs(page, "hr");
    const response = await page.request.post("/api/recruitments", {
      data: {
        title: "Drag and Drop E2E Role",
        department: "Engineering",
        location: "Remote",
        employmentType: "full-time",
        openedAt: "2026-02-01",
        groupIds: [1],
      },
    });
    const created = (await response.json()) as { id: number };
    recruitmentId = created.id;

    // Every fresh recruitment starts "draft" -- move it off "draft" so it
    // doesn't pollute recruitments.spec.ts's "no other draft recruitments"
    // filter assertion.
    await page.request.patch(`/api/recruitments/${recruitmentId}`, { data: { status: "closed" } });

    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    await signInAs(page, "hr");
  });

  test("mouse-drags a card onto a different column, opening the dialog pre-filled with that stage", async ({
    page,
  }) => {
    const fullName = `Mouse Drag Candidate ${Date.now()}`;
    await addCandidate(page, recruitmentId, fullName, `mouse.drag.${Date.now()}@example.com`);
    await page.goto(`/recruitments/${recruitmentId}`);

    const card = page.locator('[aria-roledescription="draggable"]', { has: page.getByText(fullName) });
    const screeningHeading = page.getByRole("heading", { name: "Screening" });

    await dragCardOnto(page, card, screeningHeading);

    const dialog = page.getByTestId("move-candidate-dialog");
    await expect(dialog.getByLabel("Target stage").locator("option:checked")).toHaveText("Screening");

    // The drop is only a shortcut to open the dialog -- nothing is written
    // to the candidate's stage until the note is provided and confirmed.
    await expect(async () => {
      await dialog.getByLabel("Note for the stage being left").fill("Moved forward via mouse drag.");
      await expect(dialog.getByLabel("Note for the stage being left")).toHaveValue("Moved forward via mouse drag.");
    }).toPass({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Move" }).click();
    await expect(dialog).not.toBeVisible();

    const screeningColumn = page.getByTestId("kanban-columns").locator("> div").nth(1);
    await expect(screeningColumn.getByText(fullName)).toBeVisible();
  });

  test("keyboard-drags a card onto a different column via Tab, Space, Arrow keys, Space", async ({ page }) => {
    const fullName = `Keyboard Drag Candidate ${Date.now()}`;
    await addCandidate(page, recruitmentId, fullName, `keyboard.drag.${Date.now()}@example.com`);
    await page.goto(`/recruitments/${recruitmentId}`);

    const draggableCard = page.locator('[aria-roledescription="draggable"]', { has: page.getByText(fullName) });
    await draggableCard.focus();
    await page.keyboard.press("Space");
    // dnd-kit's default keyboard sensor moves a fixed distance per press;
    // enough presses are needed to cross from the New column into the
    // adjacent Screening column's droppable rect. Collision detection runs
    // asynchronously after each press, so wait for the live-region
    // announcement to confirm dnd-kit has registered "Screening" as the
    // current droppable before dropping -- pressing the final Space
    // immediately after the last arrow key races that state update and
    // intermittently drops onto no column at all.
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("ArrowRight");
    }
    await expect(page.getByRole("status")).toHaveText(/is over the Screening column/);
    await page.keyboard.press("Space");

    const dialog = page.getByTestId("move-candidate-dialog");
    await expect(dialog.getByLabel("Target stage").locator("option:checked")).toHaveText("Screening");

    await expect(async () => {
      await dialog.getByLabel("Note for the stage being left").fill("Moved forward via keyboard drag.");
      await expect(dialog.getByLabel("Note for the stage being left")).toHaveValue("Moved forward via keyboard drag.");
    }).toPass({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Move" }).click();
    await expect(dialog).not.toBeVisible();

    const screeningColumn = page.getByTestId("kanban-columns").locator("> div").nth(1);
    await expect(screeningColumn.getByText(fullName)).toBeVisible();
  });

  test("cancelling the dialog after a drop leaves the card in its original column", async ({ page }) => {
    const fullName = `Cancelled Drag Candidate ${Date.now()}`;
    await addCandidate(page, recruitmentId, fullName, `cancel.drag.${Date.now()}@example.com`);
    await page.goto(`/recruitments/${recruitmentId}`);

    const card = page.locator('[aria-roledescription="draggable"]', { has: page.getByText(fullName) });
    const screeningHeading = page.getByRole("heading", { name: "Screening" });

    await dragCardOnto(page, card, screeningHeading);

    const dialog = page.getByTestId("move-candidate-dialog");
    await expect(dialog.getByLabel("Target stage").locator("option:checked")).toHaveText("Screening");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).not.toBeVisible();

    const newColumn = page.getByTestId("kanban-columns").locator("> div").nth(0);
    await expect(newColumn.getByText(fullName)).toBeVisible();
    const screeningColumn = page.getByTestId("kanban-columns").locator("> div").nth(1);
    await expect(screeningColumn.getByText(fullName)).not.toBeVisible();

    // No move was recorded even after a reload.
    await page.reload();
    await expect(newColumn.getByText(fullName)).toBeVisible();
  });
});
