import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { GoogleMap, useJsApiLoader, Marker } from "@react-google-maps/api";

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background-color: #050505;
  color: #fff;
  box-sizing: border-box;
`;

const MapWrapper = styled.div`
  flex: 1;
  position: relative;
  background-color: #1a1a1a;
  overflow: hidden;
`;

const LoadingOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  z-index: 10;
  font-family: "JetBrains Mono", monospace;
  color: #888;
`;

const mapContainerStyle = {
  width: "100%",
  height: "100%",
};

const darkMapStyles = [
  { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d59563" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d59563" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#263c3f" }],
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.fill",
    stylers: [{ color: "#6b9a76" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#38414e" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#212a37" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9ca5b3" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#746855" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1f2835" }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#f3d19c" }],
  },
  {
    featureType: "transit",
    elementType: "geometry",
    stylers: [{ color: "#2f3948" }],
  },
  {
    featureType: "transit.station",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d59563" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#17263c" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#515c6d" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#17263c" }],
  },
];

export const MapEndpointsRoute: React.FC = () => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  console.log("GOOGLE_MAPS_API_KEY:", apiKey);

  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: (apiKey as string) || "",
  });

  const [center, setCenter] = useState({ lat: 0, lng: 0 });

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCenter({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        () => {
          console.error("Geolocation failed");
          // Fallback center or handle error
          setCenter({ lat: 40.7128, lng: -74.0060 }); // NYC
        }
      );
    }
  }, []);

  return (
    <PageContainer>
      <MapWrapper>
        {!isLoaded ? (
          <LoadingOverlay>Loading Engine...</LoadingOverlay>
        ) : (
          <GoogleMap
            mapContainerStyle={mapContainerStyle}
            center={center}
            zoom={15} // Approx 1/2 mile
            options={{
              styles: darkMapStyles,
              disableDefaultUI: false,
              backgroundColor: "#1a1a1a",
            }}
          >
            {center.lat !== 0 && (
              <Marker
                position={center}
                title="Your Location"
              />
            )}
          </GoogleMap>
        )}
      </MapWrapper>
    </PageContainer>
  );
};

export default MapEndpointsRoute;
