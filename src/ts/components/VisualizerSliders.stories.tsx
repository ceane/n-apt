import VisualizerSliders from './VisualizerSliders';

export default {
  title: 'Components/VisualizerSliders',
  parameters: {
    layout: 'padded',
  },
};

export const Default = () => (
  <div style={{ width: '300px', height: '400px', backgroundColor: '#0a0a0a', padding: '20px' }}>
    <VisualizerSliders
      zoom={1.0}
      dbMax={-20}
      dbMin={-80}
      powerScale="dB"
      onZoomChange={(zoom) => console.log('Zoom:', zoom)}
      onDbMaxChange={(dbMax) => console.log('dB Max:', dbMax)}
      onDbMinChange={(dbMin) => console.log('dB Min:', dbMin)}
      fftAvgEnabled={false}
      fftSmoothEnabled={true}
      wfSmoothEnabled={false}
      onFftAvgChange={(enabled) => console.log('FFT Avg:', enabled)}
      onFftSmoothChange={(enabled) => console.log('FFT Smooth:', enabled)}
      onWfSmoothChange={(enabled) => console.log('WF Smooth:', enabled)}
      onResetZoomDb={() => console.log('Reset Zoom/DB')}
    />
  </div>
);

export const WithAllTogglesOn = () => (
  <div style={{ width: '300px', height: '400px', backgroundColor: '#0a0a0a', padding: '20px' }}>
    <VisualizerSliders
      zoom={2.5}
      dbMax={-10}
      dbMin={-90}
      powerScale="dBm"
      onZoomChange={(zoom) => console.log('Zoom:', zoom)}
      onDbMaxChange={(dbMax) => console.log('dB Max:', dbMax)}
      onDbMinChange={(dbMin) => console.log('dB Min:', dbMin)}
      fftAvgEnabled={true}
      fftSmoothEnabled={true}
      wfSmoothEnabled={true}
      onFftAvgChange={(enabled) => console.log('FFT Avg:', enabled)}
      onFftSmoothChange={(enabled) => console.log('FFT Smooth:', enabled)}
      onWfSmoothChange={(enabled) => console.log('WF Smooth:', enabled)}
      onResetZoomDb={() => console.log('Reset Zoom/DB')}
    />
  </div>
);

export const Zoomed = () => (
  <div style={{ width: '300px', height: '400px', backgroundColor: '#0a0a0a', padding: '20px' }}>
    <VisualizerSliders
      zoom={5.0}
      dbMax={-30}
      dbMin={-70}
      powerScale="dB"
      onZoomChange={(zoom) => console.log('Zoom:', zoom)}
      onDbMaxChange={(dbMax) => console.log('dB Max:', dbMax)}
      onDbMinChange={(dbMin) => console.log('dB Min:', dbMin)}
      fftAvgEnabled={false}
      fftSmoothEnabled={false}
      wfSmoothEnabled={false}
      onFftAvgChange={(enabled) => console.log('FFT Avg:', enabled)}
      onFftSmoothChange={(enabled) => console.log('FFT Smooth:', enabled)}
      onWfSmoothChange={(enabled) => console.log('WF Smooth:', enabled)}
      onResetZoomDb={() => console.log('Reset Zoom/DB')}
    />
  </div>
);

export const Compact = () => (
  <div style={{ width: '250px', height: '350px', backgroundColor: '#0a0a0a', padding: '15px' }}>
    <VisualizerSliders
      zoom={1.5}
      dbMax={-25}
      dbMin={-75}
      powerScale="dB"
      onZoomChange={(zoom) => console.log('Zoom:', zoom)}
      onDbMaxChange={(dbMax) => console.log('dB Max:', dbMax)}
      onDbMinChange={(dbMin) => console.log('dB Min:', dbMin)}
      fftAvgEnabled={true}
      fftSmoothEnabled={false}
      wfSmoothEnabled={true}
      onFftAvgChange={(enabled) => console.log('FFT Avg:', enabled)}
      onFftSmoothChange={(enabled) => console.log('FFT Smooth:', enabled)}
      onWfSmoothChange={(enabled) => console.log('WF Smooth:', enabled)}
      onResetZoomDb={() => console.log('Reset Zoom/DB')}
    />
  </div>
);
