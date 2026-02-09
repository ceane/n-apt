import React, { useEffect, useState, useRef, useCallback } from "react"
import FFTCanvas from "@n-apt/components/FFTCanvas"
import styled from "styled-components"

interface StitchedFileData {
  name: string
  waveform: number[]
  frequencyRange: { min: number; max: number }
}

interface FFTStitcherCanvasProps {
  selectedFiles: { name: string; file: File }[]
  stitchTrigger: number | null
  stitchSourceSettings: { gain: number; ppm: number }
  isPaused: boolean
}

const StitcherContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: #0a0a0a;
  position: relative;
`

const StatusHeader = styled.div`
  padding: 20px;
  background-color: #0d0d0d;
  border-bottom: 1px solid #1a1a1a;
`

const StatusTitle = styled.h3`
  font-size: 12px;
  color: #888;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 0 0 12px 0;
`

const StatusText = styled.div`
  padding: 12px;
  background-color: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  color: #ccc;
  text-align: center;
  font-size: 12px;
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
}) => {
  const [stitchStatus, setStitchStatus] = useState<string>("")
  const [stitchedData, setStitchedData] = useState<StitchedFileData | null>(null)
  const [playbackFrame, setPlaybackFrame] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [frequencyRange, setFrequencyRange] = useState({ min: 0.0, max: 3.2 })
  const fileDataCache = useRef<Map<string, number[]>>(new Map())
  const freqMapRef = useRef<Map<string, number>>(new Map())
  const lastTriggerRef = useRef<number | null>(null)

  // Parse frequency from filename (e.g., "iq_10.10MHz.c64" -> 10.10)
  const parseFrequencyFromFilename = (filename: string): number => {
    const match = filename.match(/iq_(\d+\.?\d*)MHz/)
    if (match) {
      return parseFloat(match[1])
    }
    return 0.0
  }

  // Load and parse a .c64 file
  const loadC64File = async (file: File): Promise<number[]> => {
    if (fileDataCache.current.has(file.name)) {
      return fileDataCache.current.get(file.name)!
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const buffer = e.target?.result as ArrayBuffer
          const view = new DataView(buffer)
          const data: number[] = []
          
          // .c64 files contain 8-bit unsigned samples
          for (let i = 0; i < buffer.byteLength; i++) {
            data.push(view.getUint8(i))
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

  // Process loaded data into FFT spectrum
  const processToSpectrum = (rawData: number[], frame: number = 0): number[] => {
    const fftSize = 1024
    const spectrum = new Array(fftSize).fill(-120) // Initialize with deep noise floor
    
    // Sample multiple chunks across the file to approximate motion without full decode
    const windowSize = fftSize * 2
    const windowStep = windowSize * 4
    const maxChunks = 8
    const startBase = Math.max(0, Math.min(rawData.length - windowSize, frame * windowStep))
    const availableChunks = Math.max(1, Math.floor((rawData.length - startBase) / windowSize))
    const chunks = Math.min(maxChunks, availableChunks)
    console.log(`Sampling ${chunks} chunks (~${windowSize} samples each) from ${rawData.length} total starting at ${startBase}`)

    // Bin RMS power using zero-centered 8-bit IQ
    const powerBins = new Array(fftSize).fill(0)
    const counts = new Array(fftSize).fill(0)
    let observedMax = 1e-9
    const refMag = 512 // Softer reference to keep typical noise below 0 dB

    for (let c = 0; c < chunks; c++) {
      const span = Math.max(1, chunks - 1)
      const start = chunks === 1
        ? startBase
        : Math.min(rawData.length - windowSize, startBase + Math.floor((c * (rawData.length - windowSize - startBase)) / span))
      for (let i = 0; i < windowSize && start + i + 1 < rawData.length; i += 2) {
        const real = (rawData[start + i] ?? 128) - 128 // center to 0
        const imag = (rawData[start + i + 1] ?? 128) - 128
        const magnitude = Math.sqrt(real * real + imag * imag)
        observedMax = Math.max(observedMax, magnitude)

        const bin = Math.floor(i / 2) % fftSize
        powerBins[bin] += magnitude * magnitude
        counts[bin] += 1
      }
    }

    const gainOffset = -60 + (stitchSourceSettings.gain || 0) // lower baseline to match expected floor
    for (let i = 0; i < fftSize; i++) {
      const rms = counts[i] > 0 ? Math.sqrt(powerBins[i] / counts[i]) : 0
      const normalized = rms / refMag
      const dbValue = normalized > 0 ? 20 * Math.log10(normalized) + gainOffset : -120
      spectrum[i] = Math.max(-120, Math.min(0, dbValue))
    }

    console.log(`Spectrum stats: min=${Math.min(...spectrum).toFixed(1)}, max=${Math.max(...spectrum).toFixed(1)}, observedMax=${observedMax.toFixed(1)}`)
    return spectrum
  }

  // Use ref to always have access to current selectedFiles.
  // IMPORTANT: update synchronously during render so the first stitch click
  // right after file selection sees the latest files.
  const selectedFilesRef = useRef(selectedFiles)
  selectedFilesRef.current = selectedFiles

  // Stitch multiple files together
  const stitchFiles = useCallback(async () => {
    const currentFiles = selectedFilesRef.current
    if (currentFiles.length === 0) {
      setStitchStatus("No files selected for stitching")
      return
    }

    setIsProcessing(true)
    setStitchStatus(`Loading ${currentFiles.length} files...`)

    try {
      const fileData: StitchedFileData[] = []
      freqMapRef.current.clear()

      // Load all files
      for (let i = 0; i < currentFiles.length; i++) {
        const selectedFile = currentFiles[i]
        setStitchStatus(`Loading file ${i + 1}/${currentFiles.length}: ${selectedFile.name}`)
        
        try {
          const rawData = await loadC64File(selectedFile.file)
          fileDataCache.current.set(selectedFile.name, rawData)
          const spectrum = processToSpectrum(rawData, 0)
          const baseFrequency = parseFrequencyFromFilename(selectedFile.name)
          const frequency = baseFrequency * (1 + (stitchSourceSettings.ppm || 0) * 1e-6)
          freqMapRef.current.set(selectedFile.name, frequency)
          
          fileData.push({
            name: selectedFile.name,
            waveform: spectrum,
            frequencyRange: { min: frequency - 1.6, max: frequency + 1.6 }, // 3.2MHz span centered on corrected frequency
          })
        } catch (error) {
          console.warn(`Failed to load ${selectedFile.name}:`, error)
        }
      }

      if (fileData.length === 0) {
        throw new Error("No files could be loaded successfully")
      }

      // Calculate combined frequency range
      let minFreq = Infinity
      let maxFreq = -Infinity
      
      for (const data of fileData) {
        minFreq = Math.min(minFreq, data.frequencyRange.min)
        maxFreq = Math.max(maxFreq, data.frequencyRange.max)
      }

      // Instead of concatenating, create a representative spectrum
      // that spans the combined frequency range
      const fftSize = 1024
      const combinedWaveform = new Array(fftSize).fill(-100) // Initialize with noise floor (-100dB)
      
      console.log("Processing", fileData.length, "files with frequency range:", minFreq, "to", maxFreq)
      
      // Map each file's spectrum to the appropriate frequency bins
      for (const data of fileData) {
        const fileFreqSpan = data.frequencyRange.max - data.frequencyRange.min
        const totalFreqSpan = maxFreq - minFreq
        
        console.log(`File ${data.name}: freq range ${data.frequencyRange.min.toFixed(2)}-${data.frequencyRange.max.toFixed(2)}, span ${fileFreqSpan.toFixed(2)}`)
        
        if (fileFreqSpan > 0 && totalFreqSpan > 0) {
          // Calculate where this file's spectrum fits in the combined range
          const startBin = Math.floor(((data.frequencyRange.min - minFreq) / totalFreqSpan) * fftSize)
          const endBin = Math.floor(((data.frequencyRange.max - minFreq) / totalFreqSpan) * fftSize)
          
          console.log(`Mapping to bins ${startBin}-${endBin}`)
          
          // Map the file's spectrum to the appropriate bins
          for (let i = 0; i < data.waveform.length; i++) {
            const targetBin = startBin + Math.floor((i / data.waveform.length) * (endBin - startBin))
            if (targetBin >= 0 && targetBin < fftSize) {
              // Use max to ensure we don't lose signals in overlapping regions
              combinedWaveform[targetBin] = Math.max(combinedWaveform[targetBin], data.waveform[i])
            }
          }
        }
      }
      
      console.log("Combined waveform sample values:", combinedWaveform.slice(0, 10).map(v => v.toFixed(1)), "...", combinedWaveform.slice(-10).map(v => v.toFixed(1)))
      console.log("Combined waveform stats:", {
        min: Math.min(...combinedWaveform).toFixed(1),
        max: Math.max(...combinedWaveform).toFixed(1),
        avg: (combinedWaveform.reduce((a, b) => a + b, 0) / combinedWaveform.length).toFixed(1)
      })

      // Create stitched data object
      const stitched: StitchedFileData = {
        name: `Stitched_${fileData.length}_files`,
        waveform: combinedWaveform,
        frequencyRange: { min: minFreq, max: maxFreq }
      }

      setStitchedData(stitched)
      setFrequencyRange(stitched.frequencyRange)
      setPlaybackFrame(0)
      setStitchStatus(`Successfully stitched ${fileData.length} files`)
      
      // Clear status after 3 seconds
      setTimeout(() => setStitchStatus(""), 3000)
      
    } catch (error) {
      setStitchStatus(`Stitching failed: ${error}`)
      setTimeout(() => setStitchStatus(""), 3000)
    } finally {
      setIsProcessing(false)
    }
  }, [stitchSourceSettings])

  // Fire stitching when parent triggers it
  useEffect(() => {
    if (stitchTrigger !== null && stitchTrigger !== lastTriggerRef.current) {
      lastTriggerRef.current = stitchTrigger
      stitchFiles()
    }
  }, [stitchTrigger, stitchFiles])

  // Re-run stitch when source settings change if files are already selected
  useEffect(() => {
    if (selectedFiles.length > 0) {
      stitchFiles()
    }
  }, [stitchSourceSettings, selectedFiles.length, stitchFiles])

  // Playback loop: iterate frames across cached raw data and rebuild combined spectrum
  useEffect(() => {
    if (!stitchedData || selectedFiles.length === 0 || isPaused) return
    const id = setInterval(() => {
      setPlaybackFrame((prev) => {
        const next = prev + 1

        const cachedEntries = Array.from(fileDataCache.current.entries())
        if (cachedEntries.length === 0) return next

        const fftSize = 1024
        const combinedWaveform = new Array(fftSize).fill(-120)
        let minFreq = Infinity
        let maxFreq = -Infinity

        for (const [name, raw] of cachedEntries) {
          const freq = freqMapRef.current.get(name) ?? 0
          const spectrum = processToSpectrum(raw, next)
          const fileFreqRange = { min: freq - 1.6, max: freq + 1.6 }

          minFreq = Math.min(minFreq, fileFreqRange.min)
          maxFreq = Math.max(maxFreq, fileFreqRange.max)

          const totalFreqSpan = maxFreq - minFreq || 1
          const fileFreqSpan = fileFreqRange.max - fileFreqRange.min
          const startBin = Math.floor(((fileFreqRange.min - minFreq) / totalFreqSpan) * fftSize)
          const endBin = Math.floor(((fileFreqRange.max - minFreq) / totalFreqSpan) * fftSize)

          for (let i = 0; i < spectrum.length; i++) {
            const targetBin = startBin + Math.floor((i / spectrum.length) * (endBin - startBin))
            if (targetBin >= 0 && targetBin < fftSize) {
              combinedWaveform[targetBin] = Math.max(combinedWaveform[targetBin], spectrum[i])
            }
          }
        }

        if (minFreq === Infinity || maxFreq === -Infinity) return next

        setStitchedData({
          name: stitchedData.name,
          waveform: combinedWaveform,
          frequencyRange: { min: minFreq, max: maxFreq },
        })
        setFrequencyRange({ min: minFreq, max: maxFreq })
        return next
      })
    }, 250)
    return () => clearInterval(id)
  }, [stitchedData, selectedFiles.length, stitchSourceSettings, processToSpectrum, isPaused])

  // Clear cached data when files change
  useEffect(() => {
    if (selectedFiles.length === 0) {
      setStitchedData(null)
      setStitchStatus("")
      fileDataCache.current.clear()
    }
  }, [selectedFiles])

  return (
    <StitcherContainer>
      <StatusHeader>
        <StatusTitle>FFT Stitcher Canvas</StatusTitle>
        <StatusText>
          {stitchStatus || 
            (selectedFiles.length === 0
              ? "Select .c64 files to begin stitching"
              : `${selectedFiles.length} file(s) selected${isProcessing ? " - Processing..." : ""}`)}
        </StatusText>
      </StatusHeader>

      <VisualizationContainer>
        {stitchedData ? (
          <FFTCanvas
            data={{ waveform: stitchedData.waveform }}
            frequencyRange={frequencyRange}
            activeSignalArea="A"
            isPaused={false}
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
