import React from 'react';
import { LocalTowersButton } from "@n-apt/components/LocalTowersButton";

interface LocalTowersResult {
  loaded: number;
  radius: number;
  center: { lat: number; lng: number };
  states: number;
  cached: boolean;
}

export default {
  title: 'Components/LocalTowersButton',
  parameters: {
    layout: 'centered',
  },
};

export const Default = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '40px' }}>
    <LocalTowersButton
      onLocalTowersLoaded={(result: LocalTowersResult) => console.log('Towers loaded:', result)}
    />
  </div>
);

export const InContext = () => (
  <div style={{
    backgroundColor: '#0a0a0a',
    padding: '40px',
    fontFamily: 'JetBrains Mono, monospace'
  }}>
    <div style={{
      backgroundColor: '#1a1a1a',
      padding: '20px',
      borderRadius: '8px',
      border: '1px solid #333'
    }}>
      <h3 style={{ color: '#e0e0e0', margin: '0 0 16px 0' }}>
        Tower Data Management
      </h3>
      <p style={{ color: '#666', margin: '0 0 20px 0', fontSize: '14px' }}>
        Load nearby cell tower data based on your current location
      </p>
      <LocalTowersButton
        onLocalTowersLoaded={(result: LocalTowersResult) => console.log('Towers loaded:', result)}
      />
      <div style={{
        marginTop: '20px',
        padding: '12px',
        backgroundColor: '#0d0d0d',
        borderRadius: '4px',
        border: '1px solid #2a2a2a'
      }}>
        <p style={{ color: '#888', margin: 0, fontSize: '12px' }}>
          📍 Requires location access to find towers within 50km radius
        </p>
      </div>
    </div>
  </div>
);

export const WithResult = () => {
  const [result, setResult] = React.useState<LocalTowersResult | null>(null);

  return (
    <div style={{ backgroundColor: '#0a0a0a', padding: '40px' }}>
      <div style={{
        backgroundColor: '#1a1a1a',
        padding: '20px',
        borderRadius: '8px',
        border: '1px solid #333',
        maxWidth: '400px'
      }}>
        <h3 style={{ color: '#e0e0e0', margin: '0 0 16px 0' }}>
          Local Tower Data
        </h3>
        <LocalTowersButton
          onLocalTowersLoaded={(data: LocalTowersResult) => {
            console.log('Towers loaded:', data);
            setResult(data);
          }}
        />
        {result && (
          <div style={{
            marginTop: '20px',
            padding: '16px',
            backgroundColor: '#0d0d0d',
            borderRadius: '4px',
            border: '1px solid #2a2a2a'
          }}>
            <h4 style={{ color: '#00d4ff', margin: '0 0 12px 0', fontSize: '14px' }}>
              ✅ Tower Data Loaded
            </h4>
            <div style={{ color: '#888', fontSize: '12px', lineHeight: '1.6' }}>
              <div>📡 Towers found: {result.loaded}</div>
              <div>📍 Radius: {result.radius}km</div>
              <div>🗺️  States: {result.states}</div>
              <div>💾 Cached: {result.cached ? 'Yes' : 'No'}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
