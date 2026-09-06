import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Mail } from "lucide-react";
import { FormField } from "@/components/ui/form-field";

afterEach(() => {
  cleanup();
});

describe("FormField", () => {
  it("resolves the input via getByLabelText", () => {
    render(<FormField id="email" label="Email" value="" onChange={vi.fn()} icon={<Mail data-testid="icon" />} />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("sets aria-invalid and aria-describedby when there is an error", () => {
    render(
      <FormField id="email" label="Email" value="" onChange={vi.fn()} icon={<Mail />} error="Email is required." />,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "email-error");
    expect(screen.getByText("Email is required.")).toHaveAttribute("id", "email-error");
  });

  it("does not set aria-invalid or aria-describedby when there is no error", () => {
    render(<FormField id="email" label="Email" value="" onChange={vi.fn()} icon={<Mail />} />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("marks the control and label as required", () => {
    render(<FormField id="email" label="Email" value="" onChange={vi.fn()} icon={<Mail />} required />);
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("(required)")).toBeInTheDocument();
  });
});
