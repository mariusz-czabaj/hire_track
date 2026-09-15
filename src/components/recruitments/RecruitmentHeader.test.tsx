import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { RecruitmentHeader } from "@/components/recruitments/RecruitmentHeader";
import { RECRUITMENT_STATUS_CHANGED_EVENT } from "@/lib/recruitment-status-events";
import { dispatchRecruitmentDetailsChanged } from "@/lib/recruitment-details-events";
import type { RecruitmentDetailDto } from "@/types";

const RECRUITMENT: RecruitmentDetailDto = {
  id: 1,
  title: "Backend Engineer",
  status: "draft",
  department: "Engineering",
  location: "Remote",
  employmentType: "full-time",
  openedAt: "2026-01-01",
};

afterEach(() => {
  cleanup();
});

describe("RecruitmentHeader", () => {
  it("renders title, status and metadata from props", () => {
    render(<RecruitmentHeader recruitment={RECRUITMENT} canEdit={false} />);

    expect(screen.getByRole("heading", { name: "Backend Engineer" })).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Engineering", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Remote", { exact: false })).toBeInTheDocument();
  });

  it("hides the actions menu when canEdit is false", () => {
    render(<RecruitmentHeader recruitment={RECRUITMENT} canEdit={false} />);

    expect(screen.queryByRole("button", { name: "Recruitment actions" })).not.toBeInTheDocument();
  });

  it("shows the actions menu when canEdit is true", () => {
    render(<RecruitmentHeader recruitment={RECRUITMENT} canEdit />);

    expect(screen.getByRole("button", { name: "Recruitment actions" })).toBeInTheDocument();
  });

  it("repaints the status badge on a status-changed event for this recruitment", () => {
    render(<RecruitmentHeader recruitment={RECRUITMENT} canEdit={false} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(RECRUITMENT_STATUS_CHANGED_EVENT, {
          detail: { recruitmentId: "1", status: "live" },
        }),
      );
    });

    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("ignores a status-changed event for a different recruitment", () => {
    render(<RecruitmentHeader recruitment={RECRUITMENT} canEdit={false} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(RECRUITMENT_STATUS_CHANGED_EVENT, {
          detail: { recruitmentId: "999", status: "live" },
        }),
      );
    });

    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("repaints title and metadata on a details-changed event for this recruitment", () => {
    render(<RecruitmentHeader recruitment={RECRUITMENT} canEdit={false} />);

    act(() => {
      dispatchRecruitmentDetailsChanged({
        recruitmentId: "1",
        recruitment: { ...RECRUITMENT, title: "Senior Backend Engineer", department: null },
      });
    });

    expect(screen.getByRole("heading", { name: "Senior Backend Engineer" })).toBeInTheDocument();
    expect(screen.queryByText("Engineering", { exact: false })).not.toBeInTheDocument();
  });
});
