import numpy as np
import scipy.io.wavfile as wav
import matplotlib.pyplot as plt
from scipy.fft import fft, fftfreq

# -------------------------------
# 1. Load WAV IQ
# -------------------------------
sample_rate, data = wav.read("baseband_26065337Hz_20-41-04_06-01-2026.wav")  # replace with your file name

# Handle stereo vs mono
if data.ndim == 2:
    I = data[:, 0]
    Q = data[:, 1]
else:
    I = data[0::2]
    Q = data[1::2]

# Normalize Int32 to -1.0 to 1.0
if data.dtype == np.int32:
    I = I / 2**31
    Q = Q / 2**31

# Complex baseband signal
signal = I + 1j*Q
t = np.arange(len(signal)) / sample_rate  # time vector

# -------------------------------
# 2. Time-domain plot (zoomed)
# -------------------------------
window_sec = 0.002  # 2 ms window
num_samples = int(window_sec * sample_rate)

plt.figure(figsize=(12,4))
plt.plot(t[:num_samples], I[:num_samples], label="I (in-phase)")
plt.plot(t[:num_samples], Q[:num_samples], label="Q (quadrature)")
plt.xlabel("Time [s]")
plt.ylabel("Amplitude")
plt.title(f"Time-domain Signal (first {window_sec*1000} ms)")
plt.legend()
plt.show()

# -------------------------------
# 3. Frequency-domain plot (FFT)
# -------------------------------
N = len(signal)
spectrum = fft(signal)
freqs = fftfreq(N, 1/sample_rate)

plt.figure(figsize=(12,4))
plt.plot(freqs[:N//2], np.abs(spectrum[:N//2]))
plt.xlabel("Frequency [Hz]")
plt.ylabel("Magnitude")
plt.title("Frequency-domain Signal (FFT)")
plt.show()

# -------------------------------
# 4. Extract top N frequency components
# -------------------------------
num_components = 5  # top 5 strongest sinusoids
fft_mag = np.abs(spectrum[:N//2])
fft_sorted_indices = np.argsort(fft_mag)[-num_components:]  # top indices

# Store approximate sinusoids
approx_signal = np.zeros_like(signal, dtype=np.float64)

print("Approximate sinusoidal components (I-component):")
for idx in fft_sorted_indices[::-1]:  # strongest first
    f = freqs[idx]
    # Compute amplitude and phase from FFT
    amp = 2 * np.abs(spectrum[idx]) / N
    phase = np.angle(spectrum[idx])
    print(f"Amplitude={amp:.4f}, Frequency={f:.2f} Hz, Phase={phase:.2f} rad")
    approx_signal += amp * np.cos(2*np.pi*f*t + phase)

# -------------------------------
# 5. Plot approximate signal vs original I
# -------------------------------
plt.figure(figsize=(12,4))
plt.plot(t[:num_samples], I[:num_samples], label="Original I")
plt.plot(t[:num_samples], approx_signal[:num_samples], '--', label="Approximation")
plt.xlabel("Time [s]")
plt.ylabel("Amplitude")
plt.title("Original vs Approximated Signal (I-component)")
plt.legend()
plt.show()

# -------------------------------
# 6. Optional: Print formula
# -------------------------------
formula_terms = []
for idx in fft_sorted_indices[::-1]:
    f = freqs[idx]
    amp = 2 * np.abs(spectrum[idx]) / N
    phase = np.angle(spectrum[idx])
    formula_terms.append(f"{amp:.4f}*cos(2*pi*{f:.2f}*t + {phase:.2f})")

print("\nApproximate I(t) formula:")
print(" + ".join(formula_terms))