# Partial n-apt Onboarding Prompt

Copy this prompt into a new coding-agent session when the agent needs a fast,
partial understanding of this repository before making a scoped change.

```text
You are onboarding to the n-apt repository, an SDR spectrum-analyzer and
signal-visualization application. Build a partial mental model first; do not
modify files during onboarding unless the user separately asks for a change.

## Start here

1. Read `.agents/AGENTS.md` and `.agents/SECURITY.md`.
2. Read `README.md` only for the product vocabulary and broad feature scope;
   do not treat its narrative claims as implementation evidence.
3. Inspect `package.json`, `Cargo.toml`, `vite.config.js`, `tsconfig.json`,
   `scripts/build/`, and the current Git status.
4. Follow this reading order:

   - `src/ts/root.tsx` and the route/app-shell files under `src/ts/app/`
   - `src/ts/redux/store.ts`, the Redux slices, and
     `src/ts/redux/middleware/websocketMiddleware.ts`
   - `src/ts/validation/schemas.ts` and
     `src/ts/consts/schemas/websocket.ts`
   - `src/ts/app/routes/pages/SpectrumRoute.tsx`,
     `src/ts/features/spectrum/FFTCanvas.tsx`, and the waterfall components
   - `src/rs/server/main_bin.rs`, `src/rs/server/main.rs`,
     `src/rs/app/bootstrap.rs`, and `src/rs/app/router.rs`
   - `src/rs/server/types.rs`, `src/rs/server/websocket_server/`,
     `src/rs/server/stream_manager.rs`, and `src/rs/streaming/`
   - `src/rs/sdr/`, `src/rs/acquisition/`, and `src/rs/s/fft/`
   - `src/rs/lib.rs`, `scripts/build/build_wasm.sh`, and
     `packages/n_apt_canvas/` only when the task involves WASM or WebGPU

## Trace one vertical path

Explain the actual lifecycle, with file and symbol references, for:

`process startup → frontend authentication → `/ws` and `/ws/streams` →
`source_info` inventory/active-source handoff → source selection → I/Q or
spectrum frame transport → Redux state → FFT/waterfall presentation`.

Also identify where the following are owned:

- source selection intent versus backend-confirmed active source;
- WebSocket message validation and protocol/version ordering;
- live/paused/standby/transmitting presentation state;
- hardware acquisition versus display-rate frame dropping;
- FFT, resampling, mirroring, and WebGPU/WASM work;
- authentication, sessions, Redis readiness, and HTTP routes.

## Produce a short onboarding memo

Return:

1. a five-to-eight-step guided reading order;
2. the key runtime boundaries and data contracts;
3. the smallest relevant test locations for a future change;
4. three to five risks or invariants an implementer must preserve;
5. open questions and areas not inspected.

Label each statement as one of `verified in code`, `verified by focused test`,
or `inference`. Do not claim browser, live-backend, physical-device, or
hardware validation unless it was actually performed and recorded separately.

## Project guardrails

- Preserve unrelated dirty-worktree changes. Inspect `git status` and diffs
  before proposing edits.
- Do not start or restart the development server for ordinary code changes.
- Do not run `npm run build`; use focused checks. Run `npm run typecheck` after
  TypeScript changes and `cargo check` after Rust changes.
- Do not add logging to RTL-SDR/HackRF callbacks, sample I/O, acquisition,
  restart/cleanup/drop, or Tx paths. Keep global Tx logging disabled.
- Never commit, upload, decrypt, or expose I/Q captures, credentials, or
  private environment values. Prefer synthetic fixtures.
- Treat `source_info` as the authoritative active-source/inventory boundary;
  `/ws` and `/ws/streams` have distinct responsibilities.
- If the task concerns signal processing, IQ capture, FFT, demodulation,
  `/learn`, or the signals CLI, read `.agents/signals/SKILL.md` before going
  deeper.

## Deliberate partial scope

Do not deeply inspect `src/app-article/`, `src/app-game/`, legal pages, tower
data/Redis tooling, encrypted modules, or unrelated scripts unless the task
reaches one of those areas. Say explicitly when the onboarding stops at one of
those boundaries.
```

This is intentionally a partial onboarding prompt, not a complete architecture
catalog. It prioritizes the live application path and the contracts most likely
to matter for frontend, backend, transport, spectrum, and device-lifecycle
work.
