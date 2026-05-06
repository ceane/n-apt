import React from 'react';
import styled from 'styled-components';
import { ShieldAlert, Terminal, HelpCircle, RefreshCcw, Shield } from "lucide-react";
import { useAuthentication } from "../../hooks/useAuthentication";
import { Button } from "@n-apt/components/ui";

const FallbackContainer = styled.div`
  padding: 16px;
  background: rgba(255, 68, 68, 0.05);
  border: 1px dashed rgba(255, 68, 68, 0.2);
  border-radius: 8px;
  color: #ff6666;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: #ff4444;
`;

const Title = styled.div`
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 1px;
`;

const Message = styled.div`
  opacity: 0.9;
  font-size: 11px;
  line-height: 1.5;
`;

const Instructions = styled.div`
  background: rgba(0, 0, 0, 0.2);
  padding: 10px;
  border-radius: 4px;
  font-size: 10px;
  color: #bbb;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const CodeBlock = styled.code`
  color: #eee;
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 4px;
  border-radius: 2px;
`;

export type DecryptionErrorType = 'vault' | 'demod' | 'latex';

interface DecryptionFallbackProps {
  moduleName: string;
  errorType?: DecryptionErrorType;
}

export const DecryptionFallback: React.FC<DecryptionFallbackProps> = ({ 
  moduleName, 
  errorType = 'vault' 
}) => {
  const { logout } = useAuthentication();

  const getErrorInfo = () => {
    switch (errorType) {
      case 'demod':
        return {
          envVar: 'UNSAFE_LOCAL_DEMOD_PASSWORD',
          message: 'Demodulation logic is encrypted and requires a specific password for this environment.',
          troubleshooting: 'Ensure the demodulation keys are correctly synchronized with your .env.local file.'
        };
      case 'latex':
        return {
          envVar: 'UNSAFE_LOCAL_LATEX_PASSWORD',
          message: 'LaTeX math rendering components are encrypted to protect proprietary formatting logic.',
          troubleshooting: 'Check if the LaTeX renderer service is authenticated correctly.'
        };
      case 'vault':
      default:
        return {
          envVar: 'UNSAFE_LOCAL_USER_PASSWORD',
          message: 'This file or module is encrypted and the current vault session cannot unlock it.',
          troubleshooting: 'Try locking and unlocking the vault again from the sidebar header.'
        };
    }
  };

  const { envVar, message, troubleshooting } = getErrorInfo();

  return (
    <FallbackContainer>
      <Header>
        <ShieldAlert size={16} />
        <Title>{moduleName} Decryption Failed</Title>
      </Header>
      
      <Message>
        {message}
        <br />
        <span style={{ opacity: 0.7, fontSize: '10px' }}>
          This usually happens if the session key has expired or the password was incorrect.
        </span>
      </Message>

      <Instructions>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Terminal size={12} />
          <span>Check your <CodeBlock>.env.local</CodeBlock> configuration:</span>
        </div>
        <div style={{ paddingLeft: 18, color: '#999' }}>
          Ensure <CodeBlock>{envVar}</CodeBlock> is set correctly.
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <HelpCircle size={12} />
          <span>Troubleshooting:</span>
        </div>
        <div style={{ paddingLeft: 18, color: '#999' }}>
          {troubleshooting}
        </div>
      </Instructions>

      <div style={{ display: 'flex', gap: '8px' }}>
        <Button 
          $variant="primary" 
          onClick={() => window.location.reload()}
          style={{ fontSize: '10px', padding: '4px 8px', height: 'auto', flex: 1 }}
        >
          <RefreshCcw size={10} />
          Reload
        </Button>
        <Button 
          $variant="secondary" 
          onClick={logout}
          style={{ fontSize: '10px', padding: '4px 8px', height: 'auto', flex: 1 }}
        >
          <Shield size={10} />
          Re-auth
        </Button>
      </div>
    </FallbackContainer>
  );
};

export default DecryptionFallback;
