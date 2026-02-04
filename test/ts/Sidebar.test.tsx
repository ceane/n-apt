import * as React from "react"
import { render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import Sidebar from "@n-apt/components/Sidebar"

describe("Sidebar Component", () => {
  const defaultProps = {
    isConnected: false,
    isDeviceConnected: false,
    isPaused: false,
    activeTab: "visualizer",
    onTabChange: jest.fn(),
    activeSignalArea: "test-area",
    onSignalAreaChange: jest.fn(),
    onFrequencyRangeChange: jest.fn(),
    onPauseToggle: jest.fn(),
    selectedFiles: [],
    onSelectedFilesChange: jest.fn(),
    onStitch: jest.fn(),
    onClear: jest.fn(),
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

  it("should display source information", () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.getAllByText("RTL-SDR v4")).toHaveLength(2)
    expect(screen.getByText("Unavailable")).toBeInTheDocument()
  })
})
