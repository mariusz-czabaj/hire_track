import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Alert } from "@/components/ui/alert";

afterEach(() => {
  cleanup();
});

describe("Alert", () => {
  it("renders role=alert for the error variant", () => {
    render(<Alert variant="error" message="Something failed." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something failed.");
  });

  it("renders role=status for non-error variants", () => {
    render(<Alert variant="warning" message="Heads up." />);
    expect(screen.getByRole("status")).toHaveTextContent("Heads up.");
  });

  it("renders role=status for the info variant", () => {
    render(<Alert variant="info" message="For your information." />);
    expect(screen.getByRole("status")).toHaveTextContent("For your information.");
  });

  it("renders role=status for the success variant", () => {
    render(<Alert variant="success" message="It worked." />);
    expect(screen.getByRole("status")).toHaveTextContent("It worked.");
  });

  it("renders nothing when there is no message and no children", () => {
    const { container } = render(<Alert variant="error" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders children when no message is given", () => {
    render(
      <Alert variant="info">
        <span>Custom content</span>
      </Alert>,
    );
    expect(screen.getByText("Custom content")).toBeInTheDocument();
  });
});
