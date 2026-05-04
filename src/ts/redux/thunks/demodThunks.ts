import { createAsyncThunk } from '@reduxjs/toolkit';
import { RootState } from '@n-apt/redux/store';
import { setSpanRange, setCenterFreq } from '../slices/demodSlice';

// Send get_hardware_info to server
export const fetchHardwareInfo = createAsyncThunk(
  'demod/fetchHardwareInfo',
  async (_, { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: 'websocket/sendMessage',
        payload: {
          type: 'get_hardware_info',
        },
      });
    }
  }
);

// Send demod_tune command to server (sets hardware center freq)
export const tuneDemod = createAsyncThunk(
  'demod/tune',
  async (range: { min_hz: number; max_hz: number }, { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: 'websocket/sendMessage',
        payload: {
          type: 'demod_tune',
          min_freq: range.min_hz,
          max_freq: range.max_hz,
        },
      });
      
      // Also update local state for the span
      dispatch(setSpanRange({ min: range.min_hz, max: range.max_hz }));
      
      // Default center freq to the middle of the span
      dispatch(setCenterFreq((range.min_hz + range.max_hz) / 2));
    }
  }
);

// Update internal radio center frequency
export const updateRadioCenterFreq = createAsyncThunk(
  'demod/updateRadioCenterFreq',
  async (centerMHz: number, { dispatch }) => {
    dispatch(setCenterFreq(centerMHz));
  }
);
