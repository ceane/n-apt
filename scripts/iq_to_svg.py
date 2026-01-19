import numpy as np
import scipy.io.wavfile as wav
import matplotlib.pyplot as plt
import os

# -------------------------------
# 1. Load WAV IQ
# -------------------------------
sample_rate, data = wav.read("baseband_26065337Hz_20-41-04_06-01-2026.wav")  # Replace with your file

# Stereo vs mono
if data.ndim == 2:
    I = data[:, 0]
    Q = data[:, 1]
else:
    I = data[0::2]
    Q = data[1::2]

# Normalize Int32 to -1..1
if data.dtype == np.int32:
    I = I / 2**31
    Q = Q / 2**31

signal_len = len(I)
signal = I + 1j*Q

# -------------------------------
# 2. Output folder
# -------------------------------
output_folder = "iq_svgs_sdr_style"
os.makedirs(output_folder, exist_ok=True)

# -------------------------------
# 3. Function: SDR++ style downsample + smooth
# -------------------------------
def sdr_display_style(signal_component, target_points=2000, smooth_window=5):
    factor = max(1, len(signal_component)//target_points)
    decimated = signal_component[::factor]
    # Apply moving average smoothing
    if smooth_window > 1:
        kernel = np.ones(smooth_window)/smooth_window
        decimated = np.convolve(decimated, kernel, mode='same')
    # Scale to ±1 for display
    max_val = np.max(np.abs(decimated))
    if max_val > 0:
        decimated /= max_val
    return decimated, factor

# -------------------------------
# 4. Full 10s waveform SVG
# -------------------------------
I_plot, factor = sdr_display_style(I, target_points=2000, smooth_window=5)
Q_plot, _ = sdr_display_style(Q, target_points=2000, smooth_window=5)
t_plot = np.arange(len(I_plot)) * factor / sample_rate

plt.figure(figsize=(12,4))
plt.plot(t_plot, I_plot, label="I (in-phase)")
plt.plot(t_plot, Q_plot, label="Q (quadrature)")
plt.xlabel("Time [s]")
plt.ylabel("Amplitude (normalized)")
plt.title("IQ Signal (SDR++ style display)")
plt.legend()
plt.tight_layout()
plt.savefig(os.path.join(output_folder, "iq_full_sdr_style.svg"), format="svg")
plt.close()
print(f"Full waveform SVG saved: {output_folder}/iq_full_sdr_style.svg")

# -------------------------------
# 5. Zoomed-in windows (optional)
# -------------------------------
window_durations = [0.002, 0.01, 0.05]  # 2ms, 10ms, 50ms
for w_sec in window_durations:
    num_samples = int(w_sec * sample_rate)
    I_window, factor = sdr_display_style(I[:num_samples], target_points=500, smooth_window=3)
    Q_window, _ = sdr_display_style(Q[:num_samples], target_points=500, smooth_window=3)
    t_window = np.arange(len(I_window)) * factor / sample_rate

    plt.figure(figsize=(12,4))
    plt.plot(t_window, I_window, label="I (in-phase)")
    plt.plot(t_window, Q_window, label="Q (quadrature)")
    plt.xlabel("Time [s]")
    plt.ylabel("Amplitude (normalized)")
    plt.title(f"IQ Signal Zoomed Window ({w_sec*1000:.1f} ms)")
    plt.legend()
    plt.tight_layout()
    filename = f"iq_zoom_{int(w_sec*1000)}ms_sdr_style.svg"
    plt.savefig(os.path.join(output_folder, filename), format="svg")
    plt.close()
    print(f"Zoomed SVG saved: {output_folder}/{filename}")