import React, { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { X } from 'lucide-react';

const slideIn = keyframes`
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
`;

const NotificationContainer = styled.div<{ $type: 'info' | 'success' | 'warning' | 'error' }>`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  background: ${(props) => {
    switch (props.$type) {
      case 'success':
        return props.theme.background || '#1a1a1a';
      case 'warning':
        return props.theme.background || '#1a1a1a';
      case 'error':
        return props.theme.background || '#1a1a1a';
      default:
        return props.theme.background || '#1a1a1a';
    }
  }};
  border: 1px solid ${(props) => {
    switch (props.$type) {
      case 'success':
        return props.theme.success || '#22c55e';
      case 'warning':
        return props.theme.warning || '#f59e0b';
      case 'error':
        return props.theme.danger || '#ef4444';
      default:
        return props.theme.primary || '#00d4ff';
    }
  }};
  border-radius: 8px;
  color: ${(props) => {
    switch (props.$type) {
      case 'success':
        return props.theme.success || '#22c55e';
      case 'warning':
        return props.theme.warning || '#f59e0b';
      case 'error':
        return props.theme.danger || '#ef4444';
      default:
        return props.theme.primary || '#00d4ff';
    }
  }};
  font-size: 12px;
  font-weight: 500;
  font-family: ${(props) => props.theme.typography?.mono || 'monospace'};
  min-width: 280px;
  max-width: 400px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  animation: ${slideIn} 0.3s ease-out;
  z-index: 99999;
  position: relative;
  backdrop-filter: blur(8px);
`;

const NotificationContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  word-wrap: break-word;
  overflow-wrap: break-word;
`;

const NotificationTitle = styled.div`
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-size: 11px;
`;

const NotificationMessage = styled.div`
  font-size: 12px;
  opacity: 0.9;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.7;
  transition: opacity 0.2s ease;

  &:hover {
    opacity: 1;
  }
`;

const NotificationDot = styled.div<{ $type: 'info' | 'success' | 'warning' | 'error' }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${(props) => {
    switch (props.$type) {
      case 'success':
        return props.theme.success || '#22c55e';
      case 'warning':
        return props.theme.warning || '#f59e0b';
      case 'error':
        return props.theme.danger || '#ef4444';
      default:
        return props.theme.primary || '#00d4ff';
    }
  }};
  animation: pulse 2s infinite;
  
  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
`;

export interface NotificationProps {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  duration?: number; // Auto-dismiss after ms, undefined = no auto-dismiss
  onClose?: (id: string) => void;
  icon?: React.ReactNode;
}

export const Notification: React.FC<NotificationProps> = ({
  id,
  type,
  title,
  message,
  duration,
  onClose,
  icon,
}) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (duration) {
      const timer = setTimeout(() => {
        handleClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => {
      onClose?.(id);
    }, 300); // Wait for slide out animation
  };

  if (!isVisible) {
    return null;
  }

  return (
    <NotificationContainer $type={type}>
      {icon || <NotificationDot $type={type} />}
      <NotificationContent>
        <NotificationTitle>{title}</NotificationTitle>
        {message && <NotificationMessage>{message}</NotificationMessage>}
      </NotificationContent>
      <CloseButton onClick={handleClose}>
        <X size={14} />
      </CloseButton>
    </NotificationContainer>
  );
};
