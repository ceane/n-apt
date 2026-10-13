export type BodyMapArea = { name: string };

const BODY_MAP_AREA_ALIASES: Record<string, string> = {
  neck: 'throat',
};

function normalizeAreaName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function canonicalAreaName(name: string): string {
  const normalizedName = normalizeAreaName(name);
  return BODY_MAP_AREA_ALIASES[normalizedName] ?? normalizedName;
}

export function findBodyMapArea<T extends BodyMapArea>(name: string, areas: T[]): T | null {
  const normalizedName = canonicalAreaName(name);
  return areas.find((area) => canonicalAreaName(area.name) === normalizedName) ?? null;
}

export function findBodyMapOptionForArea(areaName: string, options: string[]): string | null {
  const normalizedAreaName = canonicalAreaName(areaName);
  return options.find((option) => canonicalAreaName(option) === normalizedAreaName) ?? null;
}

export function addBodyMapSelection(selected: string[] = [], areaName: string): string[] {
  return selected.includes(areaName) ? selected : [...selected, areaName];
}
