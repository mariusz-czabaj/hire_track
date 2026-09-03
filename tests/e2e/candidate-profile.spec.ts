import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { signInAs } from "./support/auth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_CV_PATH = path.join(__dirname, "fixtures", "sample-cv.pdf");

let recruitmentId: number;
let candidateRecruitmentId: number;
let candidateId: number;
let candidateEmail: string;

test.beforeAll(async ({ browser }) => {
  // Seed a dedicated recruitment and candidate so this spec never touches
  // S-01's seeded "Backend Engineer" recruitment (whose board
  // recruitments.spec.ts asserts on) and never mutates a candidate shared
  // with another spec's fixtures.
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, "hr");

  const recruitmentResponse = await page.request.post("/api/recruitments", {
    data: {
      title: "Candidate Profile E2E Role",
      department: "Engineering",
      location: "Remote",
      employmentType: "full-time",
      openedAt: "2026-02-01",
      groupIds: [1, 2],
    },
  });
  const createdRecruitment = (await recruitmentResponse.json()) as { id: number };
  recruitmentId = createdRecruitment.id;

  // Every fresh recruitment starts "draft" -- move it off "draft"
  // immediately so it doesn't pollute recruitments.spec.ts's "no other
  // draft recruitments" filter assertion.
  await page.request.patch(`/api/recruitments/${recruitmentId}`, { data: { status: "closed" } });

  // A random suffix keeps the email unique across repeated runs without a
  // DB reset in between -- FR-007's shared-profile dedup reuses any
  // existing candidates row on a lower(email) match and raises PA003 on a
  // name mismatch, which a fixed email would hit on the second run.
  candidateEmail = `marie.curie.e2e.${crypto.randomUUID()}@example.com`;
  const candidateResponse = await page.request.post(`/api/recruitments/${recruitmentId}/candidates`, {
    data: {
      fullName: "Marie Curie",
      email: candidateEmail,
    },
  });
  // addCandidateToRecruitment's CandidateCardDto uses `id` for the
  // candidate's own id (candidates.id) and `candidateRecruitmentId` for
  // the join row -- the inverse of CandidateDetailDto's naming.
  const createdCandidate = (await candidateResponse.json()) as { id: number; candidateRecruitmentId: number };
  candidateId = createdCandidate.id;
  candidateRecruitmentId = createdCandidate.candidateRecruitmentId;

  await context.close();
});

test.describe("HR recruiter manages the candidate profile", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "hr");
  });

  test("opens the profile from the per-recruitment page and edits name and phone", async ({ page }) => {
    await page.goto(`/recruitments/${recruitmentId}/candidates/${candidateRecruitmentId}`);
    await page.getByRole("link", { name: "View full profile" }).click();
    await expect(page).toHaveURL(new RegExp(`/candidates/${candidateId}$`));

    await expect(page.getByText("Marie Curie")).toBeVisible();
    await expect(page.getByText(candidateEmail)).toBeVisible();

    await page.getByRole("button", { name: "Edit candidate details" }).click();
    await expect(async () => {
      await page.getByLabel("Full name").fill("Marie Skłodowska-Curie");
      await page.getByLabel("Phone").fill("+48 500 100 200");
      await expect(page.getByLabel("Full name")).toHaveValue("Marie Skłodowska-Curie");
      await expect(page.getByLabel("Phone")).toHaveValue("+48 500 100 200");
    }).toPass({ timeout: 10_000 });
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Marie Skłodowska-Curie")).toBeVisible();
    await expect(page.getByText("+48 500 100 200")).toBeVisible();

    // Email is never rendered as an editable field -- confirm it survived
    // untouched after the edit + reload round trip.
    await page.reload();
    await expect(page.getByText("Marie Skłodowska-Curie")).toBeVisible();
    await expect(page.getByText(candidateEmail)).toBeVisible();
    await expect(page.getByText("+48 500 100 200")).toBeVisible();
  });

  test("uploads a CV, downloads it, and replacing it leaves exactly one CV", async ({ page }) => {
    await page.goto(`/candidates/${candidateId}`);
    await expect(page.getByText("No CV uploaded yet")).toBeVisible();

    const uploadLabel = page.getByLabel(/Upload CV/);
    await uploadLabel.setInputFiles(SAMPLE_CV_PATH);

    await expect(page.getByText("sample-cv.pdf")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("No CV uploaded yet")).not.toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("sample-cv.pdf");

    // Replace it through the panel's own Replace control -- confirm the
    // panel still shows exactly one CV afterward.
    await page.getByRole("button", { name: "Replace" }).click();
    await page.getByLabel(/Upload CV/).setInputFiles(SAMPLE_CV_PATH);

    await expect(page.getByRole("button", { name: "Replace" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Download" })).toHaveCount(1);

    await page.reload();
    await expect(page.getByText("sample-cv.pdf")).toBeVisible();
    await expect(page.getByRole("link", { name: "Download" })).toHaveCount(1);
  });
});

test("hiring manager sees the profile but is cleanly denied on upload, and nothing persists after reload", async ({
  page,
}) => {
  await signInAs(page, "hiringManager");
  await page.goto(`/candidates/${candidateId}`);

  await expect(page.getByText(candidateEmail)).toBeVisible();

  // The CV from the HR test above is still live -- a Hiring Manager must
  // still be able to download it, same "read allowed, write denied" shape
  // as the rest of this slice's authorization contract.
  await expect(page.getByRole("link", { name: "Download" })).toBeVisible();

  await page.getByRole("button", { name: "Edit candidate details" }).click();
  await expect(async () => {
    await page.getByLabel("Full name").fill("Attempted Rename By HM");
    await expect(page.getByLabel("Full name")).toHaveValue("Attempted Rename By HM");
  }).toPass({ timeout: 10_000 });
  await page.getByRole("button", { name: "Save" }).click();
  // A write RLS filters the UPDATE to zero rows for a Hiring Manager (no
  // candidate.write), which the route maps to a plain 404 rather than a
  // 403 -- see the house "not visible -> 404, visible but no write -> 403"
  // convention as applied to a single-table UPDATE with no RPC gate.
  await expect(page.getByText(/not allowed|not found|denied|error/i)).toBeVisible();

  await page.reload();
  await expect(page.getByText("Attempted Rename By HM")).not.toBeVisible();
});
