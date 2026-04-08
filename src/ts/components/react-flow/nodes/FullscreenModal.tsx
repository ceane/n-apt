import React from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { X } from 'lucide-react';
import ReduxThemeProvider from '@n-apt/components/ReduxThemeProvider';

const FullscreenOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const ModalContent = styled.div`
  background: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  width: 95vw;
  height: 95vh;
  padding: 0;
  overflow: hidden;
  position: relative;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4),
              0 0 40px ${({ theme }) => theme.colors.primary}11;
  display: flex;
  flex-direction: column;
`;

const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 32px;
  background: ${({ theme }) => theme.colors.surface};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const ModalTitle = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const DiagnosticLabel = styled.div`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
`;

const MainTitle = styled.h2`
  margin: 0;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 24px;
  font-weight: 400;
  letter-spacing: -0.01em;
`;

const ScrollableContainer = styled.div`
  flex: 1;
  overflow: auto;
  padding: 32px;
  background: ${({ theme }) => theme.colors.background};

  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 8px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.colors.border};
    border-radius: 10px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background: ${({ theme }) => theme.colors.textMuted};
  }
`;

const CloseButton = styled.button`
  position: absolute;
  top: 20px;
  right: 20px;
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textPrimary};
  transition: all 0.2s ease;

  &:hover {
    background: ${({ theme }) => theme.colors.surfaceHover};
    transform: scale(1.1);
  }
`;

interface FullscreenModalProps {
  children: React.ReactNode;
  title: string;
  onClose?: () => void;
}

export const FullscreenModal: React.FC<FullscreenModalProps> = ({ children, title, onClose }) => {
  return createPortal(
    <ReduxThemeProvider>
      <FullscreenOverlay>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              <DiagnosticLabel>Diagnostic View</DiagnosticLabel>
              <MainTitle>{title}</MainTitle>
            </ModalTitle>
            <CloseButton onClick={onClose} style={{ position: 'relative', top: 0, right: 0 }}>
              <X size={20} />
            </CloseButton>
          </ModalHeader>
          <ScrollableContainer>
            {children}
          </ScrollableContainer>
        </ModalContent>
      </FullscreenOverlay>
    </ReduxThemeProvider>,
    document.body
  );
};
