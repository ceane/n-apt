# Progressive VFO tuning

Progressive tuning is an opt-in path for RX channel selection. It is separate
from wheel/trackpad scrolling: scrolling remains direct, has no inertia state,
and must not use this controller. A direct wheel/hardware-retune gesture also
cancels any still-active progressive channel trajectory before that trajectory
can overwrite the gesture range.

## API

`useChannelTuner().tuneChannels` accepts a fifth argument:

```ts
tuneChannels(channels, selectedLabels, rangeOverride, sampleRateOverride, {
  durationMs: 500,
  inertia: "ease-out",
  wiggle: { amplitudeHz: 12_000, cycles: 2, damping: 4 },
});
```

The supported inertia values are `linear`, `ease-in`, `ease-out`,
`ease-in-out`, CSS-style cubic Bézier points, sine easing, or a custom
`(progress) => progress` function. `wiggle` is decorative and is forced to
zero at both endpoints. All trajectory ranges are integer-Hz ranges and are
translated, without changing bandwidth, into the active channel bounds.

Omitting the options argument preserves the existing single-step behavior.
RX channel selection supplies a 500 ms ease-out tune; playback and Tx channel
operations remain immediate.

## Lifecycle and transport

The controller in
`src/ts/features/spectrum/tuning/progressiveTuning.ts` owns one rAF trajectory
at a time. A newer tune cancels the prior trajectory, and an immediate tune
also cancels an active progressive tune. Preview ranges update the display on
every animation frame. Hardware retune commands are rate-limited to 50 ms and
the final target is always published exactly.

While previewing, `tuningPreviewActive` prevents the normal range-sync effect
from echoing every preview frame to the device. The controller is the only
publisher during the trajectory; the normal sync path resumes after the exact
final range is committed.

The progressive path must not be used to solve scroll rendering or mirror
presentation. Server FFT frames remain authoritative for live-spectrum axes.
