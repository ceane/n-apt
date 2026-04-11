import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Notification } from './Notification';
import { selectNotifications, removeNotification, clearAllNotifications } from '@n-apt/redux/slices/notificationsSlice';
import styled from 'styled-components';

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

export const ReduxNotifications: React.FC = () => {
  const notifications = useSelector(selectNotifications);
  const dispatch = useDispatch();

  // Clear legacy notifications with non-serializable icon values on mount
  useEffect(() => {
    dispatch(clearAllNotifications());
  }, [dispatch]);

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
          onClose={handleClose}
        />
      ))}
    </NotificationContainer>
  );
};
