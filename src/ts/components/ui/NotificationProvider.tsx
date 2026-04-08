import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import styled from 'styled-components';
import { Notification, NotificationProps } from './Notification';

interface NotificationState {
  notifications: NotificationProps[];
}

type NotificationAction =
  | { type: 'ADD_NOTIFICATION'; payload: Omit<NotificationProps, 'id'> & { id?: string } }
  | { type: 'REMOVE_NOTIFICATION'; payload: string }
  | { type: 'CLEAR_ALL_NOTIFICATIONS' };

const notificationReducer = (state: NotificationState, action: NotificationAction): NotificationState => {
  switch (action.type) {
    case 'ADD_NOTIFICATION': {
      const notification = {
        ...action.payload,
        id: action.payload.id || `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      };
      return {
        ...state,
        notifications: [...state.notifications, notification as NotificationProps],
      };
    }
    case 'REMOVE_NOTIFICATION':
      return {
        ...state,
        notifications: state.notifications.filter(n => n.id !== action.payload),
      };
    case 'CLEAR_ALL_NOTIFICATIONS':
      return {
        ...state,
        notifications: [],
      };
    default:
      return state;
  }
};

const NotificationContext = createContext<{
  notifications: NotificationProps[];
  addNotification: (notification: Omit<NotificationProps, 'id'> & { id?: string }) => void;
  removeNotification: (id: string) => void;
  clearAllNotifications: () => void;
} | null>(null);

const NotificationContainer = styled.div`
  position: fixed;
  top: 20px;
  right: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: 9999;
  pointer-events: none;
  
  & > * {
    pointer-events: auto;
  }
`;

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(notificationReducer, { notifications: [] });

  const addNotification = (notification: Omit<NotificationProps, 'id'> & { id?: string }) => {
    dispatch({ type: 'ADD_NOTIFICATION', payload: notification });
  };

  const removeNotification = (id: string) => {
    dispatch({ type: 'REMOVE_NOTIFICATION', payload: id });
  };

  const clearAllNotifications = () => {
    dispatch({ type: 'CLEAR_ALL_NOTIFICATIONS' });
  };

  return (
    <NotificationContext.Provider value={{
      notifications: state.notifications,
      addNotification,
      removeNotification,
      clearAllNotifications,
    }}>
      {children}
      <NotificationContainer>
        {state.notifications.map((notification) => (
          <Notification
            key={notification.id}
            {...notification}
            onClose={removeNotification}
          />
        ))}
      </NotificationContainer>
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
