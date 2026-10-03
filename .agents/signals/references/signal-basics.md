# What a signal is

A signal is a measurable change that carries information. Sound is a changing
air pressure; a radio signal is a changing electromagnetic field. A radio
transmitter can encode voice, images, or data by changing a repeating radio
wave called a carrier. Those controlled changes are modulation.

The receiver tunes to a frequency range and measures the incoming wave many
times per second. In N-APT, the receiver's samples describe two coordinates of
the wave at each instant: I (in-phase) and Q (quadrature). Together they are
complex I/Q samples. Their changing size and angle preserve information needed
to distinguish modulation and recover the original content.

An FFT rearranges a short run of those samples into a view of energy by
frequency. It helps show where activity is, but discards much of the time order
needed for demodulation. Demodulation uses the ordered I/Q samples to recover
audio, an image, symbols, or other data.

The width sampled at once is set by hardware sample rate. Center frequency says
where that window sits on the radio dial. A narrower selected span is a region
inside the sampled window; selecting it does not by itself lower the hardware
sample rate. If a requested range is too wide for one window, capture planning
uses multiple tuned windows (hops), with continuity limits described in
[`acquisition-modes.md`](acquisition-modes.md).

In one line: **signal → sampling as I/Q → spectrum or demodulation → useful
output**. A spectrum is one view of the samples, not the signal itself and not
proof that its content has been decoded.
