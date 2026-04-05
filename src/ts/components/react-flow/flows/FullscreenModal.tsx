import React from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { X } from 'lucide-react';

const FullscreenOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.95);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const ModalContent = styled.div`
  background: #0a0a0a;
  border: 1px solid #1f1f1f;
  border-radius: 12px;
  padding: 32px;
  max-width: 90vw;
  max-height: 90vh;
  overflow: hidden;
  position: relative;
  box-shadow: 0 50px 100px -20px rgba(0, 0, 0, 0.5);
`;

const CloseButton = styled.button`
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  color: white;
  transition: all 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.2);
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
    <FullscreenOverlay>
      <ModalContent>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, color: 'white', fontSize: '18px' }}>{title}</h2>
          <CloseButton onClick={onClose}>
            <X size={24} />
          </CloseButton>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {children}
        </div>
      </ModalContent>
    </FullscreenOverlay>,
    document.body
  );
};
