import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { FrequencyValidationIntegrationTest } from "./FrequencyValidationIntegrationTest";
import { TestWrapper } from "../ts/testUtils";
import type { CaptureStatus } from "../../src/ts/consts/schemas/websocket";

const mockSendCaptureCommand = jest.fn();
type CaptureStatusWithIdle = CaptureStatus | { status: "idle"; jobId: string };

const mockWebSocketState: {
  isConnected: boolean;
  deviceState: string;
  captureStatus: CaptureStatusWithIdle;
  maxSampleRateHz: number;
  dataRef: { current: { deviceInfo?: string; captureMetadata?: unknown } };
  sendCaptureCommand: typeof mockSendCaptureCommand;
} = {
  isConnected: true,
  deviceState: "connected",
  captureStatus: { status: "idle", jobId: "" },
  maxSampleRateHz: 3200000,
  dataRef: { current: { deviceInfo: "Mock Device" } },
  sendCaptureCommand: mockSendCaptureCommand,
};

jest.mock("../../src/ts/hooks/useWebSocket", () => ({
  useWebSocket: () => mockWebSocketState,
}));

jest.mock("../../src/ts/hooks/useAuthentication", () => ({
  useAuthentication: () => ({
    isAuthenticated: true,
    sessionToken: "mock-token",
  }),
}));

describe("Frequency Validation Integration Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebSocketState.isConnected = true;
    mockWebSocketState.deviceState = "connected";
    mockWebSocketState.captureStatus = { status: "idle", jobId: "" };
    mockWebSocketState.maxSampleRateHz = 3200000;
    mockWebSocketState.dataRef = { current: { deviceInfo: "Mock Device" } };
    mockWebSocketState.sendCaptureCommand = mockSendCaptureCommand;
  });

  describe("Negative Frequency Prevention", () => {
    it("should prevent capture requests with negative frequencies", async () => {
      render(
        <TestWrapper>
          <FrequencyValidationIntegrationTest />
        </TestWrapper>
      );

      fireEvent.change(screen.getByLabelText("Min Frequency (MHz)"), { target: { value: "-10" } });
      fireEvent.change(screen.getByLabelText("Max Frequency (MHz)"), { target: { value: "100" } });

      await act(async () => {
        fireEvent.click(screen.getByText("Capture"));
      });

      expect(screen.getByText(/Negative frequencies are not allowed/)).toBeInTheDocument();
      expect(mockSendCaptureCommand).not.toHaveBeenCalled();
    });

    it("should surface inline validation when min frequency < 0", () => {
      render(
        <TestWrapper>
          <FrequencyValidationIntegrationTest />
        </TestWrapper>
      );

      fireEvent.change(screen.getByLabelText("Min Frequency (MHz)"), { target: { value: "-5" } });

      expect(screen.getByText("Capture")).toBeDisabled();
      expect(screen.getByText(/Negative frequencies are not allowed/)).toBeInTheDocument();
    });

    it("should prevent zero-width 0Hz range", async () => {
      render(
        <TestWrapper>
          <FrequencyValidationIntegrationTest />
        </TestWrapper>
      );

      fireEvent.change(screen.getByLabelText("Min Frequency (MHz)"), { target: { value: "0" } });
      fireEvent.change(screen.getByLabelText("Max Frequency (MHz)"), { target: { value: "0" } });

      await act(async () => {
        fireEvent.click(screen.getByText("Capture"));
      });

      expect(screen.getByText(/Frequency range cannot be zero width/)).toBeInTheDocument();
    });
  });

  describe("Frontend-Backend Frequency Synchronization", () => {
    it("should send correct frequency ranges to backend", async () => {
      render(
        <TestWrapper>
          <FrequencyValidationIntegrationTest />
        </TestWrapper>
      );

      fireEvent.change(screen.getByLabelText("Min Frequency (MHz)"), { target: { value: "100" } });
      fireEvent.change(screen.getByLabelText("Max Frequency (MHz)"), { target: { value: "103.2" } });

      await act(async () => {
        fireEvent.click(screen.getByText("Capture"));
      });

      expect(mockSendCaptureCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          fragments: expect.arrayContaining([
            expect.objectContaining({
              minFreq: 100000000,
              maxFreq: 103200000,
            }),
          ]),
        })
      );
    });

    it("should validate frequency range before sending to backend", async () => {
      render(
        <TestWrapper>
          <FrequencyValidationIntegrationTest />
        </TestWrapper>
      );

      fireEvent.change(screen.getByLabelText("Min Frequency (MHz)"), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText("Max Frequency (MHz)"), { target: { value: "100" } });

      await act(async () => {
        fireEvent.click(screen.getByText("Capture"));
      });

      expect(mockSendCaptureCommand).not.toHaveBeenCalled();
      expect(screen.getByText(/Minimum frequency must be less than maximum frequency/)).toBeInTheDocument();
    });

    it("should handle frequency unit conversions correctly", async () => {
      render(
        <TestWrapper>
          <FrequencyValidationIntegrationTest />
        </TestWrapper>
      );

      fireEvent.change(screen.getByLabelText("Frequency Unit"), { target: { value: "kHz" } });
      fireEvent.change(screen.getByLabelText("Min Frequency (kHz)"), { target: { value: "100000" } });
      fireEvent.change(screen.getByLabelText("Max Frequency (kHz)"), { target: { value: "103200" } });

      await act(async () => {
        fireEvent.click(screen.getByText("Capture"));
      });

      expect(mockSendCaptureCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          fragments: expect.arrayContaining([
            expect.objectContaining({
              minFreq: 100000000,
              maxFreq: 103200000,
            }),
          ]),
        })
      );
    });
  });

  describe("Frequency Range Validation", () => {
    it("should validate frequency range within device limits", async () => {
      render(
        <TestWrapper>
          <FrequencyValidationIntegrationTest />
        </TestWrapper>
      );

      fireEvent.change(screen.getByLabelText("Min Frequency (MHz)"), { target: { value: "1800" } });
      fireEvent.change(screen.getByLabelText("Max Frequency (MHz)"), { target: { value: "1805" } });

      await act(async () => {
        fireEvent.click(screen.getByText("Capture"));
      });

      expect(screen.getByText(/Frequency range outside device capabilities/)).toBeInTheDocument();
    });

    it("should validate bandwidth constraints", async () => {
      render(
        <TestWrapper>
          <FrequencyValidationIntegrationTest />
        </TestWrapper>
      );

      fireEvent.change(screen.getByLabelText("Min Frequency (MHz)"), { target: { value: "100" } });
      fireEvent.change(screen.getByLabelText("Max Frequency (MHz)"), { target: { value: "110" } });

      await act(async () => {
        fireEvent.click(screen.getByText("Capture"));
      });

      expect(screen.getByText(/Bandwidth exceeds sample rate limit/)).toBeInTheDocument();
    });

    it("should handle multiple frequency fragments", async () => {
      render(
        <TestWrapper>
          <FrequencyValidationIntegrationTest />
        </TestWrapper>
      );

      const addRangeButton = screen.getByText("Add Frequency Range");
      fireEvent.click(addRangeButton);

      fireEvent.change(screen.getAllByLabelText("Min Frequency (MHz)")[0], { target: { value: "100" } });
      fireEvent.change(screen.getAllByLabelText("Max Frequency (MHz)")[0], { target: { value: "101.6" } });
      fireEvent.change(screen.getAllByLabelText("Min Frequency (MHz)")[1], { target: { value: "101.6" } });
      fireEvent.change(screen.getAllByLabelText("Max Frequency (MHz)")[1], { target: { value: "103.2" } });

      await act(async () => {
        fireEvent.click(screen.getByText("Capture"));
      });

      expect(mockSendCaptureCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          fragments: expect.arrayContaining([
            expect.objectContaining({
              minFreq: 100000000,
              maxFreq: 101600000,
            }),
            expect.objectContaining({
              minFreq: 101600000,
              maxFreq: 103200000,
            }),
          ]),
        })
      );
    });
  });

  describe("Backend Frequency Validation", () => {
    it("should reject invalid frontend capture requests before backend submission", async () => {
      render(
        <TestWrapper>
          <FrequencyValidationIntegrationTest />
        </TestWrapper>
      );

      fireEvent.change(screen.getByLabelText("Min Frequency (MHz)"), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText("Max Frequency (MHz)"), { target: { value: "100" } });

      await act(async () => {
        fireEvent.click(screen.getByText("Capture"));
      });

      expect(mockSendCaptureCommand).not.toHaveBeenCalled();
      expect(screen.getByText(/Minimum frequency must be less than maximum frequency/)).toBeInTheDocument();
    });

    it("should verify backend captures at correct frequencies", () => {
      mockWebSocketState.captureStatus = {
        status: "done",
        jobId: "test-job-freq",
        downloadUrl: "/api/download?id=test-job-freq",
        filename: "test-capture.napt",
      };
      mockWebSocketState.dataRef = {
        current: {
          deviceInfo: "Mock Device",
          captureMetadata: {
            frequencies: [
              { min: 100000000, max: 103200000, actualMin: 99999950, actualMax: 103200050 },
            ],
          },
        },
      };

      render(
        <TestWrapper>
          <FrequencyValidationIntegrationTest />
        </TestWrapper>
      );

      expect(screen.getByTestId("frequency-validation-test")).toBeInTheDocument();
      expect(screen.getByTestId("frequency-validation")).toHaveTextContent("Requested:");
      expect(screen.getByTestId("frequency-validation")).toHaveTextContent("100.00");
      expect(screen.getByTestId("frequency-validation")).toHaveTextContent("103.20");
      expect(screen.getByTestId("frequency-validation")).toHaveTextContent("99.99995");
      expect(screen.getByTestId("frequency-validation")).toHaveTextContent("103.20005");
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should allow 0Hz frequency for RTL-SDR", () => {
      render(
        <TestWrapper>
          <FrequencyValidationIntegrationTest />
        </TestWrapper>
      );

      fireEvent.change(screen.getByLabelText("Min Frequency (MHz)"), { target: { value: "0" } });
      fireEvent.change(screen.getByLabelText("Max Frequency (MHz)"), { target: { value: "3" } });

      expect(screen.getByText("Capture")).not.toBeDisabled();
      expect(screen.queryByText(/Frequency cannot be zero/)).not.toBeInTheDocument();
    });

    it("should handle extremely large frequency values", () => {
      render(
        <TestWrapper>
          <FrequencyValidationIntegrationTest />
        </TestWrapper>
      );

      fireEvent.change(screen.getByLabelText("Min Frequency (MHz)"), { target: { value: "999999" } });

      expect(screen.getByText("Capture")).toBeDisabled();
      expect(screen.getByText(/Frequency exceeds maximum supported value/)).toBeInTheDocument();
    });

    it("should handle frequency range overlaps", async () => {
      render(
        <TestWrapper>
          <FrequencyValidationIntegrationTest />
        </TestWrapper>
      );

      const addRangeButton = screen.getByText("Add Frequency Range");
      fireEvent.click(addRangeButton);
      fireEvent.change(screen.getAllByLabelText("Min Frequency (MHz)")[0], { target: { value: "100" } });
      fireEvent.change(screen.getAllByLabelText("Max Frequency (MHz)")[0], { target: { value: "102" } });
      fireEvent.change(screen.getAllByLabelText("Min Frequency (MHz)")[1], { target: { value: "101" } });
      fireEvent.change(screen.getAllByLabelText("Max Frequency (MHz)")[1], { target: { value: "103" } });

      await act(async () => {
        fireEvent.click(screen.getByText("Capture"));
      });

      expect(screen.getAllByText(/Frequency ranges cannot overlap/).length).toBeGreaterThan(0);
    });
  });
});
