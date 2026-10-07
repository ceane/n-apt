export type SnapshotLocationAddress = {
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  province?: string;
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

export function formatSnapshotLocality(
  address: SnapshotLocationAddress,
): string | null {
  const locality =
    address.city ??
    address.municipality ??
    address.town ??
    address.village;
  const province = address.province ?? address.state;
  const parts = [locality, province].filter((part): part is string =>
    Boolean(part?.trim()),
  );
  return parts.length ? parts.join(", ") : null;
}

export function formatSnapshotLocationLine(
  geolocation: { lat: string; lon: string },
  place?: string | null,
): string {
  return `Location: ${geolocation.lat}, ${geolocation.lon}${place ? ` – ${place}` : ""}`;
}

async function reverseGeocodeSnapshotAddress(
  lat: string,
  lon: string,
  signal?: AbortSignal,
): Promise<SnapshotLocationAddress | null> {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,
    { headers: { Accept: "application/json" }, signal },
  );
  if (!response.ok) throw new Error(`Reverse geocoding failed (${response.status})`);
  const payload = (await response.json()) as { address?: SnapshotLocationAddress };
  return payload.address ?? null;
}

export async function reverseGeocodeSnapshotLocation(
  lat: string,
  lon: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const address = await reverseGeocodeSnapshotAddress(lat, lon, signal);
  return address ? formatSnapshotLocation(address) : null;
}

export async function reverseGeocodeSnapshotLocality(
  lat: string,
  lon: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const address = await reverseGeocodeSnapshotAddress(lat, lon, signal);
  return address ? formatSnapshotLocality(address) : null;
}
