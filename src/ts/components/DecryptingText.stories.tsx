import DecryptingText from "@n-apt/components/DecryptingText";

export default {
  title: 'Components/DecryptingText',
  parameters: {
    layout: 'centered',
  },
};

export const Default = () => (
  <DecryptingText targetText="N-APT Signal Analysis" speed={8} />
);

export const SlowDecryption = () => (
  <DecryptingText targetText="Initializing Hardware..." speed={15} />
);

export const FastDecryption = () => (
  <DecryptingText targetText="Connected" speed={3} />
);

export const LongText = () => (
  <DecryptingText
    targetText="Advanced Signal Processing Toolkit for Radio Frequency Analysis"
    speed={10}
  />
);

export const CustomStyling = () => (
  <DecryptingText
    targetText="Custom Style"
    speed={8}
    className="text-3xl font-mono text-cyan-400"
    style={{
      textShadow: '0 0 10px rgba(0, 212, 255, 0.5)',
    }}
  />
);

export const MultipleTexts = () => (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    alignItems: 'center',
    padding: '40px',
    backgroundColor: '#0a0a0a',
    minHeight: '300px'
  }}>
    <DecryptingText
      targetText="System Status"
      speed={5}
      className="text-lg text-gray-400"
    />
    <DecryptingText
      targetText="N-APT Online"
      speed={8}
      className="text-2xl text-green-400"
    />
    <DecryptingText
      targetText="Ready for Capture"
      speed={12}
      className="text-xl text-cyan-400"
    />
  </div>
);
