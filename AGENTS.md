## Token Efficiency

- DO NOT RERUN THE DEV SERVER!
- Never re-read files you just wrote or edited. You know the contents.
- Never re-run commands to "verify" unless the outcome was uncertain.
- Don't echo back large blocks of code or file contents unless asked.
- Batch related edits into single operations. Don't make 5 edits when 1 handles it.
- Skip confirmations like "I'll continue..." Lust do it.
- If a task needs 1 tool call, don't use 3. Plan before acting.
- Do not summarize what you just did unless the result is ambiguous or you need additional input.

## N-apt Server Configuration

The project has multiple server configurations:

### Main Application Server
- **Start**: `npm run dev` (runs decrypt-modules-if-needed and build_orchestrator)
- **Development**: `npm run server:dev`
- **Build-only**: `npm run server:build`
- Full-stack with backend integration

### Markdown Preview Server (Separate)
- **Start**: `npm run dev:markdown`
- **Config**: `vite.markdown.config.ts`
- **Port**: 5174
- **Purpose**: Markdown preview functionality
- **Note**: This is a separate server from the main application

### Other Key Commands
- **Lint (TS/JS)**: `npm run lint`
- **Lint & Fix Rust**: `npm run lint:fix:rust`
- **Test TypeScript**: `npm run test`
- **Test Rust**: `npm run test:rust`
- **Test WASM**: `npm run test:wasm`
- **Login password**: `n-apt-dev-key`
