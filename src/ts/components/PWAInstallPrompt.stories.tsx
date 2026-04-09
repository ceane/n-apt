import React from 'react';

export default {
  title: 'Components/PWAInstallPrompt',
  parameters: {
    layout: 'centered',
  },
};

// Mock the beforeinstallprompt event for Ladle
const mockBeforeInstallPrompt = () => {
  const mockEvent = new Event('beforeinstallprompt') as any;
  mockEvent.platforms = ['web'];
  mockEvent.userChoice = Promise.resolve({ outcome: 'accepted' as const, platform: 'web' });
  mockEvent.prompt = () => Promise.resolve();
  window.dispatchEvent(mockEvent);
};

export const Default = () => {
  React.useEffect(() => {
    mockBeforeInstallPrompt();
  }, []);

  return (
    <div style={{ position: 'relative', height: '400px', backgroundColor: '#0a0a0a' }}>
      <div style={{
        position: 'absolute',
        inset: '20px',
        border: '1px dashed #333',
        borderRadius: '12px',
        color: '#999',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '14px',
      }}>
        PWA Install Prompt placeholder
      </div>
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        color: '#666',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '14px'
      }}>
        Main application content area
      </div>
    </div>
  );
};

export const WithContent = () => {
  React.useEffect(() => {
    mockBeforeInstallPrompt();
  }, []);

  return (
    <div style={{ position: 'relative', height: '600px', backgroundColor: '#0a0a0a' }}>
      <div style={{ padding: '40px', color: '#e0e0e0' }}>
        <h1 style={{ margin: '0 0 20px 0' }}>N-APT Signal Analysis</h1>
        <p style={{ margin: '0 0 20px 0', opacity: 0.8 }}>
          This is where your main application content would appear.
          The PWA install prompt will appear in the bottom-right corner.
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '20px',
          marginTop: '40px'
        }}>
          {[1, 2, 3].map(i => (
            <div
              key={i}
              style={{
                backgroundColor: '#1a1a1a',
                padding: '20px',
                borderRadius: '8px',
                border: '1px solid #333'
              }}
            >
              <h3 style={{ margin: '0 0 10px 0', color: '#00d4ff' }}>
                Signal {i}
              </h3>
              <p style={{ margin: 0, fontSize: '12px', opacity: 0.7 }}>
                Frequency: {100 + i * 50} MHz
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
