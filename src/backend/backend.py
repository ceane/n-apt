import asyncio
import websockets
import json
import numpy as np
import logging

# Try to import RTL-SDR, but allow running without it (mock mode)
try:
    from rtlsdr import RtlSdr
    RTLSDR_AVAILABLE = True
except (ImportError, OSError) as e:
    logging.warning(f"RTL-SDR library not available: {e}. Running in mock-only mode.")
    RtlSdr = None
    RTLSDR_AVAILABLE = False

# Set up logging
logging.basicConfig(level=logging.INFO)

# SDR Configuration
# SDR setup: RTL-SDR is configured with a sample rate of 3.2 MHz to match the desired bandwidth.
# Center frequency is set to 1.6 MHz to capture the 0-3.2 MHz slice symmetrically.
SAMPLE_RATE = 3.2e6  # 3.2 MHz bandwidth
CENTER_FREQ = 1.6e6  # Center at 1.6 MHz for 0-3.2 MHz slice
GAIN = 'auto'
# FFT Size: Original working value
NUM_SAMPLES = 1024 * 32  # 32768 samples - original working value
FFT_FRAME_RATE = 30  # Target frame rate to match SDR++
FFT_AVERAGING = 4  # Number of FFT frames to average together (reduces noise, reveals signals)



# WebSocket server
connected_clients = set()

# Global configuration that can be updated by clients
config = {
    'min_freq': 0,  # MHz
    'max_freq': 3.2,  # MHz
    'sample_rate': 3.2e6,  # Hz
    'center_freq': 1.6e6,  # Hz
}

# Global state
paused = False
is_mock = True

async def websocket_handler(websocket):
    connected_clients.add(websocket)
    global paused, is_mock
    try:
        # Send initial status to the new client
        status_message = json.dumps({
            'type': 'status',
            'deviceConnected': not is_mock,
            'paused': paused
        })
        await websocket.send(status_message)

        async for message in websocket:
            try:
                data = json.loads(message)
                if data.get('type') == 'frequency_range':
                    # Update configuration based on client request
                    min_freq_mhz = data.get('minFreq', 0)
                    max_freq_mhz = data.get('maxFreq', 3.2)
                    
                    # Convert MHz to Hz
                    config['min_freq'] = min_freq_mhz
                    config['max_freq'] = max_freq_mhz
                    config['sample_rate'] = (max_freq_mhz - min_freq_mhz) * 1e6
                    config['center_freq'] = ((min_freq_mhz + max_freq_mhz) / 2) * 1e6
                    
                    logging.info(f"Frequency range updated: {min_freq_mhz} MHz - {max_freq_mhz} MHz")
                    logging.info(f"New center freq: {config['center_freq']/1e6} MHz, sample rate: {config['sample_rate']/1e6} MHz")
                elif data.get('type') == 'pause':
                    paused = data.get('paused', False)
                    logging.info(f"Stream {'paused' if paused else 'resumed'}")
                    # Broadcast status update to all clients
                    status_message = json.dumps({
                        'type': 'status',
                        'deviceConnected': not is_mock,
                        'paused': paused
                    })
                    await asyncio.gather(*[client.send(status_message) for client in connected_clients])
            except json.JSONDecodeError:
                logging.warning(f"Received invalid JSON: {message}")
            except Exception as e:
                logging.error(f"Error handling message: {e}")
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.remove(websocket)

async def send_data(waveform, waterfall_row, is_mock, min_freq, max_freq):
    if connected_clients:
        data = {
            'waveform': waveform.tolist(),
            'waterfall': waterfall_row.tolist(),
            'is_mock': is_mock,
            'min_freq': min_freq,
            'max_freq': max_freq
        }
        message = json.dumps(data)
        await asyncio.gather(*[client.send(message) for client in connected_clients])

async def main():
    global paused, is_mock
    # SDR Setup
    # Initialize RTL-SDR device with pyrtlsdr library.
    sdr = None
    if RTLSDR_AVAILABLE:
        try:
            sdr = RtlSdr()
            sdr.sample_rate = config['sample_rate']
            sdr.center_freq = config['center_freq']
            sdr.gain = 49  # Fixed gain of 49 dB
            sdr.freq_correction = 1  # Set PPM correction to 1
            sdr.set_bias_tee(False)
            logging.info("RTL-SDR device initialized successfully with PPM=1 and gain=49 dB")
        except Exception as e:
            logging.warning(f"Failed to initialize RTL-SDR: {e}. Using mock data only.")
    else:
        logging.info("Running in mock-only mode (RTL-SDR library not available)")

    is_mock = sdr is None
    paused = False
    
    # FFT averaging buffer - stores recent power spectra for averaging
    power_buffer = []

    # WebSocket server to communicate with frontend
    server = await websockets.serve(websocket_handler, "localhost", 8765)

    try:
        while True:
            # Update SDR settings if config has changed
            if sdr:
                try:
                    if sdr.sample_rate != config['sample_rate']:
                        sdr.sample_rate = config['sample_rate']
                        logging.info(f"Updated sample rate to {config['sample_rate']/1e6} MHz")
                    if sdr.center_freq != config['center_freq']:
                        sdr.center_freq = config['center_freq']
                        logging.info(f"Updated center frequency to {config['center_freq']/1e6} MHz")
                except Exception as e:
                    logging.warning(f"Failed to update SDR settings: {e}")

            # Capture samples from SDR or use mock data
            using_real_sdr = False
            if sdr:
                try:
                    samples = sdr.read_samples(NUM_SAMPLES)
                    using_real_sdr = True
                except Exception as e:
                    logging.warning(f"Failed to read samples from SDR: {e}. Using mock data.")
                    samples = np.random.randn(NUM_SAMPLES) + 1j * np.random.randn(NUM_SAMPLES)
            else:
                samples = np.random.randn(NUM_SAMPLES) + 1j * np.random.randn(NUM_SAMPLES)

            # Debug: Log sample statistics periodically
            if np.random.random() < 0.05:  # Log ~5% of the time
                sample_max = np.max(np.abs(samples))
                sample_mean = np.mean(np.abs(samples))
                logging.info(f"Sample stats - max: {sample_max:.6f}, mean: {sample_mean:.6f}, using_real_sdr: {using_real_sdr}")

            # Process: FFT to convert time-domain samples to frequency domain
            # Apply Hanning window to reduce spectral leakage
            window = np.hanning(len(samples))
            windowed_samples = samples * window
            
            fft = np.fft.fft(windowed_samples)
            freqs = np.fft.fftfreq(len(samples), 1/config['sample_rate'])
            
            # Shift FFT result to center at correct frequencies
            fft_shifted = np.fft.fftshift(fft)
            freqs_shifted = np.fft.fftshift(freqs)
            
            # Convert to power spectral density
            power = np.abs(fft_shifted) ** 2
            # Normalize by FFT size
            power = power / len(samples)
            
            # FFT Averaging: Add current power to buffer and average
            # This reduces noise and makes signals more visible (like SDR++)
            power_buffer.append(power)
            if len(power_buffer) > FFT_AVERAGING:
                power_buffer.pop(0)  # Remove oldest
            
            # Average all power spectra in buffer
            averaged_power = np.mean(power_buffer, axis=0)
            
            # Convert to dB scale (add small offset to avoid log(0))
            amplitudes = 10 * np.log10(averaged_power + 1e-12)
            
            # Debug: Log amplitude statistics periodically
            if np.random.random() < 0.05:  # Log ~5% of the time
                amp_max = np.max(amplitudes)
                amp_min = np.min(amplitudes)
                amp_mean = np.mean(amplitudes)
                logging.info(f"Amplitude stats - max: {amp_max:.1f} dB, min: {amp_min:.1f} dB, mean: {amp_mean:.1f} dB, avg_frames: {len(power_buffer)}")
            
            # Calculate actual frequency range based on current config
            center_freq = config['center_freq']
            sample_rate = config['sample_rate']
            start_freq = center_freq - sample_rate/2
            end_freq = center_freq + sample_rate/2
            
            # Generate actual frequency values for each FFT bin
            num_bins = len(fft_shifted)
            actual_freqs = np.linspace(start_freq, end_freq, num_bins)
            
            # Slice mapping: Extract the configured bandwidth from the FFT result
            # The visible window is defined by the slider, but we need to extract
            # the portion of the FFT that corresponds to this window
            min_freq_hz = config['min_freq'] * 1e6
            max_freq_hz = config['max_freq'] * 1e6
            
            # Create mask for the visible frequency range
            mask = (actual_freqs >= min_freq_hz) & (actual_freqs <= max_freq_hz)
            
            # If the mask results in too few points, we might need to resample
            # For now, extract the visible portion
            waveform = amplitudes[mask]
            freq_slice = actual_freqs[mask]
            
            # Ensure we always return a consistent number of bins for the frontend
            # by resampling to match the expected resolution
            target_bins = 1024  # Match what the frontend expects
            if len(waveform) > 0 and len(waveform) != target_bins:
                # Resample to target_bins using simple numpy interpolation
                x_old = np.linspace(0, 1, len(waveform))
                x_new = np.linspace(0, 1, target_bins)
                waveform = np.interp(x_new, x_old, waveform)

            # Spike/valley detection: Identify spikes (high amplitudes) and valleys (low amplitudes)
            # using much more sensitive thresholds for better match with SDR++
            mean_amp = np.mean(waveform)
            std_amp = np.std(waveform)
            
            # Use very sensitive thresholds (matches SDR++ visualization)
            spikes = waveform > mean_amp + 0.5 * std_amp  # Spikes: above mean + 0.5*std (more sensitive)
            valleys = waveform < mean_amp - 0.3 * std_amp  # Valleys: below mean - 0.3*std (more sensitive)
            
            # Ensure we don't have negative indices
            valleys = np.clip(valleys, 0, None)

            # Scaling: The waveform is already in dB scale from the FFT processing above.
            # This matches SDR++ which displays power in dB.
            # For display, we keep the dB values - they naturally show spikes prominently.
            scaled_waveform = waveform

            # Waterfall frame: Normalize to 0-255 range for display
            # Match frontend display range
            min_db = -80  # Lower bound for dB display (noise floor)
            max_db = 20   # Upper bound for dB display (strong signal)
            
            # Clip values to the display range and normalize
            clipped = np.clip(scaled_waveform, min_db, max_db)
            normalized = (clipped - min_db) / (max_db - min_db)
            waterfall_row = (normalized * 255).astype(int)

            if not paused:
                await send_data(scaled_waveform, waterfall_row, is_mock, config['min_freq'], config['max_freq'])
            else:
                # When paused, still send status updates to keep clients informed
                await asyncio.sleep(1.0 / FFT_FRAME_RATE)

            # Match SDR++ frame rate of 30 FPS
            await asyncio.sleep(1.0 / FFT_FRAME_RATE)

    except KeyboardInterrupt:
        pass
    finally:
        if sdr:
            sdr.close()
        server.close()

if __name__ == "__main__":
    asyncio.run(main())