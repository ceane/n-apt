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
  async (range: { min_mhz: number; max_mhz: number }, { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: 'websocket/sendMessage',
        payload: {
          type: 'demod_tune',
          min_freq: range.min_mhz,
          max_freq: range.max_mhz,
        },
      });
      
      // Also update local state for the span
      dispatch(setSpanRange({ min: range.min_mhz, max: range.max_mhz }));
      
      // Default center freq to the middle of the span
      dispatch(setCenterFreq((range.min_mhz + range.max_mhz) / 2));
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
