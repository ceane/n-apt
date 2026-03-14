import { ConnectionStatusSection } from './ConnectionStatusSection';

export default {
  title: 'Sidebar/ConnectionStatusSection',
  parameters: {
    layout: 'padded',
  },
};

export const Connected = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '20px', width: '350px' }}>
    <ConnectionStatusSection
      isConnected={true}
      deviceState="connected"
      deviceLoadingReason={null}
      isPaused={false}
      cryptoCorrupted={false}
      onPauseToggle={() => console.log('Pause toggled')}
    />
  </div>
);

export const Disconnected = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '20px', width: '350px' }}>
    <ConnectionStatusSection
      isConnected={false}
      deviceState="disconnected"
      deviceLoadingReason={null}
      isPaused={false}
      cryptoCorrupted={false}
      onPauseToggle={() => console.log('Pause toggled')}
    />
  </div>
);

export const ServerConnectedDeviceNotConnected = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '20px', width: '350px' }}>
    <ConnectionStatusSection
      isConnected={true}
      deviceState="disconnected"
      deviceLoadingReason={null}
      isPaused={false}
      cryptoCorrupted={false}
      onPauseToggle={() => console.log('Pause toggled')}
    />
  </div>
);

export const Loading = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '20px', width: '350px' }}>
    <ConnectionStatusSection
      isConnected={true}
      deviceState="loading"
      deviceLoadingReason="connect"
      isPaused={false}
      cryptoCorrupted={false}
      onPauseToggle={() => console.log('Pause toggled')}
    />
  </div>
);

export const Stale = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '20px', width: '350px' }}>
    <ConnectionStatusSection
      isConnected={true}
      deviceState="stale"
      deviceLoadingReason={null}
      isPaused={false}
      cryptoCorrupted={false}
      onPauseToggle={() => console.log('Pause toggled')}
    />
  </div>
);

export const Paused = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '20px', width: '350px' }}>
    <ConnectionStatusSection
      isConnected={true}
      deviceState="connected"
      deviceLoadingReason={null}
      isPaused={true}
      cryptoCorrupted={false}
      onPauseToggle={() => console.log('Pause toggled')}
    />
  </div>
);

export const WithRestartButton = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '20px', width: '350px' }}>
    <ConnectionStatusSection
      isConnected={true}
      deviceState="stale"
      deviceLoadingReason={null}
      isPaused={false}
      cryptoCorrupted={false}
      onPauseToggle={() => console.log('Pause toggled')}
      onRestartDevice={() => console.log('Restart device')}
    />
  </div>
);

export const Restarting = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '20px', width: '350px' }}>
    <ConnectionStatusSection
      isConnected={true}
      deviceState="loading"
      deviceLoadingReason="restart"
      isPaused={false}
      cryptoCorrupted={false}
      onPauseToggle={() => console.log('Pause toggled')}
      onRestartDevice={() => console.log('Restart device')}
    />
  </div>
);

export const CryptoCorrupted = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '20px', width: '350px' }}>
    <ConnectionStatusSection
      isConnected={true}
      deviceState="connected"
      deviceLoadingReason={null}
      isPaused={false}
      cryptoCorrupted={true}
      onPauseToggle={() => console.log('Pause toggled')}
      onRestartDevice={() => console.log('Restart device')}
    />
  </div>
);

export const HidePauseButton = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '20px', width: '350px' }}>
    <ConnectionStatusSection
      isConnected={true}
      deviceState="connected"
      deviceLoadingReason={null}
      isPaused={false}
      cryptoCorrupted={false}
      onPauseToggle={() => console.log('Pause toggled')}
      hidePauseButton={true}
    />
  </div>
);
