import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FileInput } from "@/components/ui/file-input";

afterEach(() => {
  cleanup();
});

describe("FileInput", () => {
  it("resolves the control via getByLabelText", () => {
    render(<FileInput id="cv" label="CV" onFileSelected={vi.fn()} />);
    expect(screen.getByLabelText("CV")).toBeInTheDocument();
  });

  it("sets aria-invalid and aria-describedby when there is an error", () => {
    render(<FileInput id="cv" label="CV" onFileSelected={vi.fn()} error="A file is required." />);
    const control = screen.getByLabelText("CV");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAttribute("aria-describedby", "cv-error");
    expect(screen.getByText("A file is required.")).toHaveAttribute("id", "cv-error");
  });

  it("does not set aria-invalid or aria-describedby when there is no error", () => {
    render(<FileInput id="cv" label="CV" onFileSelected={vi.fn()} />);
    const control = screen.getByLabelText("CV");
    expect(control).toHaveAttribute("aria-invalid", "false");
    expect(control).not.toHaveAttribute("aria-describedby");
  });

  it("marks the control and label as required", () => {
    render(<FileInput id="cv" label="CV" onFileSelected={vi.fn()} required />);
    const control = screen.getByLabelText(/CV/);
    expect(control).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("(required)")).toBeInTheDocument();
  });
});
