# Tx Settings Layout Relocation, Tooltips, and Keyboard Increments

## Goal
1. Move the rendering of the `Tx Settings` section in [SpectrumSidebar.tsx](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/ts/components/sidebar/SpectrumSidebar.tsx) to be directly beneath the `Channels` component.
2. Ensure the `Tx Settings` section's collapsible container is open by default.
3. Add informative, user-friendly tooltips for all configuration options in the [TxSettingsSection.tsx](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/ts/components/sidebar/TxSettingsSection.tsx) panel.
4. Position the `Safety` Row directly beneath the `Power` Row.
5. Fix power, VGA gain, and hop rate inputs to support increment/decrement modifications using `ArrowUp` and `ArrowDown` keyboard keys.

## Changes Made
- Modified [SpectrumSidebar.tsx](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/ts/components/sidebar/SpectrumSidebar.tsx):
  - Relocated the `<Collapsible>` container that wraps `<TxSettingsSection>` from its original position to be placed immediately beneath `<Channels>`.
  - Updated the `defaultOpen` prop on this `<Collapsible>` component from `false` to `true`.
- Modified [TxSettingsSection.tsx](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/ts/components/sidebar/TxSettingsSection.tsx):
  - Imported the reusable `Tooltip` component from `@n-apt/components/ui`.
  - Configured informative tooltips for the standard `Row` items (`Signal`, `Sample rate`, `Center frequency`, `Power`, `VGA gain`, `TX Amp`, and `Safety`).
  - Added inline `Tooltip` components inside custom Hop headers and fields (`Hop`, `Hop type`, `Hop start`, `Hop end`, `Channels`, and `Hop rate`).
  - Moved the `Safety` row directly beneath the `Power` row in the JSX structure.
  - Implemented keyboard keydown handlers (`handlePowerKeyDown`, `handleVgaGainKeyDown`, `handleHopRateKeyDown`) to increment and decrement input values on `ArrowUp` / `ArrowDown` keys. Attached these handlers to the respective `NumericInput` elements.
- Created [TxSettingsSection.test.tsx](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/test/ts/TxSettingsSection.test.tsx):
  - Wrote Jest unit tests to verify that pressing `ArrowUp` and `ArrowDown` correctly increments and decrements the Power, VGA gain, and Hop rate values.

## Verification & Testing
- Ran TypeScript compilation via `npm run typecheck` to confirm no errors.
- Ran newly created unit tests via `npx jest test/ts/TxSettingsSection.test.tsx` and sidebar tests via `npx jest test/ts/SpectrumSidebar.sampleRate.test.tsx` to verify all passed.
- Ran `npm run format` to keep files clean and aligned with formatting guidelines.
