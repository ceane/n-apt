# N-APT Development Guide

Guidance for AI coding agents working on the N-APT RF spectrum analyzer. Keep
feature notes and implementation summaries in `.agents/`.

For signal-processing, IQ-capture, FFT, demodulation, `/learn`, or signals CLI
work, load `.agents/signals/SKILL.md`. It defines the project's plain-language
terminology, current demod modes, evidence standards, and RX-only safety rules.

## Working Rules

- The user normally has the dev server running. Do not start or restart it for
  ordinary changes; Vite and Rust hot reload are enabled.
- Do not run `npm run build`; run `npm run build:markdown` only for markdown
  article changes.
- Do not use browser automation for testing. If frontend testing is necessary,
  use `http://localhost:5173`; `127.0.0.1` is blocked.
- Prefer inspecting code and focused tests over repeating broad verification.
- Use the Act MCP tool for repository searches.
- Do not add unrequested design changes or features.
- Add regression tests for bugs and run `npm run typecheck` after TypeScript
  changes. Run `cargo check` after Rust changes.
- Do not preserve backwards compatibility.
- Keep changes scoped, avoid scratch files, and keep the workspace clean.

## Mock APT SDR Rules

- Preserve the established Mock APT waveform checksum unless intentionally
  updating the baseline.
- Do not introduce frame gaps, continuity changes, or generator restarts/reseeds
  without an explicit checksum and continuity test review.
- For hot-path Mock APT changes, run the relevant Rust checks and compare the
  seeded checksum before and after.

## I/Q Captures and Privacy

- Never add I/Q capture data to Git. This includes `.napt, .iq, .wav`, and
  related extensions such as `.c64`. Keep captures local or in
  external storage; version only metadata, manifests, and synthetic fixtures.
- Treat every I/Q capture as potentially sensitive: it may reveal information
  about the recording environment, and some signals may contain exceptionally
  sensitive or otherwise private information.
- Treat N-APT captures as the greatest privacy risk in this project. Minimize
  copying and exposure, and never share, upload, or commit them without the
  user's explicit authorization.
## Temporary and Test Files

- Do not create unnecessary temporary or test files.
- Name temporary files, mockups, and experimental scripts with `temp_`, `tmp_`,
  `test_`, or `fix_`, or use a `.diff` suffix so they remain easy to identify
  and exclude.
- Raw capture files are ignored by `.gitignore`; do not force-add them.

## Documentation

- Put feature documentation, work summaries, and session notes in `.agents/`.
- Keep the regression manifest as the source of truth for labels and thresholds;
  never infer labels from capture filenames at runtime.

## Project Overview

- Frontend: React 19, TypeScript, Vite, styled-components.
- Backend: Rust/Axum WebSocket server with Tokio.
- WASM: Rust FFT processing.
- Rendering: custom FFT and waterfall renderers, including WebGPU paths.

## Common Commands

```bash
# Development
npm run dev
npm run dev:markdown

# Frontend checks
npm run typecheck
npm run lint
npm test
npm run test:wasm

# Rust checks
cargo check
cargo test
cargo fmt --check
```

Use focused test paths or test-name filters when possible. Do not run a full
build merely to validate a local edit.

## Code Style

### TypeScript and React

- Use strict TypeScript; prefer `unknown` over `any`.
- In tests, import `act` from `@testing-library/react`; do not use `react-dom/test-utils`.
- Use `camelCase` for variables/functions, `PascalCase` for types/components,
  and `UPPER_SNAKE_CASE` for constants.
- Keep hook dependency arrays correct and use `useCallback` when passing stable
  callbacks to children.
- Use styled-components; do not use `React.CSSProperties` or the `style` prop.
- Use scoped imports such as `@n-apt/...` and keep Jest module mappings aligned
  with Vite aliases.

### Rust

- Use Rust 2021 conventions, `snake_case` variables/functions, and
  `SCREAMING_SNAKE_CASE` constants.
- Prefer `anyhow` and `?` for error propagation; avoid `unwrap()` in production.
- Format Rust before committing and run `cargo check` after Rust edits.

## Runtime and Environment

- Node uses ES modules and TypeScript strict mode.
- The main app runs on port 5173. The markdown preview runs on port 5174.
- The login password is `UNSAFE_LOCAL_USER_PASSWORD` in `.env.local`; do not
  print or commit secrets.
- Rust logs, both output and errors, are in `/tmp/rust_log.txt`; Tx logs are in `/tmp/n-apt/tx_log.txt`.

## Repository Conventions

- Use `@n-apt/*` for scoped imports.
- When adding Vite aliases for static assets, update Jest `moduleNameMapper` so
  tests resolve them through the shared file mock instead of parsing raw assets.

## Learned User Preferences

- Prefer frontend DSP for demodulation so audio/processing changes can be inspected and listened to in real time on the demod route.
- Treat `liveSourceLifecycle` as the source of truth for live placeholder and stream lifecycle; FFT/waterfall canvases should only render those states.
- When the backend is down or killed, show Server Down / unavailable — not an indefinite Loading FFT state or optimistic Loading flashes from polling.
- Do not auto-start Tx when opening a Tx device into standby; standby is announce-only until the user explicitly starts transmit.
- Keep build/hot-reload orchestration under `scripts/build`; leave in-app hot-reload notifications in the app code.

## Learned Workspace Facts

- Never lower the hardware sample rate below 3.2 MHz (N-APT Nyquist needs that width); narrower modes such as FM use a bandwidth slice/window inside that sample rate.
- Span bandwidth is a selected slice within the sample-rate window, not the same thing as sample rate.
- The available spectrum display range is 0 Hz to 30 GHz; center/span padding and clamps must respect those bounds (including sample_rate/2 from center).
- Agent guidance and related docs live under `.agents/` (including `.agents/AGENTS.md`).
- HackRF One needs LNA/VGA/AMP gain plus baseband bandwidth-filter control, with persistence/control parity similar to other radio gain settings.
- Avoid eagerly loading heavy `/transformers` / transformers.js paths on app startup; they can hang localhost load and should stay excluded or lazy-loaded.
