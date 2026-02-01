import { useRef, useEffect, useCallback } from 'react'
import styled from 'styled-components'
import { drawSpectrum, FrequencyRange } from '@n-apt/fft/FFTCanvasRenderer'
import { drawWaterfall, createWaterfallLine } from '@n-apt/waterfall/WaterfallCanvasRenderer'
import { 
  VISUALIZER_PADDING, 
  VISUALIZER_GAP, 
  WATERFALL_HISTORY_LIMIT, 
  WATERFALL_HISTORY_MAX,
  SECTION_TITLE_COLOR,
  SECTION_TITLE_AFTER_COLOR,
  CANVAS_BORDER_COLOR
} from '@n-apt/consts'

const VisualizerContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: #0a0a0a;
  position: relative;
  overflow: hidden;
  padding: ${VISUALIZER_PADDING}px;
  gap: ${VISUALIZER_GAP}px;
`

const SpectrumSection = styled.div`
  flex: 2;
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 0;
`

const WaterfallSection = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 0;
`

const SectionTitle = styled.div`
  font-size: 11px;
  color: ${SECTION_TITLE_COLOR};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;

  &::after {
    content: '/';
    color: ${SECTION_TITLE_AFTER_COLOR};
  }
`

const CanvasWrapper = styled.div`
  flex: 1;
  position: relative;
  background-color: #0a0a0a;
  border: 1px solid ${CANVAS_BORDER_COLOR};
  border-radius: 4px;
  overflow: hidden;
`

const Canvas = styled.canvas`
  width: 100%;
  height: 100%;
  display: block;
`

/**
 * Props for FFTCanvas component
 */
interface FFTCanvasProps {
  /** FFT data containing waveform and metadata */
  data: any
  /** Frequency range to display */
  frequencyRange: FrequencyRange
  /** Currently active signal area identifier */
  activeSignalArea: string
  /** Whether the visualization is paused */
  isPaused: boolean
}

/**
 * FFT canvas component with FFT spectrum and waterfall displays
 * Uses SDR++ style rendering for professional spectrum analysis
 */
const FFTCanvas: React.FC<FFTCanvasProps> = ({
  data,
  frequencyRange,
  activeSignalArea,
  isPaused
}) => {
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null)
  const waterfallCanvasRef = useRef<HTMLCanvasElement>(null)
  const waterfallHistoryRef = useRef<ImageData[]>([])
  const animationFrameRef = useRef<number>()

  /**
 * Renders spectrum data using FFTCanvasRenderer
 * @param canvas - Canvas element to render on
 * @param spectrumData - Power spectrum data in dB
 */
const renderSpectrum = useCallback((canvas: HTMLCanvasElement, spectrumData: number[]) => {
    const ctx = canvas.getContext('2d')
    if (!ctx || !spectrumData) return

    drawSpectrum({
      ctx,
      width: canvas.width,
      height: canvas.height,
      waveform: spectrumData,
      frequencyRange
    })
  }, [frequencyRange])

  /**
 * Renders waterfall data using WaterfallCanvasRenderer
 * @param canvas - Canvas element to render on
 * @param spectrumData - Power spectrum data in dB
 */
const renderWaterfall = useCallback((canvas: HTMLCanvasElement, spectrumData: number[]) => {
    const ctx = canvas.getContext('2d')
    if (!ctx || !spectrumData) return

    const width = canvas.width
    const height = canvas.height

    // Create waterfall line using the new renderer
    const waterfallLine = createWaterfallLine(spectrumData, width, WATERFALL_HISTORY_LIMIT, WATERFALL_HISTORY_MAX)

    // Add to history
    waterfallHistoryRef.current.push(waterfallLine)
    if (waterfallHistoryRef.current.length > height) {
      waterfallHistoryRef.current.shift()
    }

    // Draw waterfall using the new renderer
    drawWaterfall({
      ctx,
      width,
      height,
      waterfallData: waterfallHistoryRef.current,
      frequencyRange
    })
  }, [frequencyRange])

  /**
 * Animation loop for continuous spectrum and waterfall updates
 */
const animate = useCallback(() => {
    if (isPaused) return

    const spectrumCanvas = spectrumCanvasRef.current
    const waterfallCanvas = waterfallCanvasRef.current

    if (spectrumCanvas && waterfallCanvas && data?.waveform) {
      renderSpectrum(spectrumCanvas, data.waveform)
      renderWaterfall(waterfallCanvas, data.waveform)
    }

    animationFrameRef.current = requestAnimationFrame(animate)
  }, [data, renderSpectrum, renderWaterfall, isPaused])

  useEffect(() => {
    const spectrumCanvas = spectrumCanvasRef.current
    const waterfallCanvas = waterfallCanvasRef.current

    if (spectrumCanvas && waterfallCanvas) {
      // Set canvas size
      const resizeCanvas = () => {
        const spectrumRect = spectrumCanvas.parentElement?.getBoundingClientRect()
        const waterfallRect = waterfallCanvas.parentElement?.getBoundingClientRect()

        if (spectrumRect) {
          spectrumCanvas.width = spectrumRect.width
          spectrumCanvas.height = spectrumRect.height
        }

        if (waterfallRect) {
          waterfallCanvas.width = waterfallRect.width
          waterfallCanvas.height = waterfallRect.height
        }
      }

      resizeCanvas()
      window.addEventListener('resize', resizeCanvas)

      // Start animation
      animate()

      return () => {
        window.removeEventListener('resize', resizeCanvas)
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current)
        }
      }
    }
  }, [animate])

  return (
    <VisualizerContainer>
      <SpectrumSection>
        <SectionTitle>
          Spectrum Analyzer {isPaused && '(Paused)'}
        </SectionTitle>
        <CanvasWrapper>
          <Canvas ref={spectrumCanvasRef} />
        </CanvasWrapper>
      </SpectrumSection>
      <WaterfallSection>
        <SectionTitle>
          Waterfall Display {isPaused && '(Paused)'}
        </SectionTitle>
        <CanvasWrapper>
          <Canvas ref={waterfallCanvasRef} />
        </CanvasWrapper>
      </WaterfallSection>
    </VisualizerContainer>
  )
}

export default FFTCanvas
