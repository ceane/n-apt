import React from 'react';
import styled from 'styled-components';

const FallbackContainer = styled.div`
  padding: 24px;
  background: rgba(255, 68, 68, 0.05);
  border: 1px dashed rgba(255, 68, 68, 0.2);
  border-radius: 8px;
  color: #ff6666;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  text-align: center;
`;

const Title = styled.div`
  font-weight: bold;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
`;

const Message = styled.div`
  opacity: 0.8;
  font-size: 11px;
`;

interface DecryptionFallbackProps {
  moduleName: string;
}

export const DecryptionFallback: React.FC<DecryptionFallbackProps> = ({ moduleName }) => {
  return (
    <FallbackContainer>
      <Title>{moduleName} not decrypted</Title>
      <Message>Unavailable in current build. Use npm run decrypt-modules to enable.</Message>
    </FallbackContainer>
  );
};

export default DecryptionFallback;
