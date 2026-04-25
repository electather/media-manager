const RUNTIME_LABELS: Record<string, string> = {
  short: "Short",
  medium: "Medium",
  long: "Long",
  very_long: "Very long",
};

export function formatRuntime(bucket: string): string {
  return RUNTIME_LABELS[bucket] ?? bucket;
}

export function formatLanguage(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export interface PersonLabel {
  role: string;
  name: string;
}

export function parsePerson(raw: string): PersonLabel {
  const idx = raw.indexOf(":");
  if (idx === -1) return { role: "", name: raw };
  return { role: raw.slice(0, idx), name: raw.slice(idx + 1) };
}

export function sortByWeight(features: Record<string, number>): [string, number][] {
  return Object.entries(features).sort(([, a], [, b]) => b - a);
}

export function topN(features: Record<string, number>, n: number): [string, number][] {
  return sortByWeight(features).slice(0, n);
}

/** Maps a weight value to a font size in px between 13 (min weight) and 22 (max weight). */
export function tagCloudFontSize(weight: number, min: number, max: number): number {
  if (max === min) return 13;
  return 13 + Math.round(((weight - min) / (max - min)) * 9);
}
