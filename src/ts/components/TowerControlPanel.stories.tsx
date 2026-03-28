import { TowerControlPanel } from "@n-apt/components/TowerControlPanel";

export default {
  title: 'Components/TowerControlPanel',
  parameters: {
    layout: 'centered',
  },
};

export const Default = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '40px' }}>
    <TowerControlPanel
      truncated={false}
      totalFound={null}
      currentCount={1247}
      towersLoading={false}
      towersError={null}
    />
  </div>
);

export const Loading = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '40px' }}>
    <TowerControlPanel
      truncated={false}
      totalFound={null}
      currentCount={0}
      towersLoading={true}
      towersError={null}
    />
  </div>
);

export const TruncatedResults = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '40px' }}>
    <TowerControlPanel
      truncated={true}
      totalFound={15420}
      currentCount={1247}
      towersLoading={false}
      towersError={null}
    />
  </div>
);

export const WithError = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '40px' }}>
    <TowerControlPanel
      truncated={false}
      totalFound={null}
      currentCount={0}
      towersLoading={false}
      towersError="Failed to connect to tower database"
    />
  </div>
);

export const HighCount = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '40px' }}>
    <TowerControlPanel
      truncated={true}
      totalFound={48923}
      currentCount={8234}
      towersLoading={false}
      towersError={null}
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
      border: '1px solid #333',
      width: '280px'
    }}>
      <h3 style={{ color: '#e0e0e0', margin: '0 0 16px 0', fontSize: '14px' }}>
        🗺️ Tower Map Status
      </h3>
      <TowerControlPanel
        truncated={true}
        totalFound={15420}
        currentCount={1247}
        towersLoading={false}
        towersError={null}
      />
      <div style={{
        marginTop: '20px',
        padding: '12px',
        backgroundColor: '#0d0d0d',
        borderRadius: '4px',
        border: '1px solid #2a2a2a'
      }}>
        <p style={{ color: '#888', margin: 0, fontSize: '12px' }}>
          📡 Showing cell towers within current map view
        </p>
      </div>
    </div>
  </div>
);
