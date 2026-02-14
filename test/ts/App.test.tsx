import * as React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import "@testing-library/jest-dom"
import { MemoryRouter } from "react-router-dom"
import { AppContent } from "@n-apt/App"

// Mock all components to avoid import issues
jest.mock("@n-apt/components", () => ({
  FFTCanvas: () => (
    <div data-testid="spectrum-visualizer">Spectrum Visualizer</div>
  ),
  DrawMockNAPT: () => <div data-testid="draw-mock-napt">Draw Mock NAPT</div>,
}))

jest.mock("@n-apt/components/Sidebar", () => ({
  default: () => <div data-testid="sidebar">Sidebar</div>,
}))

jest.mock("@n-apt/components/HumanModelViewer", () => ({
  default: () => <div data-testid="human-model-viewer">Human Model Viewer</div>,
}))

jest.mock("@n-apt/components/HotspotEditor", () => ({
  default: () => <div data-testid="hotspot-editor">Hotspot Editor</div>,
}))

jest.mock("@n-apt/components/FFTStitcherCanvas", () => ({
  default: () => (
    <div data-testid="stitcher-visualizer">Stitcher Visualizer</div>
  ),
}))

jest.mock("@n-apt/hooks/useWebSocket", () => ({
  useWebSocket: () => ({
    isConnected: false,
    deviceState: "disconnected",
    deviceLoadingReason: null,
    isPaused: false,
    serverPaused: false,
    backend: "mock",
    deviceInfo: null,
    data: null,
    error: null,
    sendFrequencyRange: jest.fn(),
    sendPauseCommand: jest.fn(),
    sendSettings: jest.fn(),
    sendRestartDevice: jest.fn(),
  }),
}))

const renderApp = () => {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AppContent />
    </MemoryRouter>,
  )
}

describe.skip("App Component", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("should render without crashing", () => {
    renderApp()
    expect(screen.getByTestId("sidebar")).toBeInTheDocument()
  })

  it("should show Spectrum tab by default", () => {
    renderApp()
    expect(screen.getByTestId("spectrum-visualizer")).toBeInTheDocument()
  })
})
