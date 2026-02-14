import * as React from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom"
import FrequencyRangeSlider from "@n-apt/components/FrequencyRangeSlider"

describe("FrequencyRangeSlider Enhanced Tests", () => {
  const defaultProps = {
    min: 0,
    max: 3.2,
    value: { min: 1.0, max: 2.0 },
    onChange: jest.fn(),
    disabled: false,
    showLabels: true,
    showMarkers: true,
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("should handle extreme frequency ranges", () => {
    render(<FrequencyRangeSlider {...defaultProps} min={0} max={10000} />)
    
    expect(screen.getByText("0 MHz")).toBeInTheDocument()
    expect(screen.getByText("10000 MHz")).toBeInTheDocument()
  })

  it("should handle very small frequency ranges", () => {
    render(<FrequencyRangeSlider {...defaultProps} min={1.6} max={1.7} />)
    
    expect(screen.getByText("1.6 MHz")).toBeInTheDocument()
    expect(screen.getByText("1.7 MHz")).toBeInTheDocument()
  })

  it("should handle rapid value changes", () => {
    const { rerender } = render(<FrequencyRangeSlider {...defaultProps} />)
    
    // Rapid value changes
    const values = [
      { min: 0.5, max: 1.5 },
      { min: 1.0, max: 2.0 },
      { min: 1.5, max: 2.5 },
      { min: 2.0, max: 3.0 },
    ]
    
    values.forEach((value, index) => {
      rerender(<FrequencyRangeSlider {...defaultProps} value={value} />)
      expect(defaultProps.onChange).toHaveBeenCalledWith(value)
    })
  })

  it("should handle disabled state correctly", () => {
    render(<FrequencyRangeSlider {...defaultProps} disabled={true} />)
    
    const slider = screen.getByRole("slider")
    expect(slider).toBeDisabled()
  })

  it("should handle marker positioning", () => {
    const markers = [
      { freq: 1.0, label: "Test1" },
      { freq: 2.0, label: "Test2" },
    ]
    
    render(<FrequencyRangeSlider {...defaultProps} markers={markers} />)
    
    markers.forEach(marker => {
      expect(screen.getByText(marker.label)).toBeInTheDocument()
    })
  })

  it("should handle RTL marker display", () => {
    const rtlMarkers = [
      { freq: 1.0, label: "RTL-SDR: 1090" },
      { freq: 2.0, label: "RTL-SDR: 1091" },
    ]
    
    render(<FrequencyRangeSlider {...defaultProps} markers={rtlMarkers} />)
    
    rtlMarkers.forEach(marker => {
      expect(screen.getByText(marker.label)).toBeInTheDocument()
    })
  })

  it("should handle window dragging", () => {
    render(<FrequencyRangeSlider {...defaultProps} />)
    
    const window = screen.getByTestId("visible-window")
    
    // Simulate mouse events
    fireEvent.mouseDown(window, { clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 200 })
    fireEvent.mouseUp(window, { clientX: 200 })
    
    expect(defaultProps.onChange).toHaveBeenCalled()
  })

  it("should handle edge cases for window positioning", () => {
    // Test window at minimum
    render(<FrequencyRangeSlider {...defaultProps} value={{ min: 0, max: 0.1 }} />)
    
    // Test window at maximum
    render(<FrequencyRangeSlider {...defaultProps} value={{ min: 3.1, max: 3.2 }} />)
    
    // Test window at exact center
    render(<FrequencyRangeSlider {...defaultProps} value={{ min: 1.55, max: 1.65 }} />)
  })

  it("should handle window resizing", () => {
    render(<FrequencyRangeSlider {...defaultProps} />)
    
    const window = screen.getByTestId("visible-window")
    
    // Simulate resize from left edge
    fireEvent.mouseDown(window, { clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 50 })
    fireEvent.mouseUp(window, { clientX: 50 })
    
    // Simulate resize from right edge
    fireEvent.mouseDown(window, { clientX: 200 })
    fireEvent.mouseMove(window, { clientX: 250 })
    fireEvent.mouseUp(window, { clientX: 250 })
  })

  it("should handle keyboard navigation", () => {
    render(<FrequencyRangeSlider {...defaultProps} />)
    
    const slider = screen.getByRole("slider")
    
    // Test arrow keys
    fireEvent.keyDown(slider, { key: "ArrowLeft" })
    fireEvent.keyDown(slider, { key: "ArrowRight" })
    fireEvent.keyDown(slider, { key: "ArrowUp" })
    fireEvent.keyDown(slider, { key: "ArrowDown" })
    
    // Test home/end keys
    fireEvent.keyDown(slider, { key: "Home" })
    fireEvent.keyDown(slider, { key: "End" })
  })

  it("should handle touch events", () => {
    render(<FrequencyRangeSlider {...defaultProps} />)
    
    const window = screen.getByTestId("visible-window")
    
    // Simulate touch events
    fireEvent.touchStart(window, { touches: [{ clientX: 100 }] })
    fireEvent.touchMove(window, { touches: [{ clientX: 200 }] })
    fireEvent.touchEnd(window)
    
    expect(defaultProps.onChange).toHaveBeenCalled()
  })

  it("should handle window constraints", () => {
    // Test minimum window size
    render(<FrequencyRangeSlider {...defaultProps} value={{ min: 1.59, max: 1.61 }} />)
    
    // Test maximum window size
    render(<FrequencyRangeSlider {...defaultProps} value={{ min: 0, max: 3.2 }} />)
    
    // Test window that exceeds bounds
    render(<FrequencyRangeSlider {...defaultProps} value={{ min: -0.1, max: 3.3 }} />)
  })

  it("should handle decimal precision", () => {
    render(<FrequencyRangeSlider {...defaultProps} />)
    
    // Test high precision values
    const preciseValue = { min: 1.234567, max: 2.345678 }
    render(<FrequencyRangeSlider {...defaultProps} value={preciseValue} />)
    
    expect(defaultProps.onChange).toHaveBeenCalledWith(preciseValue)
  })

  it("should handle rapid window movement", () => {
    render(<FrequencyRangeSlider {...defaultProps} />)
    
    const window = screen.getByTestId("visible-window")
    
    // Simulate rapid mouse movement
    fireEvent.mouseDown(window, { clientX: 100 })
    
    for (let i = 0; i < 100; i++) {
      fireEvent.mouseMove(window, { clientX: 100 + i })
    }
    
    fireEvent.mouseUp(window, { clientX: 200 })
    
    expect(defaultProps.onChange).toHaveBeenCalled()
  })

  it("should handle window snapping", () => {
    // Test if window snaps to markers
    const markers = [{ freq: 1.5, label: "Center" }]
    
    render(<FrequencyRangeSlider {...defaultProps} markers={markers} />)
    
    const window = screen.getByTestId("visible-window")
    
    // Drag near marker
    fireEvent.mouseDown(window, { clientX: 148 }) // Near 1.5 MHz
    fireEvent.mouseMove(window, { clientX: 150 }) // Exactly at marker
    fireEvent.mouseUp(window, { clientX: 150 })
    
    expect(defaultProps.onChange).toHaveBeenCalled()
  })

  it("should handle accessibility features", () => {
    render(<FrequencyRangeSlider {...defaultProps} />)
    
    const slider = screen.getByRole("slider")
    
    // Test ARIA attributes
    expect(slider).toHaveAttribute("aria-label")
    expect(slider).toHaveAttribute("aria-valuemin")
    expect(slider).toHaveAttribute("aria-valuemax")
    expect(slider).toHaveAttribute("aria-valuenow")
  })

  it("should handle responsive behavior", () => {
    // Test with different container sizes
    const { rerender } = render(<FrequencyRangeSlider {...defaultProps} />)
    
    // Simulate container resize
    rerender(<FrequencyRangeSlider {...defaultProps} />)
    
    expect(screen.getByRole("slider")).toBeInTheDocument()
  })

  it("should handle performance with many markers", () => {
    const manyMarkers = Array.from({ length: 100 }, (_, i) => ({
      freq: i * 0.032,
      label: `Marker${i}`
    }))
    
    render(<FrequencyRangeSlider {...defaultProps} markers={manyMarkers} />)
    
    // Should render without performance issues
    expect(screen.getByRole("slider")).toBeInTheDocument()
  })

  it("should handle error states gracefully", () => {
    // Test with invalid props
    render(<FrequencyRangeSlider {...defaultProps} min={NaN} max={Infinity} />)
    
    // Should not crash
    expect(screen.getByRole("slider")).toBeInTheDocument()
  })

  it("should handle animation frames", () => {
    render(<FrequencyRangeSlider {...defaultProps} />)
    
    const window = screen.getByTestId("visible-window")
    
    // Test animation frame updates
    requestAnimationFrame(() => {
      fireEvent.mouseDown(window, { clientX: 100 })
      fireEvent.mouseMove(window, { clientX: 200 })
      fireEvent.mouseUp(window, { clientX: 200 })
    })
    
    expect(defaultProps.onChange).toHaveBeenCalled()
  })
})
