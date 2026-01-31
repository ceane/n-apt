import { useState, useEffect, useRef, useCallback } from 'react';

export const useWebSocket = (url, enabled = true) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isDeviceConnected, setIsDeviceConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const pendingDataRef = useRef(null);
  const processingRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      // Close existing connection if disabled
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    const connect = () => {
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          setIsConnected(true);
          setError(null);
        };

        ws.onmessage = (event) => {
          try {
            const parsedData = JSON.parse(event.data);

            // Handle status messages
            if (parsedData.type === 'status') {
              setIsDeviceConnected(parsedData.deviceConnected || false);
              setIsPaused(parsedData.paused || false);
              return;
            }

            // Handle regular data messages
            if (parsedData.is_mock !== undefined) {
              setIsDeviceConnected(!parsedData.is_mock);
            }

            // Buffer messages - only keep the latest one
            pendingDataRef.current = parsedData;

            // Process buffered message if not already processing
            if (!processingRef.current) {
              processingRef.current = true;
              // Use requestAnimationFrame to throttle processing
              requestAnimationFrame(() => {
                if (pendingDataRef.current) {
                  setData(pendingDataRef.current);
                  pendingDataRef.current = null;
                }
                processingRef.current = false;
              });
            }
          } catch (err) {
            console.error('Failed to parse WebSocket message:', err);
          }
        };

        ws.onclose = () => {
          setIsConnected(false);
          // Attempt to reconnect after 2 seconds
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 2000);
        };

        ws.onerror = (err) => {
          setError('WebSocket error occurred');
          console.error('WebSocket error:', err);
        };
      } catch (err) {
        setError('Failed to create WebSocket connection');
        console.error('WebSocket creation error:', err);
      }
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [url, enabled]);

  // Function to send frequency range updates to the server
  const sendFrequencyRange = useCallback((range) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: 'frequency_range',
        minFreq: range.min,
        maxFreq: range.max
      });
      wsRef.current.send(message);
    }
  }, []);

  // Function to send pause/resume commands to the server
  const sendPauseCommand = useCallback((paused) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: 'pause',
        paused: paused
      });
      wsRef.current.send(message);
      setIsPaused(paused);
    }
  }, []);

  return { isConnected, isDeviceConnected, isPaused, data, error, sendFrequencyRange, sendPauseCommand };
};
