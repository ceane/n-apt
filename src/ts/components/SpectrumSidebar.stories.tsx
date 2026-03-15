import React from 'react';

// Mock providers and hooks
const MockSpectrumProvider = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: '360px', height: '100vh' }}>
    {children}
  </div>
);

export default {
  title: 'Sidebar/SpectrumSidebar',
  parameters: {
    layout: 'centered',
  },
};

export const Default = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '20px' }}>
    <MockSpectrumProvider>
      <div style={{
        width: '360px',
        height: '600px',
        backgroundColor: '#0d0d0d',
        border: '1px solid #1a1a1a',
        borderRadius: '8px',
        overflow: 'auto'
      }}>
        <div style={{ padding: '16px', color: '#666', fontSize: '12px', textAlign: 'center' }}>
          <div style={{ marginBottom: '20px' }}>📡 Spectrum Analyzer Controls</div>
          <div style={{ textAlign: 'left', lineHeight: '1.6' }}>
            <div style={{ marginBottom: '12px' }}>
              <strong style={{ color: '#00d4ff' }}>Source Settings</strong>
              <div style={{ marginLeft: '12px', marginTop: '4px' }}>
                • Device: RTL-SDR<br />
                • Frequency: 433.0 MHz<br />
                • Sample Rate: 2.4 MHz<br />
                • Gain: Auto
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <strong style={{ color: '#00d4ff' }}>Display Controls</strong>
              <div style={{ marginLeft: '12px', marginTop: '4px' }}>
                • Zoom: 1.0x<br />
                • FFT Size: 1024<br />
                • Frame Rate: 30 fps
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <strong style={{ color: '#00d4ff' }}>Signal Processing</strong>
              <div style={{ marginLeft: '12px', marginTop: '4px' }}>
                • Window: Hann<br />
                • Average: 8 frames<br />
                • Power Scale: dB
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <strong style={{ color: '#00cc66' }}>Status</strong>
              <div style={{ marginLeft: '12px', marginTop: '4px' }}>
                ● Connected<br />
                ● Streaming<br />
                ● 2.4 MS/s
              </div>
            </div>
          </div>
        </div>
      </div>
    </MockSpectrumProvider>
  </div>
);

export const WithControls = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '20px' }}>
    <MockSpectrumProvider>
      <div style={{
        width: '360px',
        height: '700px',
        backgroundColor: '#0d0d0d',
        border: '1px solid #1a1a1a',
        borderRadius: '8px',
        overflow: 'auto'
      }}>
        <div style={{ padding: '16px' }}>
          <div style={{
            color: '#00d4ff',
            fontSize: '14px',
            fontWeight: '600',
            marginBottom: '16px',
            textAlign: 'center'
          }}>
            📊 Spectrum Analyzer
          </div>

          {/* Mock frequency range slider */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ color: '#888', fontSize: '11px', marginBottom: '8px' }}>
              Frequency Range
            </div>
            <div style={{
              backgroundColor: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '4px',
              padding: '8px',
              color: '#e0e0e0',
              fontSize: '12px'
            }}>
              433.0 - 435.0 MHz
            </div>
          </div>

          {/* Mock controls */}
          {[
            { label: 'Zoom Level', value: '1.0x', color: '#00d4ff' },
            { label: 'FFT Size', value: '1024', color: '#00d4ff' },
            { label: 'Window', value: 'Hann', color: '#00d4ff' },
            { label: 'Average', value: '8 frames', color: '#00d4ff' }
          ].map((control) => (
            <div key={control.label} style={{ marginBottom: '16px' }}>
              <div style={{ color: '#888', fontSize: '11px', marginBottom: '6px' }}>
                {control.label}
              </div>
              <div style={{
                backgroundColor: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: '4px',
                padding: '8px',
                color: control.color,
                fontSize: '12px',
                fontFamily: 'JetBrains Mono, monospace'
              }}>
                {control.value}
              </div>
            </div>
          ))}

          {/* Mock status */}
          <div style={{
            backgroundColor: '#0a0a0a',
            border: '1px solid #2a2a2a',
            borderRadius: '4px',
            padding: '12px',
            marginTop: '20px'
          }}>
            <div style={{ color: '#00cc66', fontSize: '11px', marginBottom: '8px' }}>
              ● Device Status
            </div>
            <div style={{ color: '#888', fontSize: '10px', lineHeight: '1.4' }}>
              RTL-SDR v3 connected<br />
              Streaming at 2.4 MS/s<br />
              CPU: 12% | Memory: 45%
            </div>
          </div>
        </div>
      </div>
    </MockSpectrumProvider>
  </div>
);

export const Compact = () => (
  <div style={{ backgroundColor: '#0a0a0a', padding: '20px' }}>
    <MockSpectrumProvider>
      <div style={{
        width: '280px',
        height: '500px',
        backgroundColor: '#0d0d0d',
        border: '1px solid #1a1a1a',
        borderRadius: '8px',
        overflow: 'auto'
      }}>
        <div style={{ padding: '12px' }}>
          <div style={{
            color: '#00d4ff',
            fontSize: '12px',
            fontWeight: '600',
            marginBottom: '12px',
            textAlign: 'center'
          }}>
            📊 Spectrum
          </div>

          <div style={{ fontSize: '10px', color: '#666', lineHeight: '1.4' }}>
            <div style={{ marginBottom: '8px' }}>
              <strong>Freq:</strong> 433.0 MHz
            </div>
            <div style={{ marginBottom: '8px' }}>
              <strong>Rate:</strong> 2.4 MS/s
            </div>
            <div style={{ marginBottom: '8px' }}>
              <strong>Zoom:</strong> 1.0x
            </div>
            <div style={{ marginBottom: '8px' }}>
              <strong>FFT:</strong> 1024
            </div>
            <div style={{ color: '#00cc66' }}>
              ● Connected
            </div>
          </div>
        </div>
      </div>
    </MockSpectrumProvider>
  </div>
);
