export const collapsedProjectsStorageKey =
  "codex-mobile:collapsed-projects";

interface ProjectCollapseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function projectCollapseKey(backendId: string, cwd: string) {
  return `${backendId}:${cwd}`;
}

export function readCollapsedProjectKeys(
  storage: Pick<ProjectCollapseStorage, "getItem">,
) {
  try {
    const parsed = JSON.parse(
      storage.getItem(collapsedProjectsStorageKey) ?? "[]",
    );
    if (
      !Array.isArray(parsed) ||
      !parsed.every((value) => typeof value === "string")
    ) {
      return new Set<string>();
    }
    return new Set(parsed);
  } catch {
    return new Set<string>();
  }
}

export function writeCollapsedProjectKeys(
  storage: Pick<ProjectCollapseStorage, "setItem">,
  keys: Set<string>,
) {
  storage.setItem(
    collapsedProjectsStorageKey,
    JSON.stringify([...keys].sort()),
  );
}
