import { Middleware } from '@reduxjs/toolkit';

// IndexedDB configuration
const DB_NAME = 'napt-app-data';
const DB_VERSION = 1;
const STORE_NAME = 'app-state';

// IndexedDB helper class
class IndexedDBManager {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create object store for app state
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          // Create indexes for common queries
          store.createIndex('slice', 'slice', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  async store(key: string, data: any, slice: string): Promise<void> {
    await this.init();
    
    if (!this.db) throw new Error('Database not initialized');

    const transaction = this.db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const record = {
      key,
      data,
      slice,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const request = store.put(record);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async retrieve(key: string): Promise<any | null> {
    await this.init();
    
    if (!this.db) throw new Error('Database not initialized');

    const transaction = this.db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.get(key);
      
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.data : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async retrieveBySlice(slice: string): Promise<Record<string, any>> {
    await this.init();
    
    if (!this.db) throw new Error('Database not initialized');

    const transaction = this.db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('slice');

    return new Promise((resolve, reject) => {
      const request = index.getAll(slice);
      const results: Record<string, any> = {};
      
      request.onsuccess = () => {
        const records = request.result;
        records.forEach((record) => {
          results[record.key] = record.data;
        });
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async clear(): Promise<void> {
    await this.init();
    
    if (!this.db) throw new Error('Database not initialized');

    const transaction = this.db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.clear();
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async cleanup(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    await this.init();
    
    if (!this.db) throw new Error('Database not initialized');

    const transaction = this.db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const cutoffTime = Date.now() - maxAge;

    return new Promise((resolve, reject) => {
      const request = index.openCursor(IDBKeyRange.upperBound(cutoffTime));
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }
}

// Global IndexedDB manager instance
const idbManager = new IndexedDBManager();

// Create IndexedDB middleware
const createIndexedDBMiddleware = (): Middleware<{}, any> => (store) => (next) => (action: any) => {
  const result = next(action);
  const state = store.getState();

  // Handle waterfall data persistence (large datasets)
  if (action.type?.startsWith('waterfall/')) {
    const waterfallState = state.waterfall;
    
    // Persist draw params (can be complex objects)
    if (action.type === 'waterfall/setDrawParams') {
      idbManager.store('waterfall:drawParams', waterfallState.drawParams, 'waterfall')
        .catch(error => console.warn('Failed to persist draw params:', error));
    }
    
    // Persist selected files (store serializable metadata)
    if (action.type === 'waterfall/setSelectedFiles') {
      const filesMetadata = waterfallState.selectedFiles.map((f: any) => ({
        id: f.id,
        name: f.name,
        downloadUrl: f.downloadUrl,
      }));
      idbManager.store('waterfall:selectedFiles', filesMetadata, 'waterfall')
        .catch(error => console.warn('Failed to persist selected files metadata:', error));
    }
    
    // Persist training data
    if (action.type === 'waterfall/stopTrainingCapture') {
      idbManager.store('waterfall:trainingData', {
        capturedSamples: waterfallState.trainingCapturedSamples,
        timestamp: Date.now(),
      }, 'waterfall')
        .catch(error => console.warn('Failed to persist training data:', error));
    }
  }

  // Handle WebSocket large data persistence
  if (action.type?.startsWith('websocket/')) {
    const websocketState = state.websocket;
    
    // Persist spectrum frames (can be large arrays)
    if (action.type === 'websocket/setSpectrumFrames' && websocketState.spectrumFrames.length > 0) {
      idbManager.store('websocket:spectrumFrames', websocketState.spectrumFrames, 'websocket')
        .catch(error => console.warn('Failed to persist spectrum frames:', error));
    }
    
    // Persist capture status
    if (action.type === 'websocket/setCaptureStatus' && websocketState.captureStatus) {
      idbManager.store('websocket:captureStatus', websocketState.captureStatus, 'websocket')
        .catch(error => console.warn('Failed to persist capture status:', error));
    }
  }

  // Persist paused FFT/waterfall snapshot so remount can restore the full visual state.
  if (action.type === 'spectrum/setPausedSnapshot') {
    const spectrumState = state.spectrum;
    idbManager.store('spectrum:pausedSnapshot', spectrumState.pausedSnapshot, 'spectrum')
      .catch(error => console.warn('Failed to persist paused snapshot:', error));
  }

  return result;
};

// Helper functions to load persisted data from IndexedDB
export const loadPersistedWaterfallData = async () => {
  try {
    const data = await idbManager.retrieveBySlice('waterfall');
    return data;
  } catch (error) {
    console.warn('Failed to load persisted waterfall data:', error);
    return {};
  }
};

export const loadPersistedWebSocketData = async () => {
  try {
    const data = await idbManager.retrieveBySlice('websocket');
    return data;
  } catch (error) {
    console.warn('Failed to load persisted WebSocket data:', error);
    return {};
  }
};

export const loadPersistedSpectrumData = async () => {
  try {
    const data = await idbManager.retrieveBySlice('spectrum');
    return data;
  } catch (error) {
    console.warn('Failed to load persisted spectrum data:', error);
    return {};
  }
};

export const clearIndexedDBData = async () => {
  try {
    await idbManager.clear();
    console.log('IndexedDB data cleared successfully');
  } catch (error) {
    console.error('Failed to clear IndexedDB data:', error);
  }
};

export const cleanupIndexedDBData = async (maxAge?: number) => {
  try {
    await idbManager.cleanup(maxAge);
    console.log('IndexedDB data cleanup completed');
  } catch (error) {
    console.error('Failed to cleanup IndexedDB data:', error);
  }
};

const indexedDBMiddleware = createIndexedDBMiddleware();
export default indexedDBMiddleware;
