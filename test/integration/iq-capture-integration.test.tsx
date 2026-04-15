import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { IQCaptureIntegrationTest } from "./IQCaptureIntegrationTest";
import { TestWrapper } from "../ts/testUtils";
import type { CaptureStatus } from "../../src/ts/consts/schemas/websocket";

const mockSendCaptureCommand = jest.fn();
const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => undefined);

const mockWebSocketState: {
  isConnected: boolean;
  deviceState: "connected" | "disconnected" | "loading";
  captureStatus: CaptureStatus;
  maxSampleRateHz: number;
  dataRef: { current: { deviceInfo?: string } };
  sendCaptureCommand: typeof mockSendCaptureCommand;
} = {
  isConnected: true,
  deviceState: "connected",
  captureStatus: null,
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

describe("I/Q Capture Integration Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebSocketState.isConnected = true;
    mockWebSocketState.deviceState = "connected";
    mockWebSocketState.captureStatus = null;
    mockWebSocketState.maxSampleRateHz = 3200000;
    mockWebSocketState.dataRef = { current: { deviceInfo: "Mock Device" } };
    mockWebSocketState.sendCaptureCommand = mockSendCaptureCommand;
  });

  describe("Sample Rate Validation", () => {
    it("should enforce 3.2MHz maximum sample rate", async () => {
      render(
        <TestWrapper>
          <IQCaptureIntegrationTest />
        </TestWrapper>
      );

      // Open the collapsible section
      fireEvent.click(screen.getByText("Take an I/Q Capture"));

      expect(screen.getByLabelText("Hardware sample rate")).toHaveTextContent("3.2MHz");
      expect(screen.getByRole("button", { name: "Capture" })).toBeDisabled();
    });

    it("should block capture requests exceeding 3.2MHz", async () => {
      mockWebSocketState.maxSampleRateHz = 3300000;

      render(
        <TestWrapper>
          <IQCaptureIntegrationTest />
        </TestWrapper>
      );

      // Open the collapsible section
      fireEvent.click(screen.getByText("Take an I/Q Capture"));

      fireEvent.click(screen.getByLabelText("Area A"));

      await act(async () => {
        fireEvent.click(screen.getByText("Capture"));
      });

      expect(alertSpy).toHaveBeenCalledWith("Sample rate exceeds maximum of 3.2MHz");
      expect(mockSendCaptureCommand).not.toHaveBeenCalled();
    });

    it("should validate sample rate in file metadata", async () => {
      mockWebSocketState.captureStatus = {
        status: "done",
        jobId: "test-job-1",
        downloadUrl: "/api/download?id=test-job-1",
        filename: "test-capture.napt",
      };

      render(
        <TestWrapper>
          <IQCaptureIntegrationTest />
        </TestWrapper>
      );

      // Open the collapsible section
      fireEvent.click(screen.getByText("Take an I/Q Capture"));

      await waitFor(() => {
        expect(screen.getByText("test-capture.napt")).toBeInTheDocument();
      });

      expect(screen.getByTestId("capture-metadata")).toHaveTextContent("Sample Rate: 3.2MHz");
    });
  });

  describe("End-to-End Capture Workflow", () => {
    it("sends whole_sample for onscreen exact-width capture", async () => {
      render(
        <TestWrapper>
          <IQCaptureIntegrationTest />
        </TestWrapper>
      );

      // Open the collapsible section
      fireEvent.click(screen.getByText("Take an I/Q Capture"));

      fireEvent.click(screen.getByLabelText("Onscreen"));

      await act(async () => {
        fireEvent.click(screen.getByText("Capture"));
      });

      expect(mockSendCaptureCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          acquisitionMode: "whole_sample",
        })
      );
    });

    it("should send capture workflow parameters with valid sample rate", async () => {
      const { container } = render(
        <TestWrapper>
          <IQCaptureIntegrationTest />
        </TestWrapper>
      );

      // Open the collapsible section
      fireEvent.click(screen.getByText("Take an I/Q Capture"));

      fireEvent.click(screen.getByLabelText("Area A"));
      fireEvent.change(container.querySelector('input[type="number"]') as HTMLInputElement, {
        target: { value: "10" },
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Capture"));
      });

      expect(mockSendCaptureCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          durationS: 10,
          fileType: ".napt",
          acquisitionMode: "stepwise",
          encrypted: false,
        })
      );
    });

    it("should handle capture progress updates", async () => {
      const view = render(
        <TestWrapper>
          <IQCaptureIntegrationTest />
        </TestWrapper>
      );

      // Open the collapsible section
      fireEvent.click(screen.getByText("Take an I/Q Capture"));

      mockWebSocketState.captureStatus = { status: "progress", jobId: "test-job-1", progress: 25 };
      view.rerender(
        <TestWrapper>
          <IQCaptureIntegrationTest />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("In progress...")).toBeInTheDocument();
      });

      mockWebSocketState.captureStatus = {
        status: "done",
        jobId: "test-job-1",
        downloadUrl: "/api/download?id=test-job-1",
        filename: "test-capture.napt",
      };
      view.rerender(
        <TestWrapper>
          <IQCaptureIntegrationTest />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Complete")).toBeInTheDocument();
        expect(screen.getByText("test-capture.napt")).toBeInTheDocument();
      });
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle device disconnection during capture", async () => {
      const view = render(
        <TestWrapper>
          <IQCaptureIntegrationTest />
        </TestWrapper>
      );

      // Open the collapsible section
      fireEvent.click(screen.getByText("Take an I/Q Capture"));

      mockWebSocketState.isConnected = false;
      mockWebSocketState.deviceState = "disconnected";
      mockWebSocketState.captureStatus = {
        status: "failed",
        jobId: "test-job-1",
        error: "Device disconnected",
      };

      view.rerender(
        <TestWrapper>
          <IQCaptureIntegrationTest />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Failed: Device disconnected")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Capture" })).toBeDisabled();
      });
    });

    it("should validate capture parameters before starting", async () => {
      render(
        <TestWrapper>
          <IQCaptureIntegrationTest />
        </TestWrapper>
      );

      // Open the collapsible section
      fireEvent.click(screen.getByText("Take an I/Q Capture"));

      expect(screen.getByRole("button", { name: "Capture" })).toBeDisabled();

      fireEvent.click(screen.getByLabelText("Area A"));

      await act(async () => {
        fireEvent.click(screen.getByText("Capture"));
      });

      expect(mockSendCaptureCommand).toHaveBeenCalled();
    });

    it("should handle invalid duration values", async () => {
      const { container } = render(
        <TestWrapper>
          <IQCaptureIntegrationTest />
        </TestWrapper>
      );

      // Open the collapsible section
      fireEvent.click(screen.getByText("Take an I/Q Capture"));

      fireEvent.click(screen.getByLabelText("Area A"));
      const durationInput = container.querySelector('input[type="number"]') as HTMLInputElement;

      fireEvent.change(durationInput, { target: { value: "0" } });
      expect(screen.getByDisplayValue("1")).toBeInTheDocument();

      fireEvent.change(durationInput, { target: { value: "-5" } });
      await act(async () => {
        fireEvent.click(screen.getByText("Capture"));
      });
      expect(alertSpy).toHaveBeenCalledWith("Please enter a valid duration");

      fireEvent.change(durationInput, { target: { value: "10" } });
      expect(screen.getByText("Capture")).not.toBeDisabled();
    });
  });

  describe("File Format and Download", () => {
    it("should handle different file formats with sample rate validation", async () => {
      render(
        <TestWrapper>
          <IQCaptureIntegrationTest />
        </TestWrapper>
      );

      // Open the collapsible section
      fireEvent.click(screen.getByText("Take an I/Q Capture"));

      fireEvent.change(screen.getByDisplayValue(".napt"), { target: { value: ".wav" } });
      expect(screen.getByLabelText("Hardware sample rate")).toHaveTextContent("3.2MHz");

      fireEvent.click(screen.getByLabelText("Area A"));

      await act(async () => {
        fireEvent.click(screen.getByText("Capture"));
      });

      expect(mockSendCaptureCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          fileType: ".wav",
        })
      );
    });

    it("should validate downloaded file metadata", async () => {
      mockWebSocketState.captureStatus = {
        status: "done",
        jobId: "test-job-1",
        downloadUrl: "/api/download?id=test-job-1",
        filename: "test-capture.napt",
      };

      render(
        <TestWrapper>
          <IQCaptureIntegrationTest />
        </TestWrapper>
      );

      // Open the collapsible section
      fireEvent.click(screen.getByText("Take an I/Q Capture"));

      await waitFor(() => {
        const downloadLink = screen.getByText("test-capture.napt");
        expect(downloadLink).toBeInTheDocument();
        expect(downloadLink).toHaveAttribute("href", expect.stringContaining("token=mock-token"));
      });

      expect(screen.getByTestId("capture-metadata")).toHaveTextContent("Duration: 5s");
      expect(screen.getByTestId("capture-metadata")).toHaveTextContent("Sample Rate: 3.2MHz");
    });
  });

  describe("Mock vs Real Device Testing", () => {
    it("should handle mock device sample rate limits", async () => {
      mockWebSocketState.dataRef = { current: { deviceInfo: "Mock APT Device" } };

      render(
        <TestWrapper>
          <IQCaptureIntegrationTest />
        </TestWrapper>
      );

      // Open the collapsible section
      fireEvent.click(screen.getByText("Take an I/Q Capture"));

      expect(screen.getByText("Mock APT Device")).toBeInTheDocument();
      expect(screen.getByLabelText("Hardware sample rate")).toHaveTextContent("3.2MHz");

      fireEvent.click(screen.getByLabelText("Area A"));

      await act(async () => {
        fireEvent.click(screen.getByText("Capture"));
      });

      expect(mockSendCaptureCommand).toHaveBeenCalled();
    });

    it("should handle real device sample rate detection", () => {
      mockWebSocketState.dataRef = { current: { deviceInfo: "RTL-SDR Blog V4" } };

      render(
        <TestWrapper>
          <IQCaptureIntegrationTest />
        </TestWrapper>
      );

      expect(screen.getByText("RTL-SDR Blog V4")).toBeInTheDocument();
      expect(screen.getByTestId("supported-sample-rates")).toHaveTextContent(
        "3.2MHz, 2.8MHz, 2.4MHz, 2.048MHz"
      );
    });
  });
});
