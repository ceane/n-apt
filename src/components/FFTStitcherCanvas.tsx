import React, { useEffect, useState, useRef, useCallback } from "react"
import FFTCanvas from "@n-apt/components/FFTCanvas"
import styled from "styled-components"
import { fileWorkerManager } from "@n-apt/workers/fileWorkerManager"

interface FFTStitcherCanvasProps {
  selectedFiles: { name: string; file: File }[]
  stitchTrigger: number | null
  stitchSourceSettings: { gain: number; ppm: number }
  isPaused: boolean
  onStitchStatus?: (status: string) => void
}

const StitcherContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: #0a0a0a;
  position: relative;
`

const VisualizationContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
`

const FFTStitcherCanvas: React.FC<FFTStitcherCanvasProps> = ({
  selectedFiles,
  stitchTrigger,
  stitchSourceSettings,
  isPaused,
  onStitchStatus,
}) => {
  // ── Stable refs for data that changes rapidly (no re-render cascades) ──
  const fileDataCache = useRef<Map<string, number[]>>(new Map())
  const freqMapRef = useRef<Map<string, number>>(new Map())
  const lastTriggerRef = useRef<number | null>(null)
  const playbackFrameRef = useRef(0)
  const selectedFilesRef = useRef(selectedFiles)
  selectedFilesRef.current = selectedFiles
  const isPausedRef = useRef(isPaused)
  isPausedRef.current = isPaused
  const stitchSourceSettingsRef = useRef(stitchSourceSettings)
  stitchSourceSettingsRef.current = stitchSourceSettings
  const prevFileNamesRef = useRef<string>("")
  
  // ── Worker data refs ──
  const workerFileDataCache = useRef<[string, number[]][]>([])
  const workerFreqMap = useRef<[string, number][]>([])
  const precomputedFrames = useRef<any[]>([])
  const maxFrames = useRef<number>(0)

  // ── State: only things that control what JSX branch renders ──
  const [hasStitchedData, setHasStitchedData] = useState(false)
  const [frequencyRange, setFrequencyRange] = useState({ min: 0.0, max: 3.2 })

  // Drive FFTCanvas via state so each stitch/frame produces a new `data` object.
  // FFTCanvas ingests based on data identity, and we avoid remounting/resetting canvases.
  const [canvasData, setCanvasData] = useState<{ waveform: Float32Array } | null>(null)

  const setStitchStatus = useCallback((status: string) => {
    onStitchStatus?.(status)
  }, [onStitchStatus])

  // ── Helpers (no hooks, no deps) ──
  const parseFrequencyFromFilename = (filename: string): number => {
    const match = filename.match(/iq_(\d+\.?\d*)MHz/)
    return match ? parseFloat(match[1]) : 0.0
  }

  const loadC64File = async (file: File): Promise<number[]> => {
    if (fileDataCache.current.has(file.name)) {
      return fileDataCache.current.get(file.name)!
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const buffer = e.target?.result as ArrayBuffer
          const data = new Array(buffer.byteLength)
          const view = new DataView(buffer)
          for (let i = 0; i < buffer.byteLength; i++) {
            data[i] = view.getUint8(i)
          }
          fileDataCache.current.set(file.name, data)
          resolve(data)
        } catch (error) {
          reject(error)
        }
      }
      reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`))
      reader.readAsArrayBuffer(file)
    })
  }

  const processToSpectrum = useCallback((rawData: number[], frame: number = 0): number[] => {
    const fftSize = 32768 // Default for file processing
    const spectrum = new Array(fftSize).fill(-120)
    const windowSize = fftSize * 2
    const windowStep = windowSize * 4
    const maxChunks = 8
    const maxStart = Math.max(0, rawData.length - windowSize)
    const startBase = maxStart > 0 ? (frame * windowStep) % maxStart : 0
    const availableChunks = Math.max(1, Math.floor((rawData.length - startBase) / windowSize))
    const chunks = Math.min(maxChunks, availableChunks)

    const powerBins = new Array(fftSize).fill(0)
    const counts = new Array(fftSize).fill(0)
    const refMag = 512

    for (let c = 0; c < chunks; c++) {
      const span = Math.max(1, chunks - 1)
      const start = chunks === 1
        ? startBase
        : Math.min(rawData.length - windowSize, startBase + Math.floor((c * (rawData.length - windowSize - startBase)) / span))
      for (let i = 0; i < windowSize && start + i + 1 < rawData.length; i += 2) {
        const real = (rawData[start + i] ?? 128) - 128
        const imag = (rawData[start + i + 1] ?? 128) - 128
        const magnitude = Math.sqrt(real * real + imag * imag)
        const bin = Math.floor(i / 2) % fftSize
        powerBins[bin] += magnitude * magnitude
        counts[bin] += 1
      }
    }

    const gainOffset = -60 + (stitchSourceSettingsRef.current.gain || 0)
    for (let i = 0; i < fftSize; i++) {
      const rms = counts[i] > 0 ? Math.sqrt(powerBins[i] / counts[i]) : 0
      const normalized = rms / refMag
      const dbValue = normalized > 0 ? 20 * Math.log10(normalized) + gainOffset : -120
      spectrum[i] = Math.max(-120, Math.min(0, dbValue))
    }
    return spectrum
  }, [])

  // Build combined waveform from cached data at a given frame
  const buildCombinedFrame = useCallback(async (frame: number) => {
    try {
      // PERFORMANCE OPTIMIZATION: Use precomputed frames if available
      if (precomputedFrames.current.length > 0) {
        const frameIndex = frame % maxFrames.current
        const result = await fileWorkerManager.getFrame(frameIndex, precomputedFrames.current)
        return result.frame
      }
      
      // Fallback to worker-based frame building
      const result = await fileWorkerManager.buildFrame(
        frame,
        workerFileDataCache.current,
        workerFreqMap.current
      )
      return result.frame
    } catch (error) {
      console.warn("Worker frame building failed, using fallback:", error)
      
      // Fallback to local processing
      const fftSize = 32768 // Default for file processing
      const cachedEntries = Array.from(fileDataCache.current.entries())
      if (cachedEntries.length === 0) return null

      let minFreq = Infinity
      let maxFreq = -Infinity
      for (const [name] of cachedEntries) {
        const freq = freqMapRef.current.get(name) ?? 0
        minFreq = Math.min(minFreq, freq - 1.6)
        maxFreq = Math.max(maxFreq, freq + 1.6)
      }
      if (minFreq === Infinity) return null

      const combinedWaveform = new Float32Array(fftSize).fill(-120)
      const totalFreqSpan = maxFreq - minFreq || 1

      for (const [name, raw] of cachedEntries) {
        const freq = freqMapRef.current.get(name) ?? 0
        const spectrum = processToSpectrum(raw, frame)
        const fMin = freq - 1.6
        const startBin = Math.floor(((fMin - minFreq) / totalFreqSpan) * fftSize)
        const endBin = Math.floor(((freq + 1.6 - minFreq) / totalFreqSpan) * fftSize)

        for (let i = 0; i < spectrum.length; i++) {
          const targetBin = startBin + Math.floor((i / spectrum.length) * (endBin - startBin))
          if (targetBin >= 0 && targetBin < fftSize) {
            combinedWaveform[targetBin] = Math.max(combinedWaveform[targetBin], spectrum[i])
          }
        }
      }

      return { waveform: combinedWaveform, range: { min: minFreq, max: maxFreq } }
    }
  }, [processToSpectrum])

  // ── Stitch: loads files, produces first frame, sets hasStitchedData ──
  const stitchFiles = useCallback(async () => {
    const currentFiles = selectedFilesRef.current
    if (currentFiles.length === 0) {
      setStitchStatus("No files selected for stitching")
      return
    }

    setStitchStatus(`Loading ${currentFiles.length} files...`)
    freqMapRef.current.clear()
    fileDataCache.current.clear()

    try {
      // Use file worker for stitching
      const result = await fileWorkerManager.stitchFiles(
        currentFiles,
        stitchSourceSettingsRef.current,
        (progress) => {
          // Update status with progress information
          setStitchStatus(progress.status || `Loading ${progress.current}/${progress.total} files...`)
        }
      )

      if (!result.stitchedData) {
        throw new Error("Failed to stitch files")
      }

      // Store worker data in refs for frame building
      workerFileDataCache.current = result.fileDataCache
      workerFreqMap.current = result.freqMap
      precomputedFrames.current = result.precomputedFrames
      maxFrames.current = result.maxFrames

      // Also update local refs for compatibility
      fileDataCache.current = new Map(result.fileDataCache)
      freqMapRef.current = new Map(result.freqMap)

      setCanvasData({ waveform: result.stitchedData.waveform })
      setFrequencyRange(result.stitchedData.range)
      setHasStitchedData(true)
      setStitchStatus(`Successfully stitched ${result.loadedCount} files`)
      setTimeout(() => setStitchStatus(""), 3000)
    } catch (error) {
      console.error("Stitching failed:", error)
      setStitchStatus(`Stitching failed: ${(error as Error).message}`)
      setTimeout(() => setStitchStatus(""), 3000)
    }
  }, [setStitchStatus])

  // ── Trigger: respond to parent's stitch button click ──
  useEffect(() => {
    if (lastTriggerRef.current === null) {
      lastTriggerRef.current = stitchTrigger
      return
    }
    if (stitchTrigger !== null && stitchTrigger !== lastTriggerRef.current) {
      lastTriggerRef.current = stitchTrigger
      stitchFiles()
    }
  }, [stitchTrigger, stitchFiles])

  // ── Playback loop: runs only when unpaused + has data ──
  useEffect(() => {
    if (!hasStitchedData || isPaused) return

    const fftSize = 32768 // Default for file processing
    const windowSize = fftSize * 2
    const windowStep = windowSize * 4
    const cachedEntries = Array.from(fileDataCache.current.entries())
    if (cachedEntries.length === 0) return
    
    // PERFORMANCE OPTIMIZATION: Use precomputed maxFrames if available
    const maxFramesCount = maxFrames.current > 0 ? maxFrames.current : Math.max(1, Math.min(
      ...cachedEntries.map(([, raw]) => Math.floor(raw.length / windowStep))
    ))

    let animationFrameId: number | null = null
    let lastFrameTime = 0
    const targetFrameInterval = 250 // 4 FPS target
    
    const animateFrame = (timestamp: number) => {
      // Rate limiting to prevent excessive updates
      if (timestamp - lastFrameTime < targetFrameInterval) {
        animationFrameId = requestAnimationFrame(animateFrame)
        return
      }
      
      lastFrameTime = timestamp
      playbackFrameRef.current = (playbackFrameRef.current + 1) % maxFramesCount
      
      buildCombinedFrame(playbackFrameRef.current)
        .then(result => {
          if (!result) return
          
          // New object identity so FFTCanvas ingests.
          setCanvasData({ waveform: result.waveform })
          setFrequencyRange(result.range)
        })
        .catch(error => {
          console.warn("Frame building failed:", error)
        })
      
      // Continue animation loop
      if (!isPaused) {
        animationFrameId = requestAnimationFrame(animateFrame)
      }
    }
    
    // Start animation loop
    animationFrameId = requestAnimationFrame(animateFrame)
    
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }
    }
  }, [hasStitchedData, isPaused, buildCombinedFrame])

  // ── Clear when file selection actually changes (compare names, not identity) ──
  useEffect(() => {
    const nameKey = selectedFiles.map((f) => f.name).sort().join("|")
    if (nameKey === prevFileNamesRef.current) return
    prevFileNamesRef.current = nameKey

    setCanvasData(null)
    setHasStitchedData(false)
    setStitchStatus("")
    playbackFrameRef.current = 0
    fileDataCache.current.clear()
    freqMapRef.current.clear()
  }, [selectedFiles, setStitchStatus])

  const fftCanvasData = canvasData

  return (
    <StitcherContainer>
      <VisualizationContainer>
        {hasStitchedData && fftCanvasData ? (
          <FFTCanvas
            data={fftCanvasData}
            frequencyRange={frequencyRange}
            centerFrequencyMHz={(frequencyRange.min + frequencyRange.max) / 2}
            activeSignalArea="A"
            isPaused={isPaused}
            isDeviceConnected={false}
            force2D
          />
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#444",
              fontSize: "14px",
              textAlign: "center",
              padding: "40px",
            }}
          >
            {selectedFiles.length > 0 ? (
              <div>
                <div style={{ marginBottom: "16px" }}>
                  {selectedFiles.length} file(s) selected
                </div>
                <div style={{ fontSize: "12px", color: "#666" }}>
                  Click "Stitch spectrum" to process and visualize the combined data
                </div>
              </div>
            ) : (
              "Select .c64 files to begin stitching"
            )}
          </div>
        )}
      </VisualizationContainer>
    </StitcherContainer>
  )
}

export default FFTStitcherCanvas
