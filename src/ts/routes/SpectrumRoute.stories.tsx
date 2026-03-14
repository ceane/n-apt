import ClassificationControls from '../components/ClassificationControls';
import { LadleAppShell } from '../components/ladle/LadleAppShell';

const CanvasPanel = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <div
    style={{
      minHeight: '260px',
      backgroundColor: '#101010',
      border: '1px solid #242424',
      borderRadius: '12px',
      display: 'grid',
      placeItems: 'center',
      color: '#7d7d7d',
      textAlign: 'center',
      padding: '24px',
    }}
  >
    <div style={{ display: 'grid', gap: '8px' }}>
      <div style={{ color: '#00d4ff', fontSize: '16px' }}>{title}</div>
      <div style={{ fontSize: '12px', lineHeight: 1.6 }}>{subtitle}</div>
    </div>
  </div>
);

export default {
  title: 'Routes/SpectrumRoute',
  parameters: {
    layout: 'fullscreen',
  },
};

export const VisualizerTab = () => (
  <LadleAppShell route="/visualizer" title="Spectrum Route">
    <div style={{ display: 'grid', gap: '20px' }}>
      <ClassificationControls
        isDeviceConnected={true}
        activeSignalArea="APT band"
        isCapturing={false}
        captureLabel={null}
        capturedSamples={8192}
        onCaptureStart={() => { }}
        onCaptureStop={() => { }}
      />
      <CanvasPanel title="FFT Canvas Region" subtitle="Visual spectrum area placed inside the same layout, sidebar, theme, and route navigation stack as the app." />
      <CanvasPanel title="FIFO Waterfall Region" subtitle="Scrollable time-frequency view placeholder framed with production shell spacing and hierarchy." />
    </div>
  </LadleAppShell>
);

export const AnalysisTab = () => (
  <LadleAppShell route="/demodulate" title="Spectrum Route / Analysis">
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '20px' }}>
      <CanvasPanel title="Demodulation Tools" subtitle="Route content preview inside the full app chrome." />
      <CanvasPanel title="Feature Extraction" subtitle="Inspect analysis workflow layout without losing the real navigation and sidebar context." />
    </div>
  </LadleAppShell>
);

export const DrawTab = () => (
  <LadleAppShell route="/draw-signal" title="Spectrum Route / Draw">
    <div style={{ display: 'grid', gap: '20px' }}>
      <CanvasPanel title="Signal Drawing Workspace" subtitle="A route-level preview mounted in the same app shell as the live product." />
      <CanvasPanel title="Waveform Parameters" subtitle="Frequency, amplitude, and phase controls sit in the content region while the real sidebar remains available." />
    </div>
  </LadleAppShell>
);
