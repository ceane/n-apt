# I/Q acquisition modes

The hardware samples a limited frequency window at a time. A requested range
wider than the usable part of that window needs multiple tuned windows
(hops). Acquisition mode controls how those windows are visited; it does not
change the hardware sample rate or make separate visits one uninterrupted
timeline.

| Mode | Behavior | Useful for | Continuity caveat |
|---|---|---|---|
| `stepwise` | Completes one window/hop, then steps to the next. The backend calls its internal mode `stepwise_naive`. | Surveying a broad range when ordered coverage matters more than revisiting every location quickly. | Adjacent frequency windows are recorded at different times. Stitching their frequency coverage does not make their time histories simultaneous or contiguous. |
| `interleaved` | Cycles through planned windows repeatedly, producing time-interleaved channel/hop data (including TDMS-style capture paths). | Following multiple separated ranges over a longer observation, where repeated visits are more useful than one long hold per range. | Each channel is sampled in bursts with gaps while the receiver visits others. Do not describe any one channel as continuously acquired across those gaps. |
| `whole_sample` | For each requested fragment, uses a hardware-rate window centered on that fragment. It avoids splitting a fragment into overlapping sub-hops in the planner. | A focused one-window capture; use one fragment for a simple contiguous capture request. | Multiple requested fragments still mean multiple windows. Physical retunes and device warm-up can discard samples; inspect boundary/discard evidence before claiming losslessness. |

The backend plans usable bandwidth from 75% of the effective hardware sample
rate to avoid noisy or distorted window edges. A `stepwise` request whose
fragment exceeds usable bandwidth can therefore expand into overlapping hops.
`whole_sample` is not an instruction to capture an arbitrarily wide span in
one hardware window: the hardware still has a finite sample rate.

For an unambiguous one-window request, use one fragment and explicitly select
`whole_sample`, for example:

```bash
npm run cli -- capture iq \
  --allow-mutations \
  --device mock-apt \
  --center-frequency 137500000 \
  --sample-rate 3200000 \
  --acquisition-mode whole_sample \
  --duration 1 \
  --file-type .iq
```

This is a software/mock example. It does not prove physical SDR continuity.
See [capture-workflow.md](capture-workflow.md) for device and artifact handling.
