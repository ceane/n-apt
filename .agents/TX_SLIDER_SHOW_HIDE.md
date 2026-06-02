# Feature: Show/Hide Tx Slider Button in Visualizer Sliders

We implemented a toggle button in the visualizer controls rail to show/hide the Tx Slider overlay.

## Changes Implemented
1. **Redux Store State**:
   - Added `showTxSlider: boolean` to the Redux state in [spectrumSlice.ts](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/ts/redux/slices/spectrumSlice.ts) (defaults to `true`).
   - Added action creator `setShowTxSlider` to toggle this state.
   - Re-exported the new action via `spectrumActions` in [index.ts](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/ts/redux/index.ts).

2. **Visualizer Sliders Control**:
   - Added a new toggle button to [VisualizerSliders.tsx](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/ts/components/VisualizerSliders.tsx).
   - The label dynamically displays **"Hide Tx Slider"** when shown (so clicking hides it) or **"Show Tx Slider"** when hidden (so clicking shows it).
   - Rendered using `Eye` and `EyeOff` icons from `lucide-react` to indicate its visibility state.
   - Bound the button to a new `onShowTxSliderChange` prop.

3. **Wrappers and Main Route Integration**:
   - Connected `showTxSlider` state and dispatcher in the Redux sidebar wrapper [ReduxVisualizerSliders.tsx](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/ts/components/sidebar/ReduxVisualizerSliders.tsx) and the Visualizer component [FFTAndWaterfall.tsx](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/ts/components/FFTAndWaterfall.tsx).
   - Conditionally rendered `<TxSliderOverlay>` inside [SpectrumRoute.tsx](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/ts/routes/SpectrumRoute.tsx) depending on `showTxSlider`.

## Verification Status
- **Typecheck**: `npm run typecheck` passes with `0` errors.
- **Jest Tests**: `npm test` passes all tests.
- **Formatting & Lint**: Formatted with `oxfmt` and verified linting.
