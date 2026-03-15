import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { FileWorker3Point2MHzTest } from "./FileWorker3Point2MHzTest";
import { TestWrapper } from "../ts/testUtils";

// Mock the fileWorker
const mockFileWorker = {
  postMessage: jest.fn(),
  terminate: jest.fn(),
  onmessage: null,
  onerror: null,
};

// Mock Worker constructor
global.Worker = jest.fn(() => mockFileWorker) as any;

describe("FileWorker 3.2MHz Sample Rate Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock worker state
    mockFileWorker.postMessage.mockClear();
    mockFileWorker.terminate.mockClear();
  });

  describe("3.2MHz Default Sample Rate Enforcement", () => {
    it("should use 3.2MHz as default sample rate when metadata missing", async () => {
      render(
        <TestWrapper>
          <FileWorker3Point2MHzTest />
        </TestWrapper>
      );

      const testButton = screen.getByTestId("test-3.2MHz-default");

      await act(async () => {
        fireEvent.click(testButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/Default sample rate applied when metadata missing/)).toBeInTheDocument();
      });
    });

    it("should enforce 3.2MHz limit in channel stitching calculations", async () => {
      render(
        <TestWrapper>
          <FileWorker3Point2MHzTest />
        </TestWrapper>
      );

      const testButton = screen.getByTestId("test-channel-stitching");

      await act(async () => {
        fireEvent.click(testButton);
      });

      // Simulate worker response with stitching calculation
      const workerMessage = {
        type: "result",
        id: expect.any(String),
        data: {
          stitchedData: {
            waveform: new Float32Array(8192),
            range: { min: 100, max: 103.2 } // 3.2MHz span
          }
        }
      };

      // Mock the worker onmessage handler
      if (typeof mockFileWorker.onmessage === "function") {
        (mockFileWorker.onmessage as (event: { data: unknown }) => void)({ data: workerMessage });
      }

      await waitFor(() => {
        expect(screen.getByText(/Adjacent channels detected/)).toBeInTheDocument();
        expect(screen.getByText(/Overlap within 3.2MHz tolerance/)).toBeInTheDocument();
      });
    });

    it("should handle files with invalid sample rates by clamping to 3.2MHz", async () => {
      render(
        <TestWrapper>
          <FileWorker3Point2MHzTest />
        </TestWrapper>
      );

      const testButton = screen.getByTestId("test-invalid-sample-rate");

      await act(async () => {
        fireEvent.click(testButton);
      });

      // Should show warning about sample rate being clamped
      await waitFor(() => {
        expect(screen.getByText(/Sample rate clamped to 3.2MHz/)).toBeInTheDocument();
      });
    });
  });

  describe("Frequency Range Validation at 3.2MHz", () => {
    it("should validate frequency ranges against 3.2MHz bandwidth", async () => {
      render(
        <TestWrapper>
          <FileWorker3Point2MHzTest />
        </TestWrapper>
      );

      const testButton = screen.getByTestId("test-frequency-validation");

      await act(async () => {
        fireEvent.click(testButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/Frequency range exceeds 3.2MHz limit/)).toBeInTheDocument();
      });
    });

    it("should detect when frequency range exceeds 3.2MHz sample rate", async () => {
      render(
        <TestWrapper>
          <FileWorker3Point2MHzTest />
        </TestWrapper>
      );

      const testButton = screen.getByTestId("test-frequency-exceeds");

      await act(async () => {
        fireEvent.click(testButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/Frequency range exceeds 3.2MHz limit/)).toBeInTheDocument();
      });
    });

    it("should calculate correct frequency bins for 3.2MHz sample rate", async () => {
      render(
        <TestWrapper>
          <FileWorker3Point2MHzTest />
        </TestWrapper>
      );

      const testButton = screen.getByTestId("test-frequency-bins");

      await act(async () => {
        fireEvent.click(testButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/Frequency bins calculated for 3.2MHz/)).toBeInTheDocument();
        expect(screen.getByText(/Bin count: 8192/)).toBeInTheDocument(); // Typical FFT size
      });
    });
  });

  describe("Multi-Channel 3.2MHz Processing", () => {
    it("should stitch multiple channels at 3.2MHz correctly", async () => {
      render(
        <TestWrapper>
          <FileWorker3Point2MHzTest />
        </TestWrapper>
      );

      const testButton = screen.getByTestId("test-multi-channel-stitch");

      await act(async () => {
        fireEvent.click(testButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/Multi-channel stitching at 3.2MHz/)).toBeInTheDocument();
        expect(screen.getByText(/Channels processed: 2/)).toBeInTheDocument();
      });
    });

    it("should handle adjacent channels with 3.2MHz overlap", async () => {
      render(
        <TestWrapper>
          <FileWorker3Point2MHzTest />
        </TestWrapper>
      );

      const testButton = screen.getByTestId("test-adjacent-channels");

      await act(async () => {
        fireEvent.click(testButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/Adjacent channels detected/)).toBeInTheDocument();
        expect(screen.getByText(/Overlap within 3.2MHz tolerance/)).toBeInTheDocument();
      });
    });

    it("should prevent gaps larger than 3.2MHz between channels", async () => {
      render(
        <TestWrapper>
          <FileWorker3Point2MHzTest />
        </TestWrapper>
      );

      const testButton = screen.getByTestId("test-channel-gaps");

      await act(async () => {
        fireEvent.click(testButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/Channel gap exceeds 3.2MHz/)).toBeInTheDocument();
        expect(screen.getByText(/Gap detected: 2.8MHz/)).toBeInTheDocument();
      });
    });
  });

  describe("File Format 3.2MHz Validation", () => {
    it("should validate .napt files contain 3.2MHz sample rate metadata", async () => {
      render(
        <TestWrapper>
          <FileWorker3Point2MHzTest />
        </TestWrapper>
      );

      const testButton = screen.getByTestId("test-napt-validation");

      await act(async () => {
        fireEvent.click(testButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/NAPT file validated/)).toBeInTheDocument();
        expect(screen.getByText(/Sample rate: 3200000 Hz/)).toBeInTheDocument();
      });
    });

    it("should validate .wav files with 3.2MHz sample rate", async () => {
      render(
        <TestWrapper>
          <FileWorker3Point2MHzTest />
        </TestWrapper>
      );

      const testButton = screen.getByTestId("test-wav-validation");

      await act(async () => {
        fireEvent.click(testButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/WAV file validated/)).toBeInTheDocument();
        expect(screen.getByText(/Hardware sample rate: 3.2MHz/)).toBeInTheDocument();
      });
    });

    it("should reject files with sample rates exceeding 3.2MHz", async () => {
      render(
        <TestWrapper>
          <FileWorker3Point2MHzTest />
        </TestWrapper>
      );

      const testButton = screen.getByTestId("test-reject-high-sample-rate");

      await act(async () => {
        fireEvent.click(testButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/File rejected/)).toBeInTheDocument();
        expect(screen.getByText(/Sample rate too high: 4.0MHz/)).toBeInTheDocument();
      });
    });
  });

  describe("Real-time 3.2MHz Processing", () => {
    it("should process real-time data at 3.2MHz sample rate", async () => {
      render(
        <TestWrapper>
          <FileWorker3Point2MHzTest />
        </TestWrapper>
      );

      const testButton = screen.getByTestId("test-realtime-processing");

      await act(async () => {
        fireEvent.click(testButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/Real-time processing at 3.2MHz/)).toBeInTheDocument();
        expect(screen.getByText(/Processing rate: 3200000 samples\/s/)).toBeInTheDocument();
      });
    });

    it("should handle buffer overflow protection at 3.2MHz", async () => {
      render(
        <TestWrapper>
          <FileWorker3Point2MHzTest />
        </TestWrapper>
      );

      const testButton = screen.getByTestId("test-buffer-protection");

      await act(async () => {
        fireEvent.click(testButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/Buffer protection active/)).toBeInTheDocument();
        expect(screen.getByText(/Max buffer size: 3.2MHz samples/)).toBeInTheDocument();
      });
    });
  });

  describe("Error Handling for 3.2MHz Violations", () => {
    it("should throw error for sample rate below minimum", async () => {
      render(
        <TestWrapper>
          <FileWorker3Point2MHzTest />
        </TestWrapper>
      );

      const testButton = screen.getByTestId("test-low-sample-rate");

      await act(async () => {
        fireEvent.click(testButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/Sample rate too low/)).toBeInTheDocument();
        expect(screen.getByText(/Minimum: 1.0MHz, Requested: 0.5MHz/)).toBeInTheDocument();
      });
    });

    it("should handle corrupted 3.2MHz metadata gracefully", async () => {
      render(
        <TestWrapper>
          <FileWorker3Point2MHzTest />
        </TestWrapper>
      );

      const testButton = screen.getByTestId("test-corrupted-metadata");

      await act(async () => {
        fireEvent.click(testButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/Metadata corrupted/)).toBeInTheDocument();
        expect(screen.getByText(/Falling back to 3.2MHz default/)).toBeInTheDocument();
      });
    });
  });
});
