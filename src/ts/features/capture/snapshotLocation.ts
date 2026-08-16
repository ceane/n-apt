export type SnapshotLocationAddress = {
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  state?: string;
  country?: string;
};

export function formatSnapshotLocation(
  address: SnapshotLocationAddress,
): string | null {
  const locality = address.city ?? address.town ?? address.village;
  const parts = [
    address.neighbourhood ?? address.suburb,
    locality,
    address.state,
    address.country,
  ].filter((part): part is string => Boolean(part?.trim()));
  return parts.length ? parts.join(", ") : null;
}

export function formatSnapshotLocationLine(
  geolocation: { lat: string; lon: string },
  place?: string | null,
): string {
  return `Location: ${geolocation.lat}, ${geolocation.lon}${place ? ` – ${place}` : ""}`;
}

export async function reverseGeocodeSnapshotLocation(
  lat: string,
  lon: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,
    { headers: { Accept: "application/json" }, signal },
  );
  if (!response.ok) throw new Error(`Reverse geocoding failed (${response.status})`);
  const payload = (await response.json()) as { address?: SnapshotLocationAddress };
  return payload.address ? formatSnapshotLocation(payload.address) : null;
}
