import { z } from "zod";
import { employmentTypeSchema } from "@/types";

/**
 * Single source of truth for recruitment field rules, shared by the create
 * and edit paths so their bounds cannot drift (see plan.md's rationale).
 */
export const titleSchema = z
  .string()
  .trim()
  .min(1, "Title is required")
  .max(200, "Title must be 200 characters or fewer");

export const departmentSchema = z
  .string()
  .trim()
  .max(120, "Department must be 120 characters or fewer")
  .min(1, "Department is required");

export const locationSchema = z
  .string()
  .trim()
  .max(120, "Location must be 120 characters or fewer")
  .min(1, "Location is required");

export { employmentTypeSchema };

/**
 * A real YYYY-MM-DD calendar date, not merely a non-empty string --
 * rejects both free text and impossible dates like 2026-02-30.
 */
export const openedAtSchema = z
  .string()
  .min(1, "Opened date is required")
  .refine(
    (value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    },
    { message: "Opened date must be a valid date" },
  );

/** Empty and whitespace-only strings normalize to `null` before hitting the database. */
function nullableTrimmed(schema: z.ZodString, message: string) {
  return z
    .string()
    .nullable()
    .transform((value) => (value === null ? null : value.trim() === "" ? null : value.trim()))
    .refine((value) => value === null || schema.safeParse(value).success, { message });
}

export const createRecruitmentDetailsSchema = z.object({
  title: titleSchema,
  department: departmentSchema,
  location: locationSchema,
  employmentType: employmentTypeSchema,
  openedAt: openedAtSchema,
});

export const editRecruitmentDetailsSchema = z.object({
  title: titleSchema,
  department: nullableTrimmed(departmentSchema, "Department must be 120 characters or fewer"),
  location: nullableTrimmed(locationSchema, "Location must be 120 characters or fewer"),
  employmentType: employmentTypeSchema.nullable(),
  openedAt: z
    .string()
    .nullable()
    .refine((value) => value === null || openedAtSchema.safeParse(value).success, {
      message: "Opened date must be a valid date",
    }),
});
