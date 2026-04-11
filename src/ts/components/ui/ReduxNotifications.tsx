import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Notification } from './Notification';
import { selectNotifications, removeNotification } from '@n-apt/redux/slices/notificationsSlice';
import styled from 'styled-components';
import * as LucideIcons from 'lucide-react';

const NotificationContainer = styled.div`
  position: fixed;
  top: 20px;
  right: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: 99999;
  pointer-events: none;

  & > * {
    pointer-events: auto;
  }
`;

const getIconComponent = (iconName?: string): React.ReactNode => {
  if (!iconName) return undefined;
  const IconComponent = (LucideIcons as any)[iconName];
  if (IconComponent) {
    return <IconComponent size={16} />;
  }
  return undefined;
};

export const ReduxNotifications: React.FC = () => {
  const notifications = useSelector(selectNotifications);
  const dispatch = useDispatch();

  const handleClose = (id: string) => {
    dispatch(removeNotification(id));
  };

  return (
    <NotificationContainer>
      {notifications.map((notification) => (
        <Notification
          key={notification.id}
          id={notification.id}
          type={notification.type}
          title={notification.title}
          message={notification.message}
          duration={notification.duration}
          icon={getIconComponent(notification.iconName)}
          onClose={handleClose}
        />
      ))}
    </NotificationContainer>
  );
};
