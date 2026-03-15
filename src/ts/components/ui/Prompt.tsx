import React from "react";
import styled from "styled-components";

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  backdrop-filter: blur(4px);
`;

const PromptContainer = styled.div`
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 12px;
  padding: 24px;
  min-width: 320px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.9);
  font-family: "JetBrains Mono", monospace;
`;

const Title = styled.div`
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 12px;
`;

const Message = styled.div`
  font-size: 13px;
  color: #ccc;
  line-height: 1.5;
  margin-bottom: 20px;
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 12px;
  justify-content: flex-end;
`;

const Button = styled.button<{ $variant?: "primary" | "danger" }>`
  background: ${(props) =>
    props.$variant === "danger" ? "#ff4444" :
      props.$variant === "primary" ? "#00d4ff" : "#333"
  };
  color: ${(props) =>
    props.$variant === "danger" || props.$variant === "primary" ? "#000" : "#ccc"
  };
  border: none;
  border-radius: 6px;
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: ${(props) =>
    props.$variant === "danger" ? "#ff6666" :
      props.$variant === "primary" ? "#fff" : "#444"
  };
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
`;

interface PromptProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "primary" | "danger";
}

export const Prompt: React.FC<PromptProps> = ({
  open,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  variant = "primary"
}) => {
  if (!open) return null;

  const handleConfirm = () => {
    onConfirm();
  };

  const handleCancel = () => {
    onCancel();
  };

  return (
    <Overlay onClick={handleCancel}>
      <PromptContainer onClick={(e) => e.stopPropagation()}>
        <Title>{title}</Title>
        <Message>{message}</Message>
        <ButtonRow>
          <Button onClick={handleCancel}>
            {cancelText}
          </Button>
          <Button $variant={variant} onClick={handleConfirm}>
            {confirmText}
          </Button>
        </ButtonRow>
      </PromptContainer>
    </Overlay>
  );
};
