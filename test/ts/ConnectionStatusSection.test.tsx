import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ConnectionStatusSection } from "../../src/ts/components/sidebar/ConnectionStatusSection";
import { TestWrapper } from "./testUtils";

describe("ConnectionStatusSection file mode", () => {
  const baseProps = {
    isConnected: true,
    deviceState: "connected" as const,
    deviceLoadingReason: null,
    isPaused: false,
    cryptoCorrupted: false,
    onPauseToggle: jest.fn(),
  };

  it("shows the choose file state and choose file action", () => {
    const onFileProcess = jest.fn();

    render(
      <TestWrapper>
        <ConnectionStatusSection
          {...baseProps}
          fileMode
          fileProcessingStatus=""
          onFileProcess={onFileProcess}
        />
      </TestWrapper>,
    );

    expect(
      screen.getByRole("button", { name: /choose file/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /choose file/i }));
    expect(onFileProcess).toHaveBeenCalled();
  });

  it("shows a stale placeholder instead of the pause button", () => {
    render(
      <TestWrapper>
        <ConnectionStatusSection
          {...baseProps}
          deviceState="stale"
          onPauseToggle={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getByRole("button", { name: /stale/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /pause/i })).not.toBeInTheDocument();
  });

  it("shows the file not processed state once a file is selected", () => {
    render(
      <TestWrapper>
        <ConnectionStatusSection
          {...baseProps}
          fileMode
          hasFileSelected
          fileProcessingStatus=""
          onFileProcess={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getByText("File not processed")).toBeInTheDocument();
  });

  it("shows processing, processed, error, and decryption error states", () => {
    const { rerender } = render(
      <TestWrapper>
        <ConnectionStatusSection
          {...baseProps}
          fileMode
          hasFileSelected
          fileProcessingStatus="Loading 1 files..."
          onFileProcess={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getByText("File processing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /processing/i })).toBeDisabled();

    rerender(
      <TestWrapper>
        <ConnectionStatusSection
          {...baseProps}
          fileMode
          hasFileSelected
          fileProcessingStatus="Processed Successfully"
          fileIsPaused={true}
          onFileProcess={jest.fn()}
          onFilePauseToggle={jest.fn()}
        />
      </TestWrapper>,
    );
    expect(screen.getByText("File processed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument();

    rerender(
      <TestWrapper>
        <ConnectionStatusSection
          {...baseProps}
          fileMode
          hasFileSelected
          fileProcessingStatus="File processing failed"
          onFileProcess={jest.fn()}
          onFileClearError={jest.fn()}
        />
      </TestWrapper>,
    );
    expect(screen.getByText("File processing error")).toBeInTheDocument();

    rerender(
      <TestWrapper>
        <ConnectionStatusSection
          {...baseProps}
          fileMode
          hasFileSelected
          fileProcessingStatus="File decryption failed, wrong key"
          onFileProcess={jest.fn()}
          onFileClearError={jest.fn()}
        />
      </TestWrapper>,
    );
    expect(screen.getByText("Decryption error")).toBeInTheDocument();
  });

  it('shows "Connected to server but not device" for mock fallback', () => {
    render(
      <TestWrapper>
        <ConnectionStatusSection {...baseProps} backend="mock_apt" />
      </TestWrapper>,
    );

    expect(
      screen.getByText("Connected to server but not device"),
    ).toBeInTheDocument();
  });
});
