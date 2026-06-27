import React from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { X } from "lucide-react";

const FullscreenOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.95);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  padding: 40px;
  backdrop-filter: blur(20px);
  animation: fadeIn 0.2s ease-out;

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`;

const ModalContent = styled.div`
  background: #0a0a0a;
  border: 1px solid #1f1f1f;
  border-radius: 12px;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  box-shadow: 0 50px 100px -20px rgba(0, 0, 0, 0.5);
`;

const CloseButton = styled.button`
  position: absolute;
  top: 20px;
  right: 20px;
  background: #1f1f1f;
  border: 1px solid #333;
  color: #fff;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 100;
  transition: all 0.2s;

  &:hover {
    background: #e1000022;
    border-color: #e1000044;
    color: #ff4444;
    transform: scale(1.1);
  }
`;

const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 30px;
  border-bottom: 1px solid #1f1f1f;
  background: #161616;
`;

const ModalSubtitle = styled.div`
  font-size: 12px;
  color: #00d4ff;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-weight: 800;
`;

const ModalTitle = styled.div`
  font-size: 24px;
  font-weight: 700;
  color: #fff;
`;

const ModalBody = styled.div`
  flex: 1;
  overflow: auto;
`;

interface FullscreenModalProps {
  children: React.ReactNode;
  title: string;
  onClose: () => void;
}

export const FullscreenModal: React.FC<FullscreenModalProps> = ({
  children,
  title,
  onClose,
}) => {
  return createPortal(
    <FullscreenOverlay>
      <ModalContent>
        <ModalHeader>
          <div>
            <ModalSubtitle>Diagnostic View</ModalSubtitle>
            <ModalTitle>{title}</ModalTitle>
          </div>
          <CloseButton onClick={onClose}>
            <X size={24} />
          </CloseButton>
        </ModalHeader>
        <ModalBody>{children}</ModalBody>
      </ModalContent>
    </FullscreenOverlay>,
    document.body,
  );
};
