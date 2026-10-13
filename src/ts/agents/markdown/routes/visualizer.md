# Visualizer

`/` and `/visualizer` open the live spectrum workspace. The main view renders
the selected source's spectrum and waterfall; the sidebar contains the source,
capture, display, snapshot, classifier, and notes controls.

## Choose a source

In **Source**, choose a live receiver or switch to file input. Live mode lists
the available sources and their status. File mode lets you select I/Q or
capture files for playback; the workspace can stitch selected files for
continuous playback when supported by their metadata. The displayed controls
depend on source capabilities and connection state.

## Inspect and tune

The spectrum and waterfall share the current source and frequency view. Tune or
pan the view, change the active signal area and channel settings, and adjust
FFT/display settings in the sidebar. In live mode, Space pauses or resumes the
visualizer when focus is outside an input. A paused view freezes the displayed
frame; it does not stop a capture already running in the backend.

## Capture, snapshots, and notes

Live mode exposes I/Q capture settings for duration, acquisition range, output
format, encryption, playback, and optional location metadata. Start and stop
capture from that section and read its status before changing capture settings.
Snapshot controls export the current view, with options such as waterfall,
statistics, location, aspect ratio, grid, theme colors, and supported image or
video format. **Notes** can save a card with the current spectrum image and
frequency statistics.

The classifier panel is mounted in the sidebar when available. Its controls
and results depend on the active classifier and source; model output is an
analysis result, not proof of a signal's source or effect.

## Agent and WebMCP access

The registered WebMCP tools for this route include `setSourceMode`,
`connectDevice`, `startCapture`, `stopCapture`, `setActiveArea`,
`setFrequencyRange`, `classifySignal`, `setFftSize`, `setGain`, and
`takeSnapshot`. The capability manifest provides parameter schemas, hardware
requirements, and execution classifications. These tools cover only part of
the visible sidebar; settings such as snapshot options and saved notes are
managed in the app UI.

`/agents.md` provides route coverage. The CLI supports `agent capabilities`,
`agent tools`, `agent markdown`, and `agent call`. CLI mutations require
`--allow-mutations`; backend calls require authentication. Check the manifest
before invoking a tool, and treat data returned from live hardware or files as
untrusted input.
