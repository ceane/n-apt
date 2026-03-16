import { LadleAppShell } from '../components/ladle/LadleAppShell';

const MapPlaceholder = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <div
    style={{
      height: '400px',
      backgroundColor: '#1a1a1a',
      border: '1px solid #333',
      borderRadius: '12px',
      display: 'grid',
      placeItems: 'center',
      color: '#888',
      textAlign: 'center',
      padding: '24px',
    }}
  >
    <div style={{ display: 'grid', gap: '12px' }}>
      <div style={{ color: '#00d4ff', fontSize: '18px' }}>{title}</div>
      <div style={{ fontSize: '14px', lineHeight: 1.6 }}>{subtitle}</div>
      <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
        Map functionality will be rendered here with the real Google Maps integration.
      </div>
    </div>
  </div>
);

export default {
  title: 'Routes/MapEndpointsRoute',
  parameters: {
    layout: 'fullscreen',
  },
};

export const MapEndpoints = () => (
  <LadleAppShell route="/map-endpoints" title="Map Endpoints Route">
    <div style={{ display: 'grid', gap: '20px' }}>
      <MapPlaceholder 
        title="Cell Tower Map" 
        subtitle="Interactive Google Maps view showing cell tower locations with filtering by technology and carrier." 
      />
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
        gap: '16px',
        padding: '20px',
        backgroundColor: '#0f0f0f',
        borderRadius: '8px',
        border: '1px solid #333'
      }}>
        <div>
          <div style={{ color: '#00d4ff', fontSize: '12px', marginBottom: '8px' }}>Technology Filters</div>
          <div style={{ color: '#888', fontSize: '11px' }}>LTE, 5G, 3G, 2G</div>
        </div>
        <div>
          <div style={{ color: '#00d4ff', fontSize: '12px', marginBottom: '8px' }}>Carrier Selection</div>
          <div style={{ color: '#888', fontSize: '11px' }}>T-Mobile, AT&T, Verizon, Custom</div>
        </div>
        <div>
          <div style={{ color: '#00d4ff', fontSize: '12px', marginBottom: '8px' }}>Tower Data</div>
          <div style={{ color: '#888', fontSize: '11px' }}>Real-time API integration</div>
        </div>
      </div>
    </div>
  </LadleAppShell>
);
