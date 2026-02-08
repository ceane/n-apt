import { useState, useEffect, useRef, useCallback } from "react"

// Types
export type FrequencyRange = {
  min: number
  max: number
}

export type WebSocketData = {
  isConnected: boolean
  isDeviceConnected: boolean
  isPaused: boolean
  data: any
  error: string | null
  sendFrequencyRange: (range: FrequencyRange) => void
  sendPauseCommand: (isPaused: boolean) => void
}

// Hook implementation
export const useWebSocket = (
  url: string,
  enabled: boolean = true,
): WebSocketData => {
  const [isConnected, setIsConnected] = useState(false)
  const [isDeviceConnected, setIsDeviceConnected] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const pendingDataRef = useRef<any>(null)
  const processingRef = useRef(false)

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
          }

          ws.onmessage = (event) => {
            try {
              const parsedData = JSON.parse(event.data)

              // Check for status message type
              if (typeof parsedData === "object" && parsedData !== null) {
                const type = parsedData.type

                if (type === "status") {
                  const deviceConnected = parsedData.deviceConnected || false
                  const paused = parsedData.paused || false
                  setIsDeviceConnected(deviceConnected)
                  setIsPaused(paused)
                } else {
                  // Handle regular data messages
                  if (parsedData.is_mock !== undefined) {
                    setIsDeviceConnected(!parsedData.is_mock)
                  }

                  // Buffer messages - only keep the latest one
                  pendingDataRef.current = parsedData

                  // Process buffered message if not already processing
                  if (!processingRef.current) {
                    processingRef.current = true
                    requestAnimationFrame(() => {
                      if (pendingDataRef.current) {
                        setData(pendingDataRef.current)
                        pendingDataRef.current = null
                      }
                      processingRef.current = false
                    })
                  }
                }
              } else {
                // Handle regular data messages (no type field)
                if (parsedData.is_mock !== undefined) {
                  setIsDeviceConnected(!parsedData.is_mock)
                }

                pendingDataRef.current = parsedData

                if (!processingRef.current) {
                  processingRef.current = true
                  requestAnimationFrame(() => {
                    if (pendingDataRef.current) {
                      setData(pendingDataRef.current)
                      pendingDataRef.current = null
                    }
                    processingRef.current = false
                  })
                }
              }
            } catch {
              // Failed to parse WebSocket message
            }
          }

          ws.onclose = () => {
            setIsConnected(false)
            // Only attempt to reconnect if we haven't been cleaned up
            if (wsRef.current !== null) {
              const timeoutId = setTimeout(connect, 2000) as any
              reconnectTimeoutRef.current = timeoutId
            }
          }

          ws.onerror = () => {
            setError("WebSocket connection error")
            // Only log error if we haven't already closed the connection
            // This prevents errors during React strict mode cleanup
            if (wsRef.current !== null) {
              setError("WebSocket error occurred")
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

  return {
    isConnected,
    isDeviceConnected,
    isPaused,
    data,
    error,
    sendFrequencyRange,
    sendPauseCommand,
  }
}
