# Development Workflow

This guide covers the optimized development workflow for N-APT with hot reloading and fast builds.

## Quick Start

### For Development

```bash
npm run dev
```

## Development Scripts

| Command                | Description                                        | Use Case                 |
| ---------------------- | -------------------------------------------------- | ------------------------ |
| `npm run dev`          | **Recommended** - Ink-based dev orchestrator       | Daily development        |
| `npm run server:dev`   | Backend only in dev mode                           | Backend-only work        |
| `npm run server:build` | Build backend without running                      | CI/CD or pre-deployment  |

## Worktree Workflow

Use the worktree utilities when you want isolated branches without duplicating heavy build artifacts.

### Setup and inspect worktrees

```bash
bash scripts/git/setup_worktrees.sh
bash scripts/git/worktree_manager.sh list
bash scripts/git/worktree_manager.sh status
```

### Link shared assets safely

```bash
bash scripts/git/link_shared_worktree_assets.sh
bash scripts/git/link_shared_worktree_assets.sh --status
```

### Useful worktree commands

- **`setup`**: creates the standard worktrees under `../worktrees`
- **`list`**: shows all configured worktrees
- **`status`**: shows the current worktree and branch
- **`clean`**: prunes stale worktrees
- **`goto <branch|path>`**: jumps to a worktree quickly

### Notes

- **Prefer the shared asset linker** instead of manually creating symlinks for `target`, `node_modules`, and Redis data.
- **Let the script handle symlink edge cases** if the repository is inside a worktree or nested path.
- **Use `--status` first** if you’re not sure whether assets are already linked.

## Hot Reloading Features

### Configuration Hot Reload

- Edit `mock_signals.yaml` while server is running
- Changes apply automatically without restart
- Supports signal patterns, strengths, and frequencies

### Manual Reload

Send WebSocket message:

```json
{ "type": "reload_config" }
```

### Configuration File Structure

```yaml
global_settings:
  noise_floor_base: -70.0
  signal_drift_rate: 0.1

signals:
  - id: "fm_radio"
    type: "wide"
    center_freq_mhz: 101.5
    strength: -35.0
    active: true
    description: "FM radio station"
```

## Performance Optimizations

### Build Profiles

- **dev-fast**: Fastest compilation, minimal optimization
- **dev**: Balanced speed and performance
- **release**: Maximum optimization for production

### Incremental Compilation

- Only rebuilds changed components
- Faster subsequent builds
- Smart dependency tracking

## Development Tips

### 1. Use `npm run dev` for most development

- Starts the Ink-based build orchestrator
- Decrypts modules before launch when needed
- Shows real-time build and runtime status

### 2. Edit configuration instead of code when possible

- Change signal patterns in `mock_signals.yaml`
- Test different frequencies without rebuild
- Modify signal strengths in real-time

### 3. Use the appropriate script for your task

- `dev` for the full development workflow
- `server:dev` for backend-only testing

### 4. Hot reload workflow

1. Start with `npm run dev`
2. Edit `mock_signals.yaml`
3. Changes appear immediately in UI
4. No server restart needed

## Troubleshooting

### Hot reload not working

1. Check if `mock_signals.yaml` exists
2. Verify file permissions
3. Check server logs for file watcher errors

### Build performance issues

1. Use `npm run dev` instead of the legacy development commands
2. Ensure sufficient disk space
3. Check if antivirus is interfering

### Configuration errors

1. Validate YAML syntax
2. Check signal frequency ranges
3. Verify signal type definitions

## File Structure

```
n-apt/
├── mock_signals.yaml          # Hot reload configuration
├── start_server.sh            # Server launcher with --dev flag
├── scripts/
│   ├── dev.sh                # Development environment setup
│   └── dev_server.sh         # Original dev server script
├── src/server/main.rs        # Hot reload implementation
└── package.json              # Updated npm scripts
```

## Environment Variables

- `RUST_LOG=info` - Log level (set by start_server.sh)
- `N_APT_PASSKEY` - Encryption key (optional, uses default for dev)

## Next Steps

1. Run `npm run dev` to start development
2. Edit `mock_signals.yaml` to test hot reload
3. Use the new npm scripts for efficient development
4. Check the Performance Guide for optimization details
