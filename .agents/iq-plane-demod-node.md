# I/Q Plane Demodulation Node

The Demod node library includes an `I/Q Plane` node. It reads the active live or
file I/Q frame and computes nine complex frequency-bin values for each
100-sample block. It draws each bin's complex values as a colored path, with
magnitude circles and frequency offsets from baseband center. Frames are
strided as needed to cap each path at 256 plotted points.

This is an exploratory view: its 100-sample DFT has 1% of the sample rate bin
spacing and uses a rectangular window, so nearby signals can leak into adjacent
bins. It is not a precision channelizer.
