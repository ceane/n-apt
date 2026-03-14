import ClassificationControls from './ClassificationControls';
import { LadleAppShell } from './ladle/LadleAppShell';

const Panel = ({ title, copy }: { title: string; copy: string }) => (
  <div
    style={{
      backgroundColor: '#111',
      border: '1px solid #262626',
      borderRadius: '10px',
      padding: '20px',
      display: 'grid',
      gap: '10px',
    }}
  >
    <div style={{ color: '#00d4ff', fontSize: '15px' }}>{title}</div>
    <div style={{ color: '#8a8a8a', fontSize: '12px', lineHeight: 1.6 }}>{copy}</div>
  </div>
);

export default {
  title: 'Layout/MainLayout',
  parameters: {
    layout: 'fullscreen',
  },
};

export const SpectrumRoute = () => (
  <LadleAppShell route="/visualizer" title="Spectrum Visualizer">
    <div style={{ display: 'grid', gap: '20px' }}>
      <ClassificationControls
        isDeviceConnected={true}
        activeSignalArea="Area 1: 137.10 MHz"
        isCapturing={false}
        captureLabel={null}
        capturedSamples={1280}
        onCaptureStart={() => { }}
        onCaptureStop={() => { }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '20px' }}>
        <Panel title="FFT / Waterfall Region" copy="Primary visualization area rendered inside the real app layout, with the actual route sidebar and navigation shell around it." />
        <Panel title="Device Summary" copy="Sample rate 2.4 MS/s, tuned to a live RTL-SDR profile with app theme, router navigation, and sidebar controls active." />
      </div>
    </div>
  </LadleAppShell>
);

export const AnalysisRoute = () => (
  <LadleAppShell route="/demodulate" title="Signal Analysis">
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '20px' }}>
      <Panel title="Demodulation" copy="Analysis route content in the same shell as production navigation." />
      <Panel title="Classifier" copy="Review signal clusters, extracted features, and capture labeling workflow." />
      <Panel title="Playback" copy="Space reserved for replay and offline inspection tools." />
    </div>
  </LadleAppShell>
);

export const DrawSignalRoute = () => (
  <LadleAppShell route="/draw-signal" title="Draw Signal">
    <div style={{ display: 'grid', gap: '20px' }}>
      <Panel title="Waveform Workspace" copy="Use this story to review the draw-signal screen framing within the real route layout." />
      <Panel title="Math / Parameters" copy="The left shell remains the same app sidebar structure while the main region shows route-focused content." />
    </div>
  </LadleAppShell>
);

export const Model3DRoute = () => (
  <LadleAppShell route="/3d-model" title="3D Model">
    <Panel title="3D Human Model" copy="This route preview keeps the real navigation chrome so layout spacing and hierarchy match the application." />
  </LadleAppShell>
);

export const MapEndpointsRoute = () => (
  <LadleAppShell route="/map-endpoints" title="Map Endpoints">
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
      <Panel title="Map Canvas" copy="Map viewport placeholder inside the production shell." />
      <Panel title="Location Details" copy="Endpoint metadata, cell tower details, and nearby context can be reviewed here." />
    </div>
  </LadleAppShell>
);

export const StitchTestRoute = () => (
  <LadleAppShell route="/stitch-test" title="Stitch Test">
    <Panel title="Capture Stitching" copy="A shell-level preview for the SDR stitch workflow within the actual app layout." />
  </LadleAppShell>
);

export const CollapsedSidebar = () => (
  <LadleAppShell route="/visualizer" title="Collapsed Sidebar Interaction">
    <Panel title="Sidebar Toggle" copy="Use the built-in MainLayout sidebar toggle button to collapse and reopen the app navigation in this integrated shell story." />
  </LadleAppShell>
);
