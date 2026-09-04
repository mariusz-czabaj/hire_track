import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { handleSecurityGroupError } from "@/lib/api/security-group-errors";
import { operationSchema } from "@/types";

async function readBody(response: Response) {
  return (await response.json()) as { error: { code: string; message: string } };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleSecurityGroupError", () => {
  // Oracle: the plan's Phase 3 error-mapper contract, one branch per errcode
  // the layer can raise. Each case catches a different regression -- an
  // unmapped code silently degrading to a 500 is the specific failure this
  // mapper exists to prevent.
  it.each([
    ["42501", 403, "forbidden"],
    ["23505", 422, "invalid_request"],
    ["23503", 422, "invalid_request"],
    ["22023", 422, "invalid_request"],
    ["PA006", 422, "last_admin_required"],
  ])("maps errcode %s to %i %s", async (code, status, errorCode) => {
    const response = handleSecurityGroupError({ code, message: "db message" });
    expect(response.status).toBe(status);
    expect((await readBody(response)).error.code).toBe(errorCode);
  });

  it("surfaces the database message for the constraint-violation branches", async () => {
    const response = handleSecurityGroupError({
      code: "23505",
      message: 'duplicate key value violates unique constraint "security_groups_name_key"',
    });
    expect((await readBody(response)).error.message).toContain("security_groups_name_key");
  });

  it("carries an explanatory message when PA006 arrives without one", async () => {
    const response = handleSecurityGroupError({ code: "PA006" });
    expect((await readBody(response)).error.message).toMatch(/administrator/i);
  });

  it("logs and returns 500 for an unmapped errcode", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = { code: "XX000", message: "some unmapped failure" };

    const response = handleSecurityGroupError(error);

    expect(response.status).toBe(500);
    expect((await readBody(response)).error.code).toBe("internal");
    expect(consoleError).toHaveBeenCalledWith(error);
  });

  it("logs and returns 500 for an error carrying no code at all", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = handleSecurityGroupError(new Error("network down"));

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalled();
  });
});

describe("admin input validation", () => {
  // Mirrors the schema the group create/rename routes apply.
  const nameSchema = z.string().trim().min(1).max(100);

  it.each([
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["over the length cap", "x".repeat(101)],
  ])("rejects a group name that is %s", (_label, value) => {
    expect(nameSchema.safeParse(value).success).toBe(false);
  });

  it("accepts a valid name and trims surrounding whitespace", () => {
    const parsed = nameSchema.safeParse("  Administrators  ");
    expect(parsed.success && parsed.data).toBe("Administrators");
  });

  it.each([["recruitment.read"], ["recruitment.write"], ["candidate.read"], ["candidate.write"], ["group.manage"]])(
    "accepts %s as a catalog operation",
    (operation) => {
      expect(operationSchema.safeParse(operation).success).toBe(true);
    },
  );

  it.each([
    ["out of catalog", "group.delete"],
    ["empty", ""],
    ["close but wrong case", "Group.Manage"],
  ])("rejects an operation that is %s", (_label, value) => {
    expect(operationSchema.safeParse(value).success).toBe(false);
  });

  it("covers exactly the five catalog values", () => {
    // Guards the drift note in types.ts: a migration altering the enum must
    // update the schema in the same commit.
    expect([...operationSchema.options].sort()).toEqual(
      ["candidate.read", "candidate.write", "group.manage", "recruitment.read", "recruitment.write"].sort(),
    );
  });
});
