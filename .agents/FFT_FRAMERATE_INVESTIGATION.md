# FFT Frame Rate Backend Investigation

## Issue

Frontend sends frame rate settings correctly via WebSocket, but the backend broadcast rate appears constant regardless of settings changes.

## Frontend Verification ✅

- Settings are sent correctly: `{"type":"settings","fftSize":32768,"frameRate":60,...}`
- `useSdrSettings` hook manages frame rate state
- `SpectrumRoute` passes frame rate to state
- `FFTCanvas` removed `targetFPS` override to let backend control rate

## Backend Code Analysis ✅

### Settings Reception

`src/server/websocket_handlers.rs:239`

```rust
frame_rate: message.frame_rate,
```

Settings message correctly parsed and sent to SDR processor.

### Settings Application

`src/server/sdr_processor.rs:433-444`

```rust
if let Some(requested_rate) = frame_rate {
  let max_rate = self.calculate_max_frame_rate(config.fft_size);
  let clamped_rate = requested_rate.clamp(1, max_rate);
  self.display_frame_rate = clamped_rate;
  info!("Frame rate set to {} fps", clamped_rate);
}
```

Frame rate is clamped and stored in `display_frame_rate`.

### Broadcast Loop

`src/server/websocket_server.rs:141-148`

```rust
// Calculate current frame interval dynamically based on the applied frame rate
let current_frame_rate = sdr_processor.display_frame_rate.max(1);
let frame_interval = Duration::from_millis((1000 / current_frame_rate) as u64);

if shared.authenticated_count.load(Ordering::Relaxed) > 0 && !shared.is_paused.load(Ordering::Relaxed) {
    let now = std::time::Instant::now();
    if now.duration_since(last_frame) >= frame_interval {
        // Broadcast spectrum frame
```

Frame interval is calculated **dynamically on every loop iteration** using `display_frame_rate`.

## Added Logging

`src/server/websocket_server.rs:347-352`

```rust
info!("Applying settings: fft_size={:?}, frame_rate={:?}, gain={:?}, ppm={:?}", fft_size, frame_rate, gain, ppm);
if let Err(e) = sdr_processor.apply_settings(...) {
    error!("Failed to apply settings: {}", e);
} else {
    info!("Settings applied successfully. Current display_frame_rate: {} fps", sdr_processor.display_frame_rate);
}
```

## Testing Steps

1. ✅ Backend is running (mock mode, no RTL-SDR connected)
2. Open frontend at http://localhost:5173
3. Change FFT size from 32768 to 262144
4. Check backend logs for:
   - "Applying settings: fft_size=Some(262144), frame_rate=Some(12), ..."
   - "Settings applied successfully. Current display_frame_rate: 12 fps"
5. Verify WebSocket broadcast rate changes from 60fps to 12fps

## Expected Behavior

- FFT size 32768 → max 60 fps
- FFT size 65536 → max 48 fps
- FFT size 131072 → max 24 fps
- FFT size 262144 → max 12 fps

## Hypothesis

The code looks correct. The issue may be:

1. Settings command not reaching the SDR I/O thread
2. Command queue processing issue
3. Frontend not actually sending updated settings
4. WebSocket connection issue

Backend logs will reveal which of these is the actual problem.
