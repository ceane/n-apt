import { useEffect, useState } from "react";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useMap } from "react-leaflet";

export const OPEN_FREE_MAP_ATTRIBUTION =
  '<a href="https://openfreemap.org/">OpenFreeMap</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const getOpenFreeMapStyleUrl = (isDark: boolean) =>
  `https://tiles.openfreemap.org/styles/${isDark ? "dark" : "positron"}`;

setWorkerUrl(workerUrl);

export const OpenFreeMapLayer: React.FC = () => {
  const map = useMap();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => setIsDark(mediaQuery.matches);

    updateTheme();
    mediaQuery.addEventListener("change", updateTheme);

    return () => mediaQuery.removeEventListener("change", updateTheme);
  }, []);

  useEffect(() => {
    const layer = maplibreGL({
      style: getOpenFreeMapStyleUrl(isDark),
      attributionControl: false,
    }).addTo(map);

    map.attributionControl.addAttribution(OPEN_FREE_MAP_ATTRIBUTION);

    return () => {
      map.removeLayer(layer);
      map.attributionControl.removeAttribution(OPEN_FREE_MAP_ATTRIBUTION);
    };
  }, [isDark, map]);

  return null;
};
