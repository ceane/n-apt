import * as React from "react"
import { render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import Sidebar from "@n-apt/components/Sidebar"

describe("Sidebar Component", () => {
  const defaultProps = {
    isConnected: false,
    isAuthenticated: true,
    authState: "success",
    deviceState: "disconnected",
    deviceLoadingReason: null,
    isPaused: false,
    serverPaused: false,
    backend: "mock",
    deviceInfo: null,
    activeTab: "visualizer",
    onTabChange: jest.fn(),
    sourceMode: "live" as const,
    onSourceModeChange: jest.fn(),
    stitchStatus: "",
    activeSignalArea: "test-area",
    onSignalAreaChange: jest.fn(),
    onFrequencyRangeChange: jest.fn(),
    onPauseToggle: jest.fn(),
    stitchSourceSettings: { gain: 0, ppm: 0 },
    onStitchSourceSettingsChange: jest.fn(),
    isStitchPaused: false,
    onStitchPauseToggle: jest.fn(),
    selectedFiles: [],
    onSelectedFilesChange: jest.fn(),
    onStitch: jest.fn(),
    onClear: jest.fn(),
    onRestartDevice: jest.fn(),
  }

  it("should render without crashing", () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByText("N-APT visualizer")).toBeInTheDocument()
  })

  it("should display navigation tabs", () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByText("N-APT visualizer")).toBeInTheDocument()
    expect(screen.getByText("Decode N-APT with ML")).toBeInTheDocument()
  })

  it("should display connection status", () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByText("Disconnected")).toBeInTheDocument()
  })

  it("should show restarting UI when loading due to restart", () => {
    render(
      <Sidebar
        {...defaultProps}
        isConnected={true}
        deviceState={"loading"}
        deviceLoadingReason={"restart"}
      />,
    )
    expect(screen.getByText("Restarting device...")).toBeInTheDocument()
    expect(screen.getByText("Restarting...")).toBeInTheDocument()
  })

  it("should display source information", () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByText("Mock SDR")).toBeInTheDocument()
    expect(screen.getByText("Unavailable")).toBeInTheDocument()
  })
})
