# Non-TTY Build Process and Notifications

We have added support to the build orchestrator (`scripts/build/build-orchestrator.tsx`) to perform build steps and send OS-level notifications when the script is run in non-TTY (non-interactive) environments.

## Notification Events

1. **Build Started**:
   - Triggers immediately when the orchestrator starts in non-TTY mode.
   - Message: `N-APT / Staring build...`

2. **Almost Done (Rust backend build)**:
   - Triggers when the orchestrator reaches the composite Rust backend compilation step.
   - Message: `N-APT, Almost done building...`

3. **Build Success**:
   - Triggers when all build steps complete successfully.
   - Message: `✓ Finished building and running at http://localhost:5173`

4. **Build Errors**:
   - Triggers when any build step fails, identifying the specific errored components.
   - Message structure:
     - For single component error: `N-APT / Failed to build, error with [Component]`
     - For multiple component errors: `N-APT / Failed to build, errors with [Component1] and [Component2]`
   - Mapped Components:
     - **Rust**: Steps 1 and 7
     - **signals.yaml**: Step 2
     - **Redis**: Steps 3 and 4
     - **WASM**: Step 5
     - **N-APT Encrypted Modules**: Step 6
     - **Typescript**: Step 8
