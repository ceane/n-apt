// WebSocket bindings
module WebSocket = {
  type t

  @new external make: string => t = "WebSocket"
  @send external close: t => unit = "close"
  @send external send: (t, string) => unit = "send"
  @get external getReadyState: t => int = "readyState"

  @set external setOnOpen: (t, unit => unit) => unit = "onopen"
  @set external setOnMessage: (t, {"data": string} => unit) => unit = "onmessage"
  @set external setOnClose: (t, unit => unit) => unit = "onclose"
  @set external setOnError: (t, 'a => unit) => unit = "onerror"

  let isOpen = (ws: t) => getReadyState(ws) === 1
}

// Timeout bindings
@scope("globalThis")
external setTimeout: (unit => unit, int) => int = "setTimeout"

@scope("globalThis")
external clearTimeout: int => unit = "clearTimeout"

// requestAnimationFrame binding
@scope("globalThis")
external requestAnimationFrame: (unit => unit) => int = "requestAnimationFrame"

// Types
type frequencyRange = {
  min: float,
  max: float,
}

type webSocketData = {
  isConnected: bool,
  isDeviceConnected: bool,
  isPaused: bool,
  data: option<Js.Json.t>,
  error: option<string>,
  sendFrequencyRange: frequencyRange => unit,
  sendPauseCommand: bool => unit,
}

// Hook implementation
let useWebSocket = (url: string, ~enabled: bool=true) => {
  let (isConnected, setIsConnected) = React.useState(() => false)
  let (isDeviceConnected, setIsDeviceConnected) = React.useState(() => false)
  let (isPaused, setIsPaused) = React.useState(() => false)
  let (data, setData) = React.useState(() => None)
  let (error, setError) = React.useState(() => None)

  let wsRef = React.useRef(None)
  let reconnectTimeoutRef = React.useRef(None)
  let pendingDataRef = React.useRef(None)
  let processingRef = React.useRef(false)

  React.useEffect2(() => {
    if !enabled {
      // Close existing connection if disabled
      let ws = wsRef.current
      wsRef.current = None
      switch reconnectTimeoutRef.current {
      | Some(timeoutId) => 
        clearTimeout(timeoutId)
        reconnectTimeoutRef.current = None
      | None => ()
      }
      switch ws {
      | Some(w) => WebSocket.close(w)
      | None => ()
      }
      setIsConnected(_ => false)
      None
    } else {
      let rec connect = () => {
        try {
          let ws = WebSocket.make(url)
          wsRef.current = Some(ws)

          WebSocket.setOnOpen(ws, () => {
            setIsConnected(_ => true)
            setError(_ => None)
          })

          WebSocket.setOnMessage(ws, event => {
            try {
              let parsedData = Js.Json.parseExn(event["data"])

              // Check for status message type
              switch Js.Json.decodeObject(parsedData) {
              | Some(obj) =>
                switch Js.Dict.get(obj, "type") {
                | Some(typeVal) =>
                  switch Js.Json.decodeString(typeVal) {
                  | Some("status") =>
                    let deviceConnected = switch Js.Dict.get(obj, "deviceConnected") {
                    | Some(v) =>
                      switch Js.Json.decodeBoolean(v) {
                      | Some(b) => b
                      | None => false
                      }
                    | None => false
                    }
                    let paused = switch Js.Dict.get(obj, "paused") {
                    | Some(v) =>
                      switch Js.Json.decodeBoolean(v) {
                      | Some(b) => b
                      | None => false
                      }
                    | None => false
                    }
                    setIsDeviceConnected(_ => deviceConnected)
                    setIsPaused(_ => paused)
                  | _ =>
                    // Handle regular data messages
                    switch Js.Dict.get(obj, "is_mock") {
                    | Some(isMockVal) =>
                      switch Js.Json.decodeBoolean(isMockVal) {
                      | Some(isMock) => setIsDeviceConnected(_ => !isMock)
                      | None => ()
                      }
                    | None => ()
                    }

                    // Buffer messages - only keep the latest one
                    pendingDataRef.current = Some(parsedData)

                    // Process buffered message if not already processing
                    if !processingRef.current {
                      processingRef.current = true
                      // Use requestAnimationFrame to throttle processing
                      let _ = requestAnimationFrame(() => {
                        switch pendingDataRef.current {
                        | Some(d) =>
                          setData(_ => Some(d))
                          pendingDataRef.current = None
                        | None => ()
                        }
                        processingRef.current = false
                      })
                    }
                  }
                | None =>
                  // Handle regular data messages (no type field)
                  switch Js.Dict.get(obj, "is_mock") {
                  | Some(isMockVal) =>
                    switch Js.Json.decodeBoolean(isMockVal) {
                    | Some(isMock) => setIsDeviceConnected(_ => !isMock)
                    | None => ()
                    }
                  | None => ()
                  }

                  pendingDataRef.current = Some(parsedData)

                  if !processingRef.current {
                    processingRef.current = true
                    let _ = requestAnimationFrame(() => {
                      switch pendingDataRef.current {
                      | Some(d) =>
                        setData(_ => Some(d))
                        pendingDataRef.current = None
                      | None => ()
                      }
                      processingRef.current = false
                    })
                  }
                }
              | None => ()
              }
            } catch {
            | _ => Js.Console.error("Failed to parse WebSocket message")
            }
          })

          WebSocket.setOnClose(ws, () => {
            setIsConnected(_ => false)
            // Only attempt to reconnect if we haven't been cleaned up
            if wsRef.current !== None {
              let timeoutId = setTimeout(connect, 2000)
              reconnectTimeoutRef.current = Some(timeoutId)
            }
          })

          WebSocket.setOnError(ws, _err => {
            // Only log error if we haven't already closed the connection
            // This prevents errors during React strict mode cleanup
            if wsRef.current !== None {
              setError(_ => Some("WebSocket error occurred"))
            }
          })
        } catch {
        | _ =>
          setError(_ => Some("Failed to create WebSocket connection"))
          Js.Console.error("WebSocket creation error")
        }
      }

      connect()

      Some(() => {
        // Cleanup function - set wsRef to None first to prevent reconnection attempts
        let ws = wsRef.current
        wsRef.current = None
        switch reconnectTimeoutRef.current {
        | Some(timeoutId) => clearTimeout(timeoutId)
        | None => ()
        }
        switch ws {
        | Some(w) => WebSocket.close(w)
        | None => ()
        }
      })
    }
  }, (url, enabled))

  // Function to send frequency range updates to the server
  let sendFrequencyRange = React.useCallback0(range => {
    switch wsRef.current {
    | Some(ws) =>
      if WebSocket.isOpen(ws) {
        let message = Js.Json.stringify(
          Js.Json.object_(
            Js.Dict.fromArray([
              ("type", Js.Json.string("frequency_range")),
              ("minFreq", Js.Json.number(range.min)),
              ("maxFreq", Js.Json.number(range.max)),
            ]),
          ),
        )
        WebSocket.send(ws, message)
      }
    | None => ()
    }
  })

  // Function to send pause/resume commands to the server
  let sendPauseCommand = React.useCallback0(paused => {
    switch wsRef.current {
    | Some(ws) =>
      if WebSocket.isOpen(ws) {
        let message = Js.Json.stringify(
          Js.Json.object_(
            Js.Dict.fromArray([
              ("type", Js.Json.string("pause")),
              ("paused", Js.Json.boolean(paused)),
            ]),
          ),
        )
        WebSocket.send(ws, message)
        setIsPaused(_ => paused)
      }
    | None => ()
    }
  })

  {
    isConnected,
    isDeviceConnected,
    isPaused,
    data,
    error,
    sendFrequencyRange,
    sendPauseCommand,
  }
}
