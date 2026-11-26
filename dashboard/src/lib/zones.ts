/** Time zones offered first, with plain labels. */
export const COMMON_ZONES: [string, string][] = [
  ["Asia/Kolkata", "India (IST)"],
  ["America/Los_Angeles", "US Pacific"],
  ["America/Chicago", "US Central"],
  ["America/New_York", "US Eastern"],
  ["Europe/London", "UK"],
  ["Europe/Berlin", "Central Europe"],
  ["Asia/Singapore", "Singapore"],
  ["Australia/Sydney", "Sydney"],
];

/** Every other zone the browser knows, for the "all time zones" part of a picker. */
export function otherZones(): string[] {
  const common = new Set(COMMON_ZONES.map(([z]) => z));
  let all: string[] = [];
  try {
    all = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    // Older browsers: the common list is enough.
  }
  // "Asia/Calcutta" is the old name of Asia/Kolkata, which is already listed.
  return all.filter((z) => !common.has(z) && z !== "Asia/Calcutta");
}
