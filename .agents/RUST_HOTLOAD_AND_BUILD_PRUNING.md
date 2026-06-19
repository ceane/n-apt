# Rust Hotload and Build Pruning Summary

We have fixed the lack of Rust backend hot reloading and the excessive build garbage accumulation.

## Key Actions Taken

1. **Profile Alignment**: Updated all check and validation commands (including in TTY and Non-TTY scripts) to build with `--profile dev-fast` instead of default debug. This avoids building the project twice (once for debug and once for dev-fast), saving ~3.6GB in the `target` folder.
2. **Incremental Build Pruning**: Implemented `pruneIncrementalCache()`. Before any Rust build or rebuild, it automatically lists subdirectories in `target/dev-fast/incremental` and `target/debug/incremental`, sorts them by modification time, and removes all but the 5 most recent directories to prevent unbounded cache growth.
3. **Rust Hotload filesystem watcher**: Configured an `fs.watch` recursive watcher on `src/rs` within the orchestrator. When `.rs` or `Cargo.toml` files are changed, it debounces (300ms) and rebuilds/restarts the Rust server. In case of syntax/compilation errors, the previous running instance of the backend is kept alive and warning/error details are clearly displayed in the dashboard, preventing developer friction.
4. **UI Rebuild Notifications**: Added `.rebuild_status.json` write events to the build orchestrator. Added a custom `/rebuild-status` endpoint in the Vite dev server ([vite.config.js](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/vite.config.js)) and a custom React hook ([useRustRebuildStatus.ts](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/ts/hooks/useRustRebuildStatus.ts)) in the frontend. This polls the status and dispatches live warnings and completion/failure notifications to the user interface.
5. **Vite Proxy & Crash Recovery**:
   - Added an error handler to the `/ws` proxy rule in [vite.config.js](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/vite.config.js) to catch and gracefully destroy socket connections during backend rebuild/restart periods, preventing the dev server from crashing with `AggregateError [ECONNREFUSED]`.
   - Added an auto-restart listener in [build-orchestrator.tsx](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/scripts/build/build-orchestrator.tsx) that automatically restarts the Rust backend after 1s if it exits unexpectedly (excluding intentional hot reload terminations or full program shutdowns).
