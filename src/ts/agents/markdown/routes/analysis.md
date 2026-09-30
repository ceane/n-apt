# Demodulate

`/demodulate` (also `/demod`) is a configurable signal-processing workspace.
The center of the page is a node graph: connect source, tuning/configuration,
visualization, and analysis nodes to build a workflow. The sidebar supplies
starter flows and graph controls. The route is not a single fixed ML
classifier or a batch-analysis screen.

## Start with a flow

Choose a starter flow in the sidebar, then adapt its nodes to the selected
source and question. Current templates include **Reference Capture**,
**Try N-APT Audio**, **Listen to FM radio**, **Visualize**, **Find Spikes**,
**Tx Suite**, and **Reverse Engineering by Tx**. The exact list can evolve;
inspect the sidebar in the running app for the installed templates.

Nodes can be moved, connected, duplicated, and deleted. Right-click a node for
node actions; visualization nodes with a fullscreen view can be opened from
that menu. Source and file nodes follow the app's selected live/file source.
When file playback is selected, the route connects the playback bridge to the
graph. Existing graph layouts and viewport state are persisted by graph.

## Analysis workflows

- **Visualize** uses source, channel/configuration, FFT, and waterfall nodes.
- **Find Spikes** connects an FFT view to spike detection.
- **Try N-APT Audio** explores a demodulation path with Span, FFT, waterfall,
  and radio nodes. The audio survey exposes candidates and decoder choices in
  its node controls.
- **Reference Capture** builds a capture/readiness path around a known
  stimulus and I/Q data.
- **Tx Suite** and **Reverse Engineering by Tx** pair receive and transmit
  roles, device settings, spectra, histories, and observation controls. These
  are hardware workflows; verify source capability, binding, and operating
  conditions before using them.

The graph represents configured processing steps. Results and visual
correlations do not establish the identity, intent, or biological effect of a
signal.

## Agent and WebMCP access

The route's registered tools are `startAnalysis`, `getAnalysisResults`, and
`exportAnalysisResults`. They do not create or edit the node graph. Use the
capability manifest for parameters and execution policy; the route's graph
templates and interactive node controls remain app UI workflows. CLI
mutations require `--allow-mutations`, and backend calls require authentication.
