import { expect, type Page } from "@playwright/test";

const PASSWORD = "password123";

export const SEEDED_USERS = {
  hr: "hr.test@example.com",
  hiringManager: "hiring-manager.test@example.com",
  admin: "admin.test@example.com",
  tenantPeer: "tenant-peer.test@example.com",
} as const;

export type SeededUserKey = keyof typeof SEEDED_USERS;

/**
 * Signs in as one of the seeded test users via the real sign-in form.
 * Emails are stable seed data; ids are sequence-assigned and never used here.
 */
export async function signInAs(page: Page, user: SeededUserKey): Promise<void> {
  await page.goto("/auth/signin");
  const email = SEEDED_USERS[user];
  const emailInput = page.getByLabel("Email");
  const passwordInput = page.getByLabel("Password", { exact: true });

  // The sign-in form is a client:load island; if it fills in before hydration
  // attaches React's onChange, the controlled input resets to empty once
  // hydration completes. Retry the fill until the value actually sticks.
  await expect(async () => {
    await emailInput.fill(email);
    await passwordInput.fill(PASSWORD);
    await expect(emailInput).toHaveValue(email);
    await expect(passwordInput).toHaveValue(PASSWORD);
  }).toPass({ timeout: 10_000 });

  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
}
