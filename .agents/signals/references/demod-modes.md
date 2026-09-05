# Current demodulation modes

N-APT currently exposes these algorithms through the shared TypeScript demodulation processors:

- `fm`: FM audio processing.
- `fmDiscriminator`: FM discriminator path.
- `aptAudio`: recover APT audio.
- `aptImage`: recover an APT image.

FM audio needs a bounded, contiguous IQ window. Do not feed it only the most recent FFT frame. When tuning live, reject output from an older tune intent or source/session.

The demod route uses flow nodes such as Radio, Span, IQ Capture, FM, APT, and Output. Preserve their existing names and data contracts when modifying the flow.
