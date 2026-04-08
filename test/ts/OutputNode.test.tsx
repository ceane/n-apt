import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
// @ts-ignore - Jest module mapper handles this
import { OutputNode } from "@n-apt/components/react-flow/nodes/OutputNode";
import { TestWrapper } from "./testUtils";

// Mock useAuthentication hook
jest.mock("@n-apt/hooks/useAuthentication", () => ({
  useAuthentication: () => ({
    sessionToken: "test-token",
  }),
}));

// Mock window.open
global.open = jest.fn() as jest.MockedFunction<typeof window.open>;

describe("OutputNode", () => {
  const defaultProps = {
    data: {
      label: "Output",
      vector: "audio",
      naptFilePath: "/test/file.napt",
      result: {
        jobId: "test-job-123",
        confidence: 0.95,
        timestamp: Date.now(),
        summary: "Test summary",
        fileName: "test.napt",
        fileSize: 1024 * 500,
        matchRate: 0.88,
        snrDelta: "+3.2 dB",
      },
    },
  };

  it("renders with result data", () => {
    render(
      <TestWrapper>
        <OutputNode {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText("audio")).toBeInTheDocument();
    expect(screen.getByText("test-job-123")).toBeInTheDocument();
  });

  it("renders confidence metric", () => {
    render(
      <TestWrapper>
        <OutputNode {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText("95.0%")).toBeInTheDocument();
  });

  it("renders match rate when provided", () => {
    render(
      <TestWrapper>
        <OutputNode {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText("88.0%")).toBeInTheDocument();
  });

  it("renders SNR delta when provided", () => {
    render(
      <TestWrapper>
        <OutputNode {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText("+3.2 dB")).toBeInTheDocument();
  });

  it("renders timestamp", () => {
    render(
      <TestWrapper>
        <OutputNode {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText("Timestamp")).toBeInTheDocument();
  });

  it("renders summary when provided", () => {
    render(
      <TestWrapper>
        <OutputNode {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText("Test summary")).toBeInTheDocument();
  });

  it("renders download button when naptFilePath is provided", () => {
    render(
      <TestWrapper>
        <OutputNode {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText("Download .napt")).toBeInTheDocument();
  });

  it("renders awaiting state when no result", () => {
    const awaitingProps = {
      data: {
        label: "Output",
        state: "idle",
      },
    };

    render(
      <TestWrapper>
        <OutputNode {...awaitingProps} />
      </TestWrapper>
    );

    expect(screen.getByText("Awaiting analysis results")).toBeInTheDocument();
  });

  it("renders processing state when state is not idle or result", () => {
    const processingProps = {
      data: {
        label: "Output",
        state: "processing",
      },
    };

    render(
      <TestWrapper>
        <OutputNode {...processingProps} />
      </TestWrapper>
    );

    expect(screen.getByText(/Processing.../)).toBeInTheDocument();
    expect(screen.getByText(/\(processing\)/)).toBeInTheDocument();
  });

  it("calculates file size in KB for small files", () => {
    const smallFileProps = {
      data: {
        label: "Output",
        result: {
          jobId: "test-job",
          confidence: 0.9,
          fileSize: 51200, // 50 KB
        },
      },
    };

    render(
      <TestWrapper>
        <OutputNode {...smallFileProps} />
      </TestWrapper>
    );

    expect(screen.getByText("50.0 KB")).toBeInTheDocument();
  });

  it("calculates file size in MB for large files", () => {
    const largeFileProps = {
      data: {
        label: "Output",
        result: {
          jobId: "test-job",
          confidence: 0.9,
          fileSize: 1024 * 1024 * 2.5, // 2.5 MB
        },
      },
    };

    render(
      <TestWrapper>
        <OutputNode {...largeFileProps} />
      </TestWrapper>
    );

    expect(screen.getByText("2.50 MB")).toBeInTheDocument();
  });

  it("renders vector badge when vector is provided", () => {
    render(
      <TestWrapper>
        <OutputNode {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText("audio")).toBeInTheDocument();
  });

  it("does not render vector badge when vector is not provided", () => {
    const noVectorProps = {
      data: {
        label: "Output",
        result: {
          jobId: "test-job",
          confidence: 0.9,
        },
      },
    };

    render(
      <TestWrapper>
        <OutputNode {...noVectorProps} />
      </TestWrapper>
    );

    expect(screen.queryByText("audio")).not.toBeInTheDocument();
  });
});
