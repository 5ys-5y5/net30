export type ModelingLibraryVersion = {
  id: string;
  ordinal: number;
  summary: string;
  createdAt: string;
  assetPath: string;
};

export type ModelingLibraryVersions = Record<string, readonly ModelingLibraryVersion[]>;
export type ModelingLibrarySelection = Record<string, string>;

export function mergeComponentVersions(
  current: ModelingLibraryVersions,
  updates: ModelingLibraryVersions,
): ModelingLibraryVersions {
  return { ...current, ...updates };
}

export function removeComponentVersion(
  current: ModelingLibraryVersions,
  component: string,
  versionId: string,
): ModelingLibraryVersions {
  return { ...current, [component]: (current[component] ?? []).filter((version) => version.id !== versionId) };
}

export function removeSelectedVersion(
  current: ModelingLibrarySelection,
  component: string,
  versionId: string,
): ModelingLibrarySelection {
  if (current[component] !== versionId) return current;
  const { [component]: _removed, ...remaining } = current;
  return remaining;
}
