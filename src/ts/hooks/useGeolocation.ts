import { useState, useCallback } from 'react';

export interface GeolocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude?: number;
  timestamp: number;
}

export interface UseGeolocationReturn {
  location: GeolocationData | null;
  error: string | null;
  isLoading: boolean;
  isSupported: boolean;
  requestPermission: () => Promise<boolean>;
  getLocation: () => Promise<GeolocationData | null>;
}

export const useGeolocation = (): UseGeolocationReturn => {
  const [location, setLocation] = useState<GeolocationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSupported] = useState(() => 'geolocation' in navigator);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setError('Geolocation is not supported by this browser');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Check if permission API is available
      if ('permissions' in navigator) {
        const permission = await navigator.permissions.query({ name: 'geolocation' });
        if (permission.state === 'denied') {
          setError('Geolocation permission denied');
          setIsLoading(false);
          return false;
        }
      }

      // Try to get current position to verify permission
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000,
        });
      });

      const locationData: GeolocationData = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude || undefined,
        timestamp: position.timestamp,
      };

      setLocation(locationData);
      setIsLoading(false);
      return true;
    } catch (err) {
      const errorMessage = err instanceof GeolocationPositionError 
        ? getGeolocationErrorMessage(err.code)
        : 'Failed to get location';
      
      setError(errorMessage);
      setIsLoading(false);
      return false;
    }
  }, [isSupported]);

  const getLocation = useCallback(async (): Promise<GeolocationData | null> => {
    if (!isSupported) {
      setError('Geolocation is not supported by this browser');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0, // Force fresh location
        });
      });

      const locationData: GeolocationData = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude || undefined,
        timestamp: position.timestamp,
      };

      setLocation(locationData);
      setIsLoading(false);
      return locationData;
    } catch (err) {
      const errorMessage = err instanceof GeolocationPositionError 
        ? getGeolocationErrorMessage(err.code)
        : 'Failed to get location';
      
      setError(errorMessage);
      setIsLoading(false);
      return null;
    }
  }, [isSupported]);

  return {
    location,
    error,
    isLoading,
    isSupported,
    requestPermission,
    getLocation,
  };
};

function getGeolocationErrorMessage(code: number): string {
  switch (code) {
    case 1:
      return 'Geolocation permission denied';
    case 2:
      return 'Geolocation position unavailable';
    case 3:
      return 'Geolocation request timeout';
    default:
      return 'Geolocation error occurred';
  }
}
