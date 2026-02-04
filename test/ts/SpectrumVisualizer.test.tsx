import * as React from "react"
import { render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import FFTCanvas from "@n-apt/components/FFTCanvas"
import { FrequencyRange } from "@n-apt/fft/FFTCanvasRenderer"

// Mock the canvas renderers
jest.mock("@n-apt/fft/FFTCanvasRenderer", () => ({
  drawSpectrum: jest.fn(),
  zoomFFT: jest.fn(),
  FrequencyRange: {} as any,
}))

jest.mock("@n-apt/waterfall/FIFOWaterfallRenderer", () => ({
  drawWaterfall: jest.fn(),
  createWaterfallLine: jest.fn(() => new ImageData(800, 1)),
  addWaterfallFrame: jest.fn(),
  spectrumToAmplitude: jest.fn((spectrum: number[]) => spectrum.map(() => 0)),
}))

describe("FFTCanvas", () => {
  const mockFrequencyRange: FrequencyRange = {
    min: 0,
    max: 3.2,
  }

  const mockProps = {
    data: {
      waveform: Array.from(
        { length: 1024 },
        (_, i) => -60 + Math.sin(i * 0.1) * 20,
      ),
    },
    frequencyRange: mockFrequencyRange,
    activeSignalArea: "test-area",
    isPaused: false,
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("should render without crashing", () => {
    render(<FFTCanvas {...mockProps} />)
  })

  it("should display spectrum analyzer section", () => {
    render(<FFTCanvas {...mockProps} />)

    expect(screen.getByText("FFT Signal Display")).toBeInTheDocument()
  })

  it("should display waterfall section", () => {
    render(<FFTCanvas {...mockProps} />)

    expect(screen.getByText("Waterfall Display")).toBeInTheDocument()
  })

  it("should show paused status when isPaused is true", () => {
    const pausedProps = { ...mockProps, isPaused: true }

    render(<FFTCanvas {...pausedProps} />)

    expect(
      screen.getByText((content, element) => {
        return (
          content.includes("FFT Signal Display") && content.includes("(Paused)")
        )
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText((content, element) => {
        return (
          content.includes("Waterfall Display") && content.includes("(Paused)")
        )
      }),
    ).toBeInTheDocument()
  })

  it("should not show paused status when isPaused is false", () => {
    render(<FFTCanvas {...mockProps} />)

    expect(screen.queryByText(/\(Paused\)/)).not.toBeInTheDocument()
  })

  it("should handle null data gracefully", () => {
    const nullDataProps = {
      ...mockProps,
      data: null,
    }

    expect(() => render(<FFTCanvas {...nullDataProps} />)).not.toThrow()
  })

  it("should handle data without waveform gracefully", () => {
    const noWaveformProps = {
      ...mockProps,
      data: {},
    }

    expect(() => render(<FFTCanvas {...noWaveformProps} />)).not.toThrow()
  })
})
