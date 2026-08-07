# Signal terminology

| Simple wording | Correct term | Meaning in N-APT |
|---|---|---|
| Where the radio is listening | Center frequency | Middle of the sampled RF window |
| How wide the radio listens | Sample rate | Width of the hardware IQ window |
| The smaller part we study | Span or bandwidth | Selected frequency slice inside that window |
| Paired radio measurements | I/Q samples | In-phase and quadrature complex samples |
| A picture of energy by frequency | FFT / spectrum | Frequency-domain view of a time window |
| A continuous piece of the signal | Contiguous IQ | IQ samples with no missing time between them |
| Turning a carrier into useful output | Demodulation | Recovering audio, image, symbols, or data |
| The signal becoming old after a switch | Stale frame | Data from a previous source, session, or tuning request |
| How strong it is above background | SNR | Signal-to-noise ratio |

Keep hardware sample rate and selected span distinct. A narrow FM signal can use a slice of a wider hardware sample-rate window.
