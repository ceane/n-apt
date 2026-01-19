from rtlsdr import RtlSdr
import numpy as np
import os
import time
from datetime import datetime
import signal
import sys

# -------------------------
# Config
# -------------------------
sample_rate = 3.2e6       # max for RTL-SDR
usable_bw = 3.2e6          # no guard band
gain = 'auto'
samples_per_capture = int(sample_rate * 1.0)  # 1 second per slice

# Avoid DC region
center_start = 0.5e6  # 500 kHz
center_end = 31e6

freq_range = f"{center_start/1e6:.1f}-{center_end/1e6:.1f}MHz"
script_name = os.path.basename(__file__).replace('.py', '')

step = usable_bw                # 3.2 MHz per slice

# Generate center frequencies
freqs = np.arange(center_start, center_end, step)

# -------------------------
# RTL-SDR capture
# -------------------------
sdr = RtlSdr()
sdr.sample_rate = sample_rate
sdr.gain = gain

# Signal handler for graceful exit
def signal_handler(sig, frame):
    print("\nStopping capture...")
    sdr.close()
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)

print("Starting continuous capture. Press Ctrl+C to stop.")
print(f"Scanning {center_start/1e6:.1f} - {center_end/1e6:.1f} MHz\n")
print("Each scan will create a new folder.\n")

try:
    while True:
        # Create new folder for this scan
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        counter = 0
        while True:
            if counter == 0:
                out_dir = f"iq-samples/capture_{freq_range}_{script_name}_{timestamp}"
            else:
                out_dir = f"iq-samples/capture_{freq_range}_{script_name}_{timestamp}_{counter}"
            
            if not os.path.exists(out_dir):
                break
            counter += 1
        
        os.makedirs(out_dir, exist_ok=True)
        print(f"Created new capture folder: {out_dir}")
        
        # Dictionary to hold stitched spectrum for this scan
        spectrum = {}
        
        for f in freqs:
            print(f"Capturing {f/1e6:.2f} MHz", end='\r')
            sdr.center_freq = f
            time.sleep(0.2)  # allow PLL to settle

            iq = sdr.read_samples(samples_per_capture)

            # Save raw IQ for backup
            freq_str = f"{f/1e3:.1f}kHz" if f < 1e6 else f"{f/1e6:.2f}MHz"
            filename = f"{out_dir}/iq_{freq_str}.c64"
            iq.astype(np.complex64).tofile(filename)

            # -------------------------
            # FFT and frequency mapping
            # -------------------------
            fft_size = 262144
            fft = np.fft.fftshift(np.fft.fft(iq[:fft_size]))
            freqs_fft = np.fft.fftshift(np.fft.fftfreq(fft_size, 1/sample_rate))

            for fi, val in zip(freqs_fft, fft):
                abs_f = f + fi
                spectrum[abs_f] = val  # overwrite, no overlap
        
        # Save stitched spectrum for this scan
        print("\nSaving stitched spectrum...")
        final_freqs = np.array(sorted(spectrum.keys()))
        final_spec = np.array([spectrum[f] for f in final_freqs])
        
        np.save(os.path.join(out_dir, "stitched_spectrum_freqs.npy"), final_freqs)
        np.save(os.path.join(out_dir, "stitched_spectrum.npy"), final_spec)
        
        print(f"Scan complete. Saved {len(final_spec)} points to {out_dir}")
        print("Starting next scan...\n")
except Exception as e:
    print(f"\nError occurred: {e}")
    sdr.close()
    sys.exit(1)
