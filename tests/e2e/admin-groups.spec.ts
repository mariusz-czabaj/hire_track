import { test, expect } from "@playwright/test";
import { signInAs } from "./support/auth";

test.describe("Admin security groups", () => {
  test("Administrator sees the seeded security groups listed by name", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/admin/groups");

    await expect(page.getByRole("heading", { name: "Security groups" })).toBeVisible();
    await expect(page.getByText("HR Recruiter")).toBeVisible();
    await expect(page.getByText("Hiring Manager")).toBeVisible();
    await expect(page.getByText("Administrator")).toBeVisible();
  });

  test("HR recruiter without group.manage sees the authorization-gate message", async ({ page }) => {
    await signInAs(page, "hr");
    await page.goto("/admin/groups");

    await expect(page.getByText("You are not authorized to view this page.")).toBeVisible();
  });

  test("creating a group via the form adds it to the list", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/admin/groups");

    const groupName = `E2E Test Group ${Date.now()}`;
    await page.getByPlaceholder("New group name").fill(groupName);
    await page.getByRole("button", { name: "Create group" }).click();

    await expect(page.getByText(groupName)).toBeVisible();
  });
});
