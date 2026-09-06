import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Textarea } from "@/components/ui/textarea";

afterEach(() => {
  cleanup();
});

describe("Textarea", () => {
  it("resolves the control via getByLabelText", () => {
    render(<Textarea id="notes" label="Notes" value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();
  });

  it("sets aria-invalid and aria-describedby when there is an error", () => {
    render(<Textarea id="notes" label="Notes" value="" onChange={vi.fn()} error="Notes are required." />);
    const control = screen.getByLabelText("Notes");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAttribute("aria-describedby", "notes-error");
    expect(screen.getByText("Notes are required.")).toHaveAttribute("id", "notes-error");
  });

  it("does not set aria-invalid or aria-describedby when there is no error", () => {
    render(<Textarea id="notes" label="Notes" value="" onChange={vi.fn()} />);
    const control = screen.getByLabelText("Notes");
    expect(control).toHaveAttribute("aria-invalid", "false");
    expect(control).not.toHaveAttribute("aria-describedby");
  });

  it("marks the control and label as required", () => {
    render(<Textarea id="notes" label="Notes" value="" onChange={vi.fn()} required />);
    const control = screen.getByLabelText(/Notes/);
    expect(control).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("(required)")).toBeInTheDocument();
  });
});
