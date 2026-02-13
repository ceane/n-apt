import { useState, useEffect, useRef, useCallback } from "react"

// Types
export type FrequencyRange = {
  min: number
  max: number
}

export type SDRSettings = {
  fftSize?: number
  fftWindow?: string
  frameRate?: number
  gain?: number
  ppm?: number
}

export type WebSocketData = {
  isConnected: boolean
  isDeviceConnected: boolean
  isDeviceLoading: boolean
  isPaused: boolean
  serverPaused: boolean
  backend: string | null
  deviceInfo: string | null
  data: any
  error: string | null
  sendFrequencyRange: (range: FrequencyRange) => void
  sendPauseCommand: (isPaused: boolean) => void
  sendSettings: (settings: SDRSettings) => void
}

// Reconnect backoff schedule (seconds)
const RECONNECT_BACKOFF = [2, 5, 10, 30, 60, 90]

// Hook implementation
export const useWebSocket = (
  url: string,
  enabled: boolean = true,
): WebSocketData => {
  const [isConnected, setIsConnected] = useState(false)
  const [isDeviceConnected, setIsDeviceConnected] = useState(false)
  const [isDeviceLoading, setIsDeviceLoading] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [serverPaused, setServerPaused] = useState(false)
  const [backend, setBackend] = useState<string | null>(null)
  const [deviceInfo, setDeviceInfo] = useState<string | null>(null)
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  // Store raw message string — only JSON.parse inside rAF to avoid parsing discarded frames
  const pendingRawRef = useRef<string | null>(null)
  const processingRef = useRef(false)
  // Track last known is_mock value to avoid redundant state updates
  const lastIsMockRef = useRef<boolean | undefined>(undefined)
  // Exponential backoff counter
  const reconnectAttemptRef = useRef(0)
  // Error debounce — only set error state once per cooldown
  const lastErrorTimeRef = useRef(0)

  useEffect(() => {
    if (!enabled) {
      // Close existing connection if disabled
      const ws = wsRef.current
      wsRef.current = null

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }

      if (ws) {
        ws.close()
      }

      setIsConnected(false)
      return
    } else {
      const connect = () => {
        try {
          const ws = new WebSocket(url)
          wsRef.current = ws

          ws.onopen = () => {
            setIsConnected(true)
            setError(null)
            // Reset backoff on successful connection
            reconnectAttemptRef.current = 0
          }

          ws.onmessage = (event) => {
            const raw = event.data as string

            // Fast path: check if this is a status message (rare, small payload)
            // Status messages start with {"message_type":"status"
            if (raw.includes('"message_type":"status"')) {
              try {
                const parsedData = JSON.parse(raw)
                const deviceConnected = parsedData.device_connected ?? parsedData.deviceConnected ?? false
                const deviceLoading = parsedData.device_loading ?? false
                const paused = parsedData.paused || false

                if (typeof parsedData.backend === "string") {
                  setBackend(parsedData.backend)
                }
                if (typeof parsedData.device_info === "string") {
                  setDeviceInfo(parsedData.device_info)
                }
                setServerPaused(paused)
                setIsDeviceLoading(deviceLoading)

                // Only update state if values actually changed
                if (lastIsMockRef.current !== !deviceConnected) {
                  lastIsMockRef.current = !deviceConnected
                  setIsDeviceConnected(deviceConnected)
                }
                setIsPaused(paused)
              } catch {
                // Ignore parse errors on status messages
              }
              return
            }

            // Spectrum data: buffer raw string, only parse in rAF callback
            pendingRawRef.current = raw

            if (!processingRef.current) {
              processingRef.current = true
              requestAnimationFrame(() => {
                const pending = pendingRawRef.current
                pendingRawRef.current = null
                processingRef.current = false

                if (pending) {
                  try {
                    const parsedData = JSON.parse(pending)

                    // Update device connection state only when value changes
                    if (parsedData.is_mock !== undefined) {
                      const newIsMock = parsedData.is_mock as boolean
                      if (lastIsMockRef.current !== newIsMock) {
                        lastIsMockRef.current = newIsMock
                        setIsDeviceConnected(!newIsMock)
                      }

                      // If we haven't received a status message yet, infer a backend
                      // so the UI can still display the source label.
                      setBackend((prev) => (prev ? prev : newIsMock ? "mock" : "rtl-sdr"))
                    }

                    setData(parsedData)
                  } catch {
                    // Failed to parse buffered WebSocket message
                  }
                }
              })
            }
          }

          ws.onclose = () => {
            setIsConnected(false)
            // Only attempt to reconnect if we haven't been cleaned up
            if (wsRef.current !== null) {
              const attempt = reconnectAttemptRef.current
              const delaySec = RECONNECT_BACKOFF[Math.min(attempt, RECONNECT_BACKOFF.length - 1)]
              reconnectAttemptRef.current = attempt + 1
              const timeoutId = setTimeout(connect, delaySec * 1000) as any
              reconnectTimeoutRef.current = timeoutId
            }
          }

          ws.onerror = () => {
            // Debounce error state — only update once per 10 seconds
            const now = Date.now()
            if (now - lastErrorTimeRef.current > 10_000) {
              lastErrorTimeRef.current = now
              setError("WebSocket connection error")
            }
          }
        } catch {
          setError("Failed to create WebSocket connection")
        }
      }

      connect()

      return () => {
        // Cleanup function - set wsRef to null first to prevent reconnection attempts
        const ws = wsRef.current
        wsRef.current = null

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
        }

        if (ws) {
          ws.close()
        }
      }
    }
  }, [url, enabled])

  // Function to send frequency range updates to the server
  const sendFrequencyRange = useCallback((range: FrequencyRange) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: "frequency_range",
        minFreq: range.min,
        maxFreq: range.max,
      })
      ws.send(message)
    }
  }, [])

  // Function to send pause/resume commands to the server
  const sendPauseCommand = useCallback((paused: boolean) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: "pause",
        paused: paused,
      })
      ws.send(message)
      // Note: isPaused state will be updated via WebSocket status message
    }
  }, [])

  // Function to send settings updates to the server
  const sendSettings = useCallback((settings: SDRSettings) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: "settings",
        ...settings,
      })
      ws.send(message)
    }
  }, [])

  return {
    isConnected,
    isDeviceConnected,
    isDeviceLoading,
    isPaused,
    serverPaused,
    backend,
    deviceInfo,
    data,
    error,
    sendFrequencyRange,
    sendPauseCommand,
    sendSettings,
  }
}
