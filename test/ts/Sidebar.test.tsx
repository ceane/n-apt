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
    expect(screen.getByText("Live N-APT visualizer")).toBeInTheDocument()
  })

  it("should display navigation tabs", () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByText("N-APT stitcher & I/Q replay")).toBeInTheDocument()
    expect(screen.getByText("N-APT live deep analysis")).toBeInTheDocument()
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
    expect(screen.getByText("Mock")).toBeInTheDocument()
    expect(screen.getByText("Unavailable")).toBeInTheDocument()
  })
})
