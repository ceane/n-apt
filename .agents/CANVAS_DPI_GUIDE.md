# Canvas DPI Scaling Guide for Pretext Integration

## 🎯 Why DPI Scaling Matters

High-DPI displays (Retina, 4K, etc.) have a `devicePixelRatio > 1`, meaning one logical pixel corresponds to multiple physical pixels. Without proper scaling, canvas text and graphics appear blurry or pixelated.

## 🔧 DPI Scaling Implementation

### Core Components Added

1. **`usePretextText` hook enhancement**
   - Added `getDPIScaledMetrics()` method
   - Automatically scales text measurements for current DPI

2. **`canvasDPIScaling.ts` utilities**
   - `setupCanvasForDPI()` - Complete canvas setup for high-DPI
   - `getDPIScaledFontSize()` - Scale font sizes
   - `scaleCoordinatesForDPI()` - Scale coordinates
   - `isHighDPI()` - Detect high-DPI displays
   - `getOptimalTextRenderingSettings()` - Best rendering settings

### Usage Patterns

#### 1. Basic DPI-Aware Canvas Setup

```tsx
import { setupCanvasForDPI } from '@n-apt/utils/canvasDPIScaling';

const canvas = canvasRef.current;
if (canvas) {
  const { ctx, devicePixelRatio, scale } = setupCanvasForDPI(canvas, 800, 400);
  // ctx is already scaled for DPI
  // Use logical coordinates (800x400) - DPI handled automatically
}
```

#### 2. DPI-Scaled Text Measurements

```tsx
const { metrics, getDPIScaledMetrics } = usePretextText({
  text: "Frequency: 101.5 MHz",
  font: '"JetBrains Mono", monospace',
  fontSize: 16,
});

// Logical measurements (CSS pixels)
const logicalWidth = metrics?.width;

// Physical measurements (device pixels)
const physicalMetrics = getDPIScaledMetrics();
const physicalWidth = physicalMetrics?.width;
```

#### 3. High-DPI Detection

```tsx
import { isHighDPI } from '@n-apt/utils/canvasDPIScaling';

if (isHighDPI()) {
  // Use enhanced rendering settings
  const settings = getOptimalTextRenderingSettings();
  ctx.fontSmoothing = settings.fontSmoothing;
  ctx.textRendering = settings.textRendering;
}
```

## 📱 Real-World Examples

### FFTCanvas Integration

```tsx
// In FFTCanvas.tsx
const { getDPIScaledMetrics } = usePretextText({
  text: formatFrequency(centerFreq),
  font: '"JetBrains Mono", monospace',
  fontSize: 12,
});

const draw = useCallback(() => {
  const canvas = canvasRef.current;
  if (!canvas) return;

  // Setup DPI scaling once
  const { ctx, devicePixelRatio } = setupCanvasForDPI(canvas, width, height);
  
  // Use DPI-scaled measurements for precise positioning
  const textMetrics = getDPIScaledMetrics();
  if (textMetrics) {
    ctx.font = `${12 * devicePixelRatio}px "JetBrains Mono", monospace`;
    ctx.fillText(text, x, y);
  }
}, [getDPIScaledMetrics]);
```

### VFO Frequency Display

```tsx
// For real-time frequency updates
const { metrics, getDPIScaledMetrics } = usePretextText({
  text: formatFrequency(frequency),
  font: '"JetBrains Mono", monospace',
  fontSize: 14,
});

// Crisp text on any display
const drawFrequency = useCallback((ctx: CanvasRenderingContext2D) => {
  const dpiMetrics = getDPIScaledMetrics();
  if (dpiMetrics) {
    ctx.font = `${14 * window.devicePixelRatio}px "JetBrains Mono", monospace`;
    ctx.fillText(formattedFrequency, 50, 50);
  }
}, [getDPIScaledMetrics, formattedFrequency]);
```

## 🎨 Best Practices

### 1. Always Setup Canvas for DPI

```tsx
// ✅ Good - DPI-aware setup
const { ctx } = setupCanvasForDPI(canvas, width, height);

// ❌ Bad - ignores DPI
const ctx = canvas.getContext('2d');
```

### 2. Use Logical Coordinates

```tsx
// ✅ Good - logical coordinates
ctx.fillRect(0, 0, 800, 400); // CSS pixels

// ❌ Bad - manual DPI scaling
ctx.fillRect(0, 0, 800 * devicePixelRatio, 400 * devicePixelRatio);
```

### 3. Scale Font Sizes Appropriately

```tsx
// ✅ Good - use DPI-scaled metrics
const dpiMetrics = getDPIScaledMetrics();
ctx.font = `${fontSize * devicePixelRatio}px ${font}`;

// ❌ Bad - ignore DPI in text rendering
ctx.font = `${fontSize}px ${font}`;
```

### 4. Check for High-DPI Displays

```tsx
// ✅ Good - conditional enhancements
if (isHighDPI()) {
  ctx.imageSmoothingQuality = 'high';
  ctx.fontSmoothing = 'antialiased';
}
```

## 🔍 Debugging DPI Issues

### Check Device Pixel Ratio

```tsx
console.log('Device Pixel Ratio:', window.devicePixelRatio);
console.log('Is High DPI:', isHighDPI());
```

### Compare Logical vs Physical

```tsx
const logical = metrics;        // CSS pixels
const physical = getDPIScaledMetrics(); // Device pixels

console.log('Logical width:', logical?.width);
console.log('Physical width:', physical?.width);
console.log('Scale factor:', window.devicePixelRatio);
```

### Visual Test Pattern

```tsx
// Draw test pattern to verify DPI scaling
ctx.strokeStyle = '#00ff00';
ctx.lineWidth = 1;
ctx.strokeRect(0, 0, 100, 100); // Should be crisp on any display

ctx.font = '16px "JetBrains Mono", monospace';
ctx.fillStyle = '#ffff00';
ctx.fillText('Test Text', 10, 50); // Should be sharp on high-DPI
```

## 📊 Performance Considerations

### DPI Scaling Impact

- **Setup Cost**: One-time canvas setup (~1ms)
- **Measurement Cost**: Pretext handles DPI scaling automatically
- **Rendering Cost**: Slightly higher on high-DPI (more pixels)
- **Memory Usage**: Proportional to devicePixelRatio²

### Optimization Tips

1. **Cache DPI setup** - Don't call `setupCanvasForDPI` on every frame
2. **Use logical coordinates** - Let the utility handle scaling
3. **Conditional enhancements** - Only enable high-DPI features when needed
4. **Test on multiple displays** - Verify across different devicePixelRatio values

## 🚀 Migration Checklist

### Existing Canvas Components

- [ ] Replace `canvas.getContext('2d')` with `setupCanvasForDPI()`
- [ ] Update font sizes to use DPI-scaled values
- [ ] Use `getDPIScaledMetrics()` for text measurements
- [ ] Add high-DPI detection for enhanced rendering
- [ ] Test on Retina/4K displays

### New Canvas Components

- [ ] Start with `setupCanvasForDPI()` by default
- [ ] Use `usePretextText` hook with `getDPIScaledMetrics()`
- [ ] Implement high-DPI optimizations
- [ ] Add DPI debugging information during development

## 🎯 Results

With proper DPI scaling:

✅ **Crisp text** on all displays  
✅ **Precise measurements** regardless of DPI  
✅ **Consistent layout** across devices  
✅ **Future-proof** for new high-DPI displays  
✅ **Better user experience** on modern screens  

The pretext integration with DPI scaling ensures your canvas components look professional and sharp on any display! 🚀
