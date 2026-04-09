import { configureStore } from '@reduxjs/toolkit';
import websocketSlice from '../../src/ts/redux/slices/websocketSlice';
import spectrumSlice from '../../src/ts/redux/slices/spectrumSlice';
import { requestNextLiveFrame } from '../../src/ts/redux/thunks/websocketThunks';

describe('requestNextLiveFrame thunk', () => {
  it('dispatches websocket/sendMessage with request_next_frame when connected', async () => {
    const seen: any[] = [];
    const captureMiddleware = () => (next: any) => (action: any) => {
      seen.push(action);
      return next(action);
    };

    const store = configureStore({
      reducer: {
        websocket: websocketSlice,
        spectrum: spectrumSlice,
      },
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({ serializableCheck: false }).concat(captureMiddleware),
    });

    store.dispatch({ type: 'websocket/setConnected' });
    await store.dispatch(requestNextLiveFrame() as any);

    expect(
      seen.some(
        (action) =>
          action?.type === 'websocket/sendMessage' &&
          action?.payload?.type === 'request_next_frame',
      ),
    ).toBe(true);
  });
});
