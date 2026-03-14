import ClassificationControls from './ClassificationControls';

export default {
  title: 'Components/ClassificationControls',
  parameters: {
    layout: 'fullscreen',
  },
};

const StoryFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      minHeight: '100vh',
      padding: '80px 40px',
      background: '#050507',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <div
      style={{
        width: 640,
        borderRadius: 18,
        border: '1px solid rgba(255,255,255,0.08)',
        background: '#0b0b0f',
        padding: '40px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
      }}
    >
      {children}
    </div>
  </div>
);

const sharedProps = {
  onCaptureStart: (label: string) => console.log('Start capture:', label),
  onCaptureStop: () => console.log('Stop capture'),
};

export const Disconnected = () => (
  <StoryFrame>
    <ClassificationControls
      isDeviceConnected={false}
      activeSignalArea="No device"
      isCapturing={false}
      captureLabel={null}
      capturedSamples={0}
      {...sharedProps}
    />
  </StoryFrame>
);

export const ConnectedIdle = () => (
  <StoryFrame>
    <ClassificationControls
      isDeviceConnected={true}
      activeSignalArea="Area 1: 100-200MHz"
      isCapturing={false}
      captureLabel={null}
      capturedSamples={1250}
      {...sharedProps}
    />
  </StoryFrame>
);

export const CapturingTarget = () => (
  <StoryFrame>
    <ClassificationControls
      isDeviceConnected={true}
      activeSignalArea="Area 2: 200-300MHz"
      isCapturing={true}
      captureLabel="target"
      capturedSamples={3420}
      {...sharedProps}
    />
  </StoryFrame>
);

export const CapturingNoise = () => (
  <StoryFrame>
    <ClassificationControls
      isDeviceConnected={true}
      activeSignalArea="Area 3: 300-400MHz"
      isCapturing={true}
      captureLabel="noise"
      capturedSamples={2156}
      {...sharedProps}
    />
  </StoryFrame>
);

export const HighSampleCount = () => (
  <StoryFrame>
    <ClassificationControls
      isDeviceConnected={true}
      activeSignalArea="Area 4: 400-500MHz"
      isCapturing={false}
      captureLabel={null}
      capturedSamples={15420}
      {...sharedProps}
    />
  </StoryFrame>
);
