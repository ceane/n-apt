# Draw Signal

`/draw-signal` is a two-page signal simulator, not a general signal-generation
or ML model studio. The header's previous/next arrows switch between the
simulator and its polar radiation view; the sidebar changes to match the
selected page.

## Draw N-APT Signal Simulator

The first page renders a mathematical frequency-comb signal. Use the sidebar
to edit the active clump's beats and signal parameters. The controls include
clump count and selection, beat frequency, floor/model selection, base and
peak amplitudes, spike amplitude/width/count, center offset, center boost,
decay, and envelope width. The view reports clump count, active clump, spike
count, spike width, and envelope for the current selection. **Reset** restores
the draw parameters.

## Polar Radiation View

The second page renders paired 3D views: a radiation lobe and a WebGPU radio
wave visualization. They use the active signal's frequency and spike width;
the 3D view supports orbit navigation. The sidebar on this page provides the
polar-coordinate/radiation controls.

## Agent and WebMCP access

The registered WebMCP tools are `setSpikeCount`, `setSpikeWidth`,
`generateSignal`, and `exportSignal`. They do not expose every current sidebar
parameter, clump/beat editing, page navigation, or the polar view controls.
Check the capability manifest for parameter schemas and execution policy.
Generated content is synthetic and should be treated as simulation output.
