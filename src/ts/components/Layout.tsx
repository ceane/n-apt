import styled from "styled-components";

export const AppContainer = styled.div`
  display: flex;
  width: 100%;
  height: 100vh;
  background-color: ${(props) => props.theme.background};
`;

export const AppWrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
`;

export const MainContent = styled.section`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
`;

export const ContentArea = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
`;

export const InitializingContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: ${(props) => props.theme.background};
  padding: 40px;
  gap: 32px;
  min-height: 100vh;
`;

export const InitializingTitle = styled.h2`
  font-family: "JetBrains Mono", monospace;
  font-size: 18px;
  font-weight: 600;
  color: ${(props) => props.theme.textPrimary};
  margin: 0;
  letter-spacing: 0.5px;
  animation: pulse 1.5s ease-in-out infinite;

  @keyframes pulse {
    0% {
      opacity: 0.4;
    }
    50% {
      opacity: 1;
    }
    100% {
      opacity: 0.4;
    }
  }
`;

export const InitializingText = styled.p`
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  color: ${(props) => props.theme.textSecondary};
  margin: 0;
  text-align: center;
  max-width: 400px;
  line-height: 1.6;
`;
