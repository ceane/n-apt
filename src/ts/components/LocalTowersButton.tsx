import React, { useState } from 'react';
import styled from 'styled-components';
import { useGeolocation } from '@n-apt/hooks/useGeolocation';
import { BACKEND_HTTP_URL } from '@n-apt/consts/env';

interface LocalTowersButtonProps {
  onLocalTowersLoaded?: (result: LocalTowersResult) => void;
}

interface LocalTowersResult {
  loaded: number;
  radius: number;
  center: { lat: number; lng: number };
  states: number;
  cached: boolean;
}

const Button = styled.button<{ $disabled?: boolean; $loading?: boolean }>`
  background: ${props =>
    props.$disabled ? '#444' :
      props.$loading ? '#666' :
        '#2563eb'
  };
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: ${props => props.$disabled ? 'not-allowed' : 'pointer'};
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 8px;
  
  &:hover {
    background: ${props =>
    props.$disabled ? '#444' :
      props.$loading ? '#666' :
        '#1d4ed8'
  };
  }
  
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const Spinner = styled.div`
  width: 16px;
  height: 16px;
  border: 2px solid #ffffff;
  border-top: 2px solid transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

const StatusIcon = styled.div<{ $cached?: boolean }>`
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: ${props => props.$cached ? '#10b981' : '#3b82f6'};
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 10px;
  font-weight: bold;
`;

export const LocalTowersButton: React.FC<LocalTowersButtonProps> = ({
  onLocalTowersLoaded
}) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [result, setResult] = useState<LocalTowersResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    getLocation,
    isSupported,
    error: geoError,
    isLoading: geoLoading
  } = useGeolocation();

  const handleLoadLocalTowers = async () => {
    if (!isSupported) {
      setError('Geolocation is not supported by your browser');
      setStatus('error');
      return;
    }

    if (geoLoading) {
      return; // Wait for geolocation to load
    }

    setStatus('loading');
    setError(null);

    try {
      // Get user location
      const userLocation = await getLocation();
      if (!userLocation) {
        throw new Error('Unable to get your location');
      }

      // Call backend API
      const response = await fetch(`${BACKEND_HTTP_URL}/api/towers/load-local-radius`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          radius_km: 25 // Default 25km radius
        })
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data: LocalTowersResult = await response.json();
      setResult(data);
      setStatus('loaded');

      if (onLocalTowersLoaded) {
        onLocalTowersLoaded(data);
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load local towers';
      setError(errorMessage);
      setStatus('error');
    }
  };

  const renderButtonContent = () => {
    if (status === 'loading') {
      return (
        <>
          <Spinner />
          <span>Loading local towers...</span>
        </>
      );
    }

    if (status === 'loaded' && result) {
      return (
        <>
          <StatusIcon $cached={result.cached}>
            {result.cached ? '✓' : '✓'}
          </StatusIcon>
          <span>
            {result.loaded} local towers loaded
            {result.cached && ' (cached)'}
          </span>
        </>
      );
    }

    return (
      <>
        <StatusIcon>📍</StatusIcon>
        <span>Load local towers (25km radius)</span>
      </>
    );
  };

  const getTooltip = () => {
    if (!isSupported) {
      return 'Geolocation is not supported by your browser';
    }

    if (geoError) {
      return geoError;
    }

    if (geoLoading) {
      return 'Getting your location...';
    }

    if (status === 'error' && error) {
      return error;
    }

    if (status === 'loaded' && result) {
      return result.cached
        ? `Using cached towers from ${result.radius}km radius`
        : `Loaded ${result.loaded} towers from ${result.radius}km radius around your location`;
    }

    return 'Load towers within 25km of your current location';
  };

  const isDisabled = !isSupported || geoLoading || status === 'loading';

  return (
    <Button
      onClick={handleLoadLocalTowers}
      disabled={isDisabled}
      $loading={status === 'loading'}
      $disabled={isDisabled}
      title={getTooltip()}
    >
      {renderButtonContent()}
    </Button>
  );
};
