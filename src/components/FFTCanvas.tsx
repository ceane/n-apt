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
  const dataRef = useRef<any>(null)

  /**
 * Renders spectrum data using FFTCanvasRenderer
 * @param canvas - Canvas element to render on
 * @param spectrumData - Power spectrum data in dB
 */
const renderSpectrum = useCallback((canvas: HTMLCanvasElement, spectrumData: number[]) => {
    const ctx = canvas.getContext('2d')
    if (!ctx || !spectrumData) return

    // Use CSS dimensions (not scaled canvas dimensions) since ctx is already scaled
    const rect = canvas.parentElement?.getBoundingClientRect()
    const width = rect?.width || canvas.width
    const height = rect?.height || canvas.height

    drawSpectrum({
      ctx,
      width,
      height,
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

    const dpr = window.devicePixelRatio || 1
    const marginX = Math.round(40 * dpr)
    const marginY = Math.round(20 * dpr)
    const lineWidth = Math.max(1, Math.round(canvas.width - marginX * 2))

    const resampled: number[] = new Array(lineWidth)
    const srcLen = spectrumData.length
    for (let x = 0; x < lineWidth; x++) {
      const start = Math.floor((x * srcLen) / lineWidth)
      const end = Math.max(start + 1, Math.floor(((x + 1) * srcLen) / lineWidth))
      let maxVal = -Infinity
      for (let i = start; i < end && i < srcLen; i++) {
        const v = spectrumData[i]
        if (v > maxVal) maxVal = v
      }
      resampled[x] = maxVal === -Infinity ? spectrumData[Math.min(start, srcLen - 1)] : maxVal
    }

    const waterfallLine = createWaterfallLine(resampled, lineWidth, WATERFALL_HISTORY_LIMIT, WATERFALL_HISTORY_MAX)

    // Add to history
    waterfallHistoryRef.current.push(waterfallLine)
    const maxLines = Math.max(1, Math.round(canvas.height - marginY * 2))
    if (waterfallHistoryRef.current.length > maxLines) {
      waterfallHistoryRef.current.shift()
    }

    drawWaterfall({
      ctx,
      width: canvas.width,
      height: canvas.height,
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

    const currentData = dataRef.current
    if (spectrumCanvas && waterfallCanvas && currentData?.waveform) {
      renderSpectrum(spectrumCanvas, currentData.waveform)
      renderWaterfall(waterfallCanvas, currentData.waveform)
    }

    animationFrameRef.current = requestAnimationFrame(animate)
  }, [renderSpectrum, renderWaterfall, isPaused])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  useEffect(() => {
    const spectrumCanvas = spectrumCanvasRef.current
    const waterfallCanvas = waterfallCanvasRef.current

    if (spectrumCanvas && waterfallCanvas) {
      // Set canvas size with high DPI support
      const resizeCanvas = () => {
        const dpr = window.devicePixelRatio || 1
        const spectrumRect = spectrumCanvas.parentElement?.getBoundingClientRect()
        const waterfallRect = waterfallCanvas.parentElement?.getBoundingClientRect()

        if (spectrumRect) {
          // Set actual canvas size in memory (scaled for high DPI)
          spectrumCanvas.width = spectrumRect.width * dpr
          spectrumCanvas.height = spectrumRect.height * dpr
          // Set display size via CSS
          spectrumCanvas.style.width = `${spectrumRect.width}px`
          spectrumCanvas.style.height = `${spectrumRect.height}px`
          // Scale context to match DPI
          const ctx = spectrumCanvas.getContext('2d')
          if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          }
        }

        if (waterfallRect) {
          // Set actual canvas size in memory (scaled for high DPI)
          waterfallCanvas.width = waterfallRect.width * dpr
          waterfallCanvas.height = waterfallRect.height * dpr
          // Set display size via CSS
          waterfallCanvas.style.width = `${waterfallRect.width}px`
          waterfallCanvas.style.height = `${waterfallRect.height}px`
          // Do not scale for waterfall: putImageData ignores transforms
          const ctx = waterfallCanvas.getContext('2d')
          if (ctx) {
            ctx.setTransform(1, 0, 0, 1, 0, 0)
          }

          waterfallHistoryRef.current = []
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
          FFT Signal Display {isPaused && '(Paused)'}
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
