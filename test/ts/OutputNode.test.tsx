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
        sampleRateHz: 3_200_000,
        centerFrequencyHz: 137_920_000,
      },
    },
  };

  it("renders with result data", () => {
    render(<TestWrapper><OutputNode {...defaultProps} /></TestWrapper>);
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText("audio")).toBeInTheDocument();
    expect(screen.getByText("test-job-123")).toBeInTheDocument();
  });

  it("does not render the synthetic confidence metric", () => {
    render(<TestWrapper><OutputNode {...defaultProps} /></TestWrapper>);
    expect(screen.queryByText("Confidence")).not.toBeInTheDocument();
    expect(screen.queryByText("95.0%")).not.toBeInTheDocument();
  });

  it("renders match rate when provided", () => {
    render(<TestWrapper><OutputNode {...defaultProps} /></TestWrapper>);
    expect(screen.queryByText("Match rate")).not.toBeInTheDocument();
    expect(screen.queryByText("88.0%")).not.toBeInTheDocument();
  });

  it("renders SNR delta when provided", () => {
    render(<TestWrapper><OutputNode {...defaultProps} /></TestWrapper>);
    expect(screen.queryByText("SNR Δ")).not.toBeInTheDocument();
    expect(screen.queryByText("+3.2 dB")).not.toBeInTheDocument();
  });

  it("renders timestamp", () => {
    render(<TestWrapper><OutputNode {...defaultProps} /></TestWrapper>);
    expect(screen.getByText("Timestamp")).toBeInTheDocument();
  });

  it("renders summary when provided", () => {
    render(<TestWrapper><OutputNode {...defaultProps} /></TestWrapper>);
    expect(screen.getByText("Test summary")).toBeInTheDocument();
  });

  it("renders the IQ capture sample rate and center frequency", () => {
    render(<TestWrapper><OutputNode {...defaultProps} /></TestWrapper>);
    expect(screen.getByText("Sample Rate")).toBeInTheDocument();
    expect(screen.getByText("3.2MHz")).toBeInTheDocument();
    expect(screen.getByText("Center Frequency")).toBeInTheDocument();
    expect(screen.getByText("137.9MHz")).toBeInTheDocument();
  });

  it("follows the live spectrum store values when they are available", () => {
    render(
      <TestWrapper
        preloadedState={{
          spectrum: {
            sampleRateHz: 2_000_000,
            frequencyRange: { min: 10_000_000, max: 12_000_000 },
          },
        }}
      >
        <OutputNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(screen.getByText("2.0MHz")).toBeInTheDocument();
    expect(screen.getByText("11.0MHz")).toBeInTheDocument();
    expect(screen.queryByText("3.2MHz")).not.toBeInTheDocument();
    expect(screen.queryByText("137.9MHz")).not.toBeInTheDocument();
  });

  it("renders download button when naptFilePath is provided", () => {
    render(<TestWrapper><OutputNode {...defaultProps} /></TestWrapper>);
    expect(screen.getByText("Download .napt")).toBeInTheDocument();
  });

  it("renders awaiting state when no result", () => {
    const awaitingProps = { data: { label: "Output", state: "idle", result: { jobId: "test-job", confidence: 0.5 } } };
    render(<TestWrapper><OutputNode {...awaitingProps} /></TestWrapper>);
    expect(screen.getByText("Awaiting analysis results")).toBeInTheDocument();
  });

  it("renders processing state when state is not idle or result", () => {
    const processingProps = { data: { label: "Output", state: "processing", result: { jobId: "test-job", confidence: 0.5 } } };
    render(<TestWrapper><OutputNode {...processingProps} /></TestWrapper>);
    expect(screen.getByText(/Processing.../)).toBeInTheDocument();
    expect(screen.getByText(/\(processing\)/)).toBeInTheDocument();
  });

  it("calculates file size in KB for small files", () => {
    const props = { data: { label: "Output", result: { jobId: "test-job", confidence: 0.9, fileSize: 51200 } } };
    render(<TestWrapper><OutputNode {...props} /></TestWrapper>);
    expect(screen.getByText("50.0 KB")).toBeInTheDocument();
  });

  it("calculates file size in MB for large files", () => {
    const props = { data: { label: "Output", result: { jobId: "test-job", confidence: 0.9, fileSize: 1024 * 1024 * 2.5 } } };
    render(<TestWrapper><OutputNode {...props} /></TestWrapper>);
    expect(screen.getByText("2.50 MB")).toBeInTheDocument();
  });

  it("renders vector badge when vector is provided", () => {
    render(<TestWrapper><OutputNode {...defaultProps} /></TestWrapper>);
    expect(screen.getByText("audio")).toBeInTheDocument();
  });

  it("does not render vector badge when vector is not provided", () => {
    const props = { data: { label: "Output", result: { jobId: "test-job", confidence: 0.9 } } };
    render(<TestWrapper><OutputNode {...props} /></TestWrapper>);
    expect(screen.queryByText("audio")).not.toBeInTheDocument();
  });

  it("renders a direct authenticated download link for a completed capture", () => {
    render(
      <TestWrapper>
        <OutputNode
          data={{
            label: "Output",
            result: {
              jobId: "reference-1",
              confidence: 0.9,
              matchRate: 0.9,
              snrDelta: "3 dB",
              summary: "Capture complete",
              naptFilePath: "/api/iq-captures/reference-1/download",
              fileName: "reference-1.napt",
            },
          }}
        />
      </TestWrapper>,
    );

    const download = screen.getByRole("link", { name: "Download .napt" });
    expect(download).toHaveAttribute(
      "href",
      "http://localhost/api/iq-captures/reference-1/download?token=test-token",
    );
    expect(download).toHaveAttribute("download", "reference-1.napt");
  });
});
