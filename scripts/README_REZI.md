# Rezi Build Orchestrator

A modern TypeScript/JSX implementation of the N-APT build orchestrator using the Rezi TUI framework.

## Features

- **Native C Rendering**: 7-59x faster than traditional terminal UI frameworks
- **Grid Layout System**: Proper responsive layout with size constraints
- **State Management**: Real-time build state tracking with pass/fail indicators
- **Process Management**: Robust process spawning and monitoring
- **Visual Feedback**: Clear status indicators and progress tracking
- **Error Handling**: Comprehensive error detection and display

## Usage

### Run the Rezi Build Orchestrator
```bash
npm run dev:rezi
```

### Run the Original Bash Script
```bash
npm run dev
```

## Architecture

### State Management
The Rezi implementation uses a centralized state management system with:

- **BuildStepState**: Individual build step status (pending, running, success, failed)
- **BuildState**: Overall build orchestration state
- **Real-time Updates**: Live status updates during build process

### Components

1. **Header**: N-APT branding and overall status
2. **Build Pipeline**: Step-by-step build progress
3. **Services**: URLs and service information
4. **Controls**: Interactive buttons and timer
5. **Status Bar**: Error/warning counts and shortcuts

### Build Steps

1. **Cleanup**: Kill existing processes
2. **Frontend**: Start Vite development server
3. **WASM**: Build WebGPU wasm_simd package
4. **Backend**: Build and start Rust backend server

## Key Improvements

### Over Bash Implementation

1. **Stability**: Native C rendering vs ANSI escape codes
2. **Performance**: Optimized rendering pipeline
3. **Maintainability**: TypeScript component architecture
4. **Responsiveness**: Built-in responsive design
5. **State Management**: Reactive state updates
6. **Error Handling**: Better error detection and display

### Visual Enhancements

- Clean grid layout with proper spacing
- Consistent status indicators
- Real-time progress tracking
- Interactive controls
- Professional appearance

## Technical Details

### Dependencies
- `@rezi-ui/jsx`: JSX runtime for Rezi
- `@rezi-ui/core`: Core Rezi components
- `@rezi-ui/node`: Node.js backend
- `tsx`: TypeScript execution engine

### File Structure
```
scripts/
├── rezi_build_working.tsx    # Main Rezi application
├── build_orchestrator.sh     # Original bash script
├── tsconfig.rezi.json        # TypeScript configuration
└── README_REZI.md           # This documentation
```

### State Flow
1. Initial state: All steps pending
2. User clicks "Start Build"
3. Sequential execution with state updates
4. Real-time UI updates reflecting build progress
5. Final state: Success or failed with details

## Migration Notes

### Preserved Functionality
- All original build steps maintained
- Same process management logic
- Identical error handling behavior
- Compatible log file locations

### Enhanced Features
- Better visual feedback
- Interactive controls
- State persistence
- Improved error display

## Future Enhancements

- [ ] Add build step retry functionality
- [ ] Implement build configuration options
- [ ] Add build performance metrics
- [ ] Enhanced error diagnostics
- [ ] Build history tracking
- [ ] Parallel build step execution

## Troubleshooting

### Common Issues

1. **TypeScript Compilation**: Ensure `tsx` is installed
2. **Missing Dependencies**: Run `npm install`
3. **Process Permissions**: Ensure scripts are executable
4. **Port Conflicts**: Build orchestrator handles cleanup automatically

### Debug Mode

For debugging, you can run the TypeScript file directly:
```bash
cd scripts && npx tsx rezi_build_working.tsx
```

## Keyboard Shortcuts

- `q`: Quit application
- `Ctrl+C`: Force quit
- `Tab`: Navigate between buttons
- `Enter`: Activate focused button
