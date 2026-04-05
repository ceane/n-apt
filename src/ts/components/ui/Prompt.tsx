import React, { useEffect, useRef } from "react";
import styled from "styled-components";

const Dialog = styled.dialog`
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: 12px;
  padding: 24px;
  min-width: 320px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.9);
  font-family: ${({ theme }) => theme.typography?.mono || "JetBrains Mono"};
  color: ${({ theme }) => theme.textPrimary};
  outline: none;
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  margin: 0;

  &::backdrop {
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(4px);
    animation: fadeIn 0.2s ease-out;
  }

  &[open] {
    animation: scaleIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes scaleIn {
    from { transform: translate(-50%, -50%) scale(0.9) opacity: 0; }
    to { transform: translate(-50%, -50%) scale(1) opacity: 1; }
  }
`;

const Title = styled.div`
  font-size: 16px;
  font-weight: 700;
  color: ${({ theme }) => theme.textPrimary};
  margin-bottom: 12px;
`;

const Message = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.textSecondary};
  line-height: 1.5;
  margin-bottom: 20px;
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 12px;
  justify-content: flex-end;
`;

const Button = styled.button<{ $variant?: "primary" | "danger" }>`
  background: ${(props) => {
    const { $variant = "primary", theme } = props;
    if ($variant === "danger") {
      return theme.danger;
    }
    if ($variant === "primary") {
      return theme.primary;
    }
    return theme.surfaceHover;
  }};
  color: ${(props) => {
    const { $variant = "primary", theme } = props;
    if ($variant === "danger") {
      return "#fff";
    }
    if ($variant === "primary") {
      return theme.mode === "light" ? "#fff" : "#000";
    }
    return "#fff";
  }};
  border: none;
  border-radius: 6px;
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 600;
  font-family: ${({ theme }) => theme.typography?.mono || "JetBrains Mono"};
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: ${(props) => {
    const { $variant = "primary", theme } = props;
    if ($variant === "danger") {
      return theme.mode === "light" ? "#e53e3e" : "#ff6666";
    }
    if ($variant === "primary") {
      return theme.mode === "light" ? "#0044cc" : "#fff";
    }
    return theme.mode === "light" ? "#e2e8f0" : "#444";
  }};
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
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [open]);

  const handleCancel = (e: React.MouseEvent | React.SyntheticEvent) => {
    e.stopPropagation();
    onCancel();
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      onCancel();
    }
  };

  return (
    <Dialog
      ref={dialogRef}
      onClose={onCancel}
      onClick={handleBackdropClick}
    >
      <Title>{title}</Title>
      <Message>{message}</Message>
      <ButtonRow>
        <Button onClick={handleCancel}>
          {cancelText}
        </Button>
        <Button $variant={variant} onClick={onConfirm}>
          {confirmText}
        </Button>
      </ButtonRow>
    </Dialog>
  );
};
