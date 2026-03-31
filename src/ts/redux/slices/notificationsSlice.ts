import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface NotificationState {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  duration?: number;
  timestamp: number;
  icon?: React.ReactNode;
}

interface NotificationsState {
  notifications: NotificationState[];
}

const initialState: NotificationsState = {
  notifications: [],
};

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState,
  reducers: {
    addNotification: (state, action: PayloadAction<Omit<NotificationState, 'timestamp'> & { id?: string }>) => {
      const notification: NotificationState = {
        ...action.payload,
        id: action.payload.id || `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
      };
      
      // Check if notification with this ID already exists and update it
      const existingIndex = state.notifications.findIndex(n => n.id === notification.id);
      if (existingIndex !== -1) {
        state.notifications[existingIndex] = notification;
      } else {
        state.notifications.push(notification);
      }
    },
    updateNotification: (state, action: PayloadAction<{ id: string; updates: Partial<Omit<NotificationState, 'id' | 'timestamp'>> }>) => {
      const { id, updates } = action.payload;
      const existingIndex = state.notifications.findIndex(n => n.id === id);
      if (existingIndex !== -1) {
        state.notifications[existingIndex] = {
          ...state.notifications[existingIndex],
          ...updates,
          timestamp: Date.now(),
        };
      }
    },
    removeNotification: (state, action: PayloadAction<string>) => {
      state.notifications = state.notifications.filter(n => n.id !== action.payload);
    },
    clearAllNotifications: (state) => {
      state.notifications = [];
    },
  },
});

export const { addNotification, updateNotification, removeNotification, clearAllNotifications } = notificationsSlice.actions;

export const selectNotifications = (state: { notifications: NotificationsState }) => 
  state.notifications.notifications;

export default notificationsSlice.reducer;
