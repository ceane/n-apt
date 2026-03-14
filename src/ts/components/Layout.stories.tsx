import {
  AppContainer,
  AppWrapper,
  MainContent,
  ContentArea,
  InitializingContainer,
  InitializingTitle,
  InitializingText,
} from './Layout';

export default {
  title: 'Components/Layout',
  parameters: {
    layout: 'fullscreen',
  },
};

export const Default = () => (
  <AppContainer>
    <AppWrapper>
      <MainContent>
        <ContentArea>
          <div style={{ padding: '20px', color: 'white' }}>
            <h1>Content Area</h1>
            <p>This is the main content area of the application.</p>
          </div>
        </ContentArea>
      </MainContent>
    </AppWrapper>
  </AppContainer>
);

export const Initializing = () => (
  <InitializingContainer>
    <InitializingTitle>Initializing N-APT</InitializingTitle>
    <InitializingText>
      Setting up the signal processing pipeline and establishing connections to hardware devices.
      This may take a few moments...
    </InitializingText>
  </InitializingContainer>
);

export const WithCustomContent = () => (
  <AppContainer>
    <AppWrapper>
      <MainContent>
        <ContentArea style={{ backgroundColor: '#1a1a1a' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
            color: '#e0e0e0',
            fontFamily: 'JetBrains Mono, monospace'
          }}>
            <div style={{ textAlign: 'center' }}>
              <h2 style={{ margin: '0 0 16px 0' }}>Custom Layout Example</h2>
              <p style={{ margin: 0, opacity: 0.8 }}>
                This demonstrates how the layout components can be composed
              </p>
            </div>
          </div>
        </ContentArea>
      </MainContent>
    </AppWrapper>
  </AppContainer>
);
