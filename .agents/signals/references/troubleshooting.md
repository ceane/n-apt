# Signal app troubleshooting map

Start by deciding whether the app is showing a live source or a file. Then
follow the data at the boundary that owns the symptom. Do not treat a healthy
spectrum renderer as proof that capture or demodulation is healthy.

| Symptom | Likely owner | Inspect first |
|---|---|---|
| No live spectrum or an endless loading state | Source transport and live source lifecycle | Backend availability, selected versus active source ID, source status, transport phase, and lifecycle phase. An unavailable backend should render unavailable rather than an optimistic loading state. |
| Spectrum moves while the selected source or tuning changes, then jumps or flatlines | Acquisition frame axis and presentation viewport | Frame source ID, frame center and sample rate, requested viewport, and whether bins are mapped to the acquisition axis. During retune, acquired IQ belongs to its own center ± sample-rate/2 axis. |
| FFT moves but audio is silent or frozen | Demodulation input queue / demod flow | Whether contiguous IQ is arriving, source/session generation, tune intent, selected bandwidth, sample rate, and audio output. An FFT frame alone cannot feed continuous audio. |
| Audio or frames from the previous source appear after switching | Source/session lifecycle and stale-result guards | Source identity, session or stream generation, frame sequence, pending tune intent, and whether late asynchronous output is rejected. |
| File loads but spectrum or demod output looks wrong | File worker, metadata, and playback path | Container/version, encryption state, sample encoding, center and sample rates, channel routing, frame-update offsets, and integrity status. Confirm whether the selected flow supports that artifact. |
| Playback works for one file but breaks after stitching | Stitcher and per-file alignment | Each file's frequency window, channel, sample rate, continuity, tune boundaries, and frame-update offset units. Do not assume filenames establish order or frequency. |
| Mock succeeds but an SDR fails | Physical acquisition path | Device identity, effective tuning and gain, sample rate, supported bandwidth, warm-up/discarded samples, and persisted continuity evidence. Report mock and hardware evidence separately. |
| Empty demodulation graph | Demod flow persistence / intentional initial state | Whether the graph is intentionally empty, still loading, or failed to restore. Do not synthesize default nodes without evidence of a restoration bug. |

Trace the owner and a concrete observation before editing. For live paths,
distinguish selected source from active streaming source. For file paths,
distinguish metadata parsing from payload decryption and from actual playback.
