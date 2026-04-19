# Captured

If you ever end up in this thing and are curious...

```
npm run capture
```

1. Ensure an RTL-SDR device is connected and the necessary drivers are installed.
   - `brew install librtlsdr`
2. Install Python dependencies: `pip install pyrtlsdr numpy`

This runs `rtl_sdr_capture.py` by capturing IQ samples from an RTL-SDR device across multiple frequency slices. For each slice, it performs a Fast Fourier Transform (FFT) and stitches the resulting spectra together into a single wideband spectrum. The stitched spectrum is saved as NumPy arrays for further analysis.

**Required**

To get live captures you need an [RTL-SDR](https://www.rtl-sdr.com) (pictured below). A software defined radio (SDR) is an important piece of technology. It is a radio that allows one to see signals in the environment. It's recommened to also have a FM Bandpass filter (attached to the RTL-SDR in the photo) to filter out strong FM signals and get a cleaner capture, I had some partial interference with RTL-SDR. Currently I don't have an upconverter, which would capture and shift the signals to a higher frequency to get a cleaner capture.

![rtl-sdr](/n-apt/images/rtl-sdr.jpg)

**📡 Frequencies Captured**

- Start Frequency: 500 kHz
- End Frequency: 31 MHz
- Step Size: 3.2 MHz

This results in capturing from 0.5 MHz to 31 MHz in 3.2 MHz bandwidth slices, avoiding the DC region.

**RTL-SDR Settings**

- Sample Rate: 3.2 MS/s
- Gain: Auto
- Samples per Capture: 3.2 million (1 second per slice)
- FFT Size: 262144 points
- Output Directory: `iq-samples/capture_{freq_range}_{script_name}_{timestamp}/`

The script will create a timestamped directory in `iq-samples/` containing the raw IQ files and the stitched spectrum files.

## Visualizing the Stitched Spectrum

To plot the stitched spectrum:

```python
import numpy as np
import matplotlib.pyplot as plt

freqs = np.load('iq-samples/capture_0.5-31.0MHz_rtl_sdr_capture_2026-01-14_22-43/stitched_spectrum_freqs.npy')
spectrum = np.load('iq-samples/capture_0.5-31.0MHz_rtl_sdr_capture_2026-01-14_22-43/stitched_spectrum.npy')

plt.plot(freqs / 1e6, np.abs(spectrum))
plt.xlabel('Frequency (MHz)')
plt.ylabel('Magnitude')
plt.title('Stitched Spectrum')
plt.show()
```

## Cloning the Repository

The `iq-samples` directory contains large binary IQ data files. To avoid downloading these large files unnecessarily, use Git's sparse checkout feature to exclude `iq-samples` from your working directory.

### Sparse Checkout Setup

After cloning the repository:

1. Enable sparse checkout:

   ```
   git config core.sparseCheckout true
   ```

2. Edit `.git/info/sparse-checkout` and add:

   ```
   *
   !iq-samples/
   ```

3. Update your working directory:
   ```
   git checkout HEAD -- .
   ```

This will remove the `iq-samples` folder from your local copy while keeping it in the repository history.

To include `iq-samples` later, remove the `!iq-samples/` line from `.git/info/sparse-checkout` and run `git checkout HEAD -- .` again.

## Generating IQ Samples

To capture new IQ samples using the RTL-SDR device, use the npm script which activates the Python virtual environment and runs the capture script:

This is equivalent to:

```
source venv/bin/activate && python scripts/rtl_sdr_capture.py
```

Ensure you have set up the Python virtual environment (`venv`) with `python -m venv venv` and installed the required dependencies (`pip install pyrtlsdr numpy`).
