import { useCallback, useMemo, useState } from "react";
import { BACKEND_HTTP_URL } from "@n-apt/consts/env";

export type TowerRadio = "GSM" | "UMTS" | "LTE" | "NR" | "UNKNOWN";

export interface TowerRecord {
  id: string;
  radio: TowerRadio | string;
  mcc: string;
  mnc: string;
  lac: string;
  cell: string;
  range: string;
  lon: number;
  lat: number;
  samples: string;
  created: string;
  updated: string;
  state?: string;
  region?: string;
  tech?: string;
}

interface BoundsQuery {
  neLat: number;
  neLng: number;
  swLat: number;
  swLng: number;
  zoom: number;
  tech?: string;
  range?: string;
  mcc?: string;
  mnc?: string;
}

interface TowerBoundsResponse {
  towers: TowerRecord[];
  count: number;
  zoom?: number;
}

const API_BASE = BACKEND_HTTP_URL.replace(/\/$/, "");

export function useTowers() {
  const [towers, setTowers] = useState<TowerRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cache = useMemo(() => new Map<string, TowerRecord[]>(), []);

  const fetchTowersInBounds = useCallback(
    async (query: BoundsQuery): Promise<void> => {
      const key = [
        query.neLat.toFixed(4),
        query.neLng.toFixed(4),
        query.swLat.toFixed(4),
        query.swLng.toFixed(4),
        query.zoom,
        query.tech ?? "all-tech",
        query.range ?? "all-range",
        query.mcc ?? "all-mcc",
        query.mnc ?? "all-mnc",
      ].join("|");

      const cached = cache.get(key);
      if (cached) {
        setTowers(cached);
        setError(null);
        return;
      }

      const params = new URLSearchParams({
        ne_lat: String(query.neLat),
        ne_lng: String(query.neLng),
        sw_lat: String(query.swLat),
        sw_lng: String(query.swLng),
        zoom: String(query.zoom),
      });

      if (query.tech) {
        params.set("tech", query.tech);
      }
      if (query.range) {
        params.set("range", query.range);
      }
      if (query.mcc) {
        params.set("mcc", query.mcc);
      }
      if (query.mnc) {
        params.set("mnc", query.mnc);
      }

      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_BASE}/api/towers/bounds?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`Failed to load towers (${response.status})`);
        }

        const payload = (await response.json()) as TowerBoundsResponse;
        const safeTowers = Array.isArray(payload.towers) ? payload.towers : [];
        cache.set(key, safeTowers);

        if (cache.size > 120) {
          const firstKey = cache.keys().next().value as string | undefined;
          if (firstKey) {
            cache.delete(firstKey);
          }
        }

        setTowers(safeTowers);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown tower query error";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [cache],
  );

  return {
    towers,
    loading,
    error,
    fetchTowersInBounds,
  };
}
